import { spawn } from 'node:child_process'

export interface SpawnedProcess {
  exitCode: number | null
  stdout: string
  stderr: string
  signal: NodeJS.Signals | null
  timedOut: boolean
}

export interface ProcessRunner {
  (
    bin: string,
    args: string[],
    stdin: string,
    opts: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<SpawnedProcess>
}

export interface ContainerTaskSpec {
  intent: string
  payload?: unknown
  task_id: string
}

export type NetworkMode =
  /** Phase 2 default: --network=none. */
  | 'none'
  /** Phase 3 transitional: --network=bridge (any egress). Removed once Outcall is everywhere. */
  | 'bridge'
  /** Phase 5: joins an Outcall sidecar's netns. Spawn lifecycle: start sidecar, run agent, stop sidecar. */
  | 'sidecar'

export interface SidecarSpec {
  /** Image tag for the sidecar (e.g. clawie/outcall:0.1.0). */
  image: string
  /** Env vars handed to the sidecar (provider credentials). */
  env: Record<string, string>
  /** Container name. Defaults to `outcall-<random>`. */
  name?: string
  /** Stop timeout in seconds for `docker stop`. Default 5. */
  stopTimeoutSec?: number
}

export interface SpawnRequest {
  image: string
  spec: ContainerTaskSpec
  timeoutMs?: number
  signal?: AbortSignal
  /** Per-spawn env vars piped through `docker run -e`. Keys/values must already be sanitised. */
  env?: Record<string, string>
  /** Network mode for this spawn. Default 'none' preserves Phase 2 sandboxing. */
  network?: NetworkMode
  /** Required when network='sidecar'. The Outcall instance to attach. */
  sidecar?: SidecarSpec
  /** Extra docker args inserted before the image name. */
  extraArgs?: string[]
}

export interface SpawnEnvelopeOk {
  ok: true
  output: unknown
}
export interface SpawnEnvelopeErr {
  ok: false
  cause: string
  detail?: string
}
export type SpawnEnvelope = SpawnEnvelopeOk | SpawnEnvelopeErr

export interface SpawnResult {
  envelope: SpawnEnvelope
  exitCode: number | null
  durationMs: number
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 30_000

const BASE_SANDBOX_ARGS = [
  '--rm',
  '-i',
  '--read-only',
  '--tmpfs',
  '/tmp',
  '--memory=256m',
  '--cpus=0.5',
  '--user',
  '1000:1000',
]

function networkFlagFor(mode: NetworkMode, sidecarName?: string): string {
  if (mode === 'none') return '--network=none'
  if (mode === 'bridge') return '--network=bridge'
  // sidecar mode -- join the sidecar's netns
  if (!sidecarName) throw new Error('sidecar mode requires a sidecar container name')
  return `--network=container:${sidecarName}`
}

function randomSidecarName(): string {
  return `outcall-${Math.random().toString(36).slice(2, 10)}`
}

async function stopSidecar(
  runner: ProcessRunner,
  bin: string,
  name: string,
  stopTimeoutSec = 5
): Promise<void> {
  // `--rm` on the sidecar means `docker stop` is enough; the container
  // removes itself once it exits. Errors here are swallowed -- the
  // sidecar can already be gone, and we don't want to mask the agent's
  // result with a teardown failure.
  try {
    await runner(bin, ['stop', '-t', String(stopTimeoutSec), name], '', { timeoutMs: 15_000 })
  } catch {
    // ignore: best-effort teardown
  }
}

export const defaultProcessRunner: ProcessRunner = (bin, args, stdin, opts) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, opts.timeoutMs)

    const onAbort = () => {
      timedOut = true
      proc.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    proc.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    proc.once('error', (err) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    proc.once('close', (code, signal) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: code, stdout, stderr, signal, timedOut })
    })

    proc.stdin.end(stdin)
  })
}

export class ContainerSpawner {
  constructor(
    private opts: {
      dockerBin?: string
      runner?: ProcessRunner
      defaultTimeoutMs?: number
    } = {}
  ) {}

  async spawn(req: SpawnRequest): Promise<SpawnResult> {
    const bin = this.opts.dockerBin ?? 'docker'
    const runner = this.opts.runner ?? defaultProcessRunner
    const timeoutMs = req.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const networkMode = req.network ?? 'none'

    const envArgs: string[] = []
    if (req.env) {
      for (const [key, value] of Object.entries(req.env)) {
        envArgs.push('-e', `${key}=${value}`)
      }
    }

    // Sidecar lifecycle: start sidecar (-d, detached) first, then run agent
    // attached to its netns. Always stop the sidecar in the `finally` path.
    let sidecarName: string | undefined
    const start = Date.now()
    if (networkMode === 'sidecar') {
      if (!req.sidecar) {
        return {
          envelope: {
            ok: false,
            cause: 'sidecar_missing',
            detail: "network='sidecar' requires the sidecar field",
          },
          exitCode: null,
          durationMs: 0,
          stderr: '',
        }
      }
      sidecarName = req.sidecar.name ?? randomSidecarName()
      const sidecarEnv: string[] = []
      for (const [k, v] of Object.entries(req.sidecar.env)) {
        sidecarEnv.push('-e', `${k}=${v}`)
      }
      const sidecarArgs = [
        'run',
        '-d',
        '--rm',
        '--name',
        sidecarName,
        '--read-only',
        '--tmpfs',
        '/tmp',
        ...sidecarEnv,
        req.sidecar.image,
      ]
      try {
        const startedSidecar = await runner(bin, sidecarArgs, '', {
          timeoutMs: 15_000,
          signal: req.signal,
        })
        if (startedSidecar.exitCode !== 0) {
          return {
            envelope: {
              ok: false,
              cause: 'sidecar_start_failed',
              detail:
                startedSidecar.stderr.trim().slice(0, 500) ||
                `docker run -d exited ${startedSidecar.exitCode}`,
            },
            exitCode: startedSidecar.exitCode,
            durationMs: Date.now() - start,
            stderr: startedSidecar.stderr,
          }
        }
      } catch (err) {
        return {
          envelope: {
            ok: false,
            cause: 'sidecar_start_failed',
            detail: err instanceof Error ? err.message : String(err),
          },
          exitCode: null,
          durationMs: Date.now() - start,
          stderr: '',
        }
      }
    }

    const args = [
      'run',
      ...BASE_SANDBOX_ARGS,
      networkFlagFor(networkMode, sidecarName),
      ...envArgs,
      ...(req.extraArgs ?? []),
      req.image,
    ]
    const stdin = JSON.stringify(req.spec)

    let proc: SpawnedProcess
    try {
      proc = await runner(bin, args, stdin, { timeoutMs, signal: req.signal })
    } catch (err) {
      return {
        envelope: {
          ok: false,
          cause: 'spawn_failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        exitCode: null,
        durationMs: Date.now() - start,
        stderr: '',
      }
    } finally {
      if (sidecarName) await stopSidecar(runner, bin, sidecarName, req.sidecar?.stopTimeoutSec)
    }

    const durationMs = Date.now() - start

    if (proc.timedOut) {
      return {
        envelope: {
          ok: false,
          cause: 'timeout',
          detail: `container exceeded ${timeoutMs}ms`,
        },
        exitCode: proc.exitCode,
        durationMs,
        stderr: proc.stderr,
      }
    }

    const trimmed = proc.stdout.trim()
    if (!trimmed) {
      return {
        envelope: {
          ok: false,
          cause: 'empty_stdout',
          detail: proc.stderr.trim().slice(0, 500) || `exit code ${proc.exitCode}`,
        },
        exitCode: proc.exitCode,
        durationMs,
        stderr: proc.stderr,
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return {
        envelope: {
          ok: false,
          cause: 'invalid_envelope',
          detail: 'stdout was not valid JSON',
        },
        exitCode: proc.exitCode,
        durationMs,
        stderr: proc.stderr,
      }
    }

    if (!isEnvelope(parsed)) {
      return {
        envelope: {
          ok: false,
          cause: 'invalid_envelope',
          detail: 'envelope missing required ok:boolean field',
        },
        exitCode: proc.exitCode,
        durationMs,
        stderr: proc.stderr,
      }
    }

    return {
      envelope: parsed,
      exitCode: proc.exitCode,
      durationMs,
      stderr: proc.stderr,
    }
  }
}

function isEnvelope(value: unknown): value is SpawnEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const ok = (value as Record<string, unknown>).ok
  return typeof ok === 'boolean'
}

let cachedInstance: ContainerSpawner | null = null
export function containerSpawner(): ContainerSpawner {
  if (!cachedInstance) cachedInstance = new ContainerSpawner()
  return cachedInstance
}

export function setContainerSpawnerForTest(instance: ContainerSpawner | null): void {
  cachedInstance = instance
}

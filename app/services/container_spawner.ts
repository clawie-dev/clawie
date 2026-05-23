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

export interface SpawnRequest {
  image: string
  spec: ContainerTaskSpec
  timeoutMs?: number
  signal?: AbortSignal
  /** Extra docker args inserted before the image name. Phase 2 leaves this empty. */
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

const SANDBOX_ARGS = [
  '--rm',
  '-i',
  '--network=none',
  '--read-only',
  '--tmpfs',
  '/tmp',
  '--memory=256m',
  '--cpus=0.5',
  '--user',
  '1000:1000',
]

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

    const args = ['run', ...SANDBOX_ARGS, ...(req.extraArgs ?? []), req.image]
    const stdin = JSON.stringify(req.spec)
    const start = Date.now()

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

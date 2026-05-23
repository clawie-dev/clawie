import { test } from '@japa/runner'
import {
  ContainerSpawner,
  type ProcessRunner,
  type SpawnedProcess,
} from '#services/container_spawner'

function runnerReturning(stdout: string, opts: Partial<SpawnedProcess> = {}): ProcessRunner {
  return async () => ({
    exitCode: 0,
    stdout,
    stderr: '',
    signal: null,
    timedOut: false,
    ...opts,
  })
}

test.group('services/container_spawner', () => {
  test('happy path: passes ok envelope through unchanged', async ({ assert }) => {
    const runner = runnerReturning(JSON.stringify({ ok: true, output: { hi: 1 } }))
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'clawie/agent-runtime:0.2.0',
      spec: { intent: 'echo', payload: 'x', task_id: 't1' },
    })
    assert.deepEqual(result.envelope, { ok: true, output: { hi: 1 } })
    assert.equal(result.exitCode, 0)
    assert.isAtLeast(result.durationMs, 0)
  })

  test('container reports failure: cause/detail flow through', async ({ assert }) => {
    const runner = runnerReturning(
      JSON.stringify({ ok: false, cause: 'intentional_failure', detail: 'nope' }),
      { exitCode: 1 }
    )
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', payload: { __fail: true }, task_id: 't' },
    })
    assert.deepEqual(result.envelope, {
      ok: false,
      cause: 'intentional_failure',
      detail: 'nope',
    })
    assert.equal(result.exitCode, 1)
  })

  test('non-JSON stdout produces cause=invalid_envelope', async ({ assert }) => {
    const runner = runnerReturning('not json at all')
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', task_id: 't' },
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) assert.equal(result.envelope.cause, 'invalid_envelope')
  })

  test('envelope missing ok field produces cause=invalid_envelope', async ({ assert }) => {
    const runner = runnerReturning(JSON.stringify({ output: 'no ok field' }))
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', task_id: 't' },
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) assert.equal(result.envelope.cause, 'invalid_envelope')
  })

  test('empty stdout produces cause=empty_stdout with stderr in detail', async ({ assert }) => {
    const runner = runnerReturning('   ', { exitCode: 125, stderr: 'docker: image not found' })
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'missing',
      spec: { intent: 'echo', task_id: 't' },
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.cause, 'empty_stdout')
      assert.include(result.envelope.detail ?? '', 'docker: image not found')
    }
  })

  test('runner throws → cause=spawn_failed with error message', async ({ assert }) => {
    const runner: ProcessRunner = async () => {
      throw new Error('ENOENT: docker not on PATH')
    }
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', task_id: 't' },
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.cause, 'spawn_failed')
      assert.include(result.envelope.detail ?? '', 'ENOENT')
    }
  })

  test('timedOut=true → cause=timeout', async ({ assert }) => {
    const runner = runnerReturning('', { timedOut: true, exitCode: null })
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', task_id: 't' },
      timeoutMs: 500,
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.cause, 'timeout')
      assert.include(result.envelope.detail ?? '', '500ms')
    }
  })

  test('runner receives docker sandbox argv and JSON-encoded stdin', async ({ assert }) => {
    let capturedBin = ''
    let capturedArgs: string[] = []
    let capturedStdin = ''
    const runner: ProcessRunner = async (bin, args, stdin) => {
      capturedBin = bin
      capturedArgs = args
      capturedStdin = stdin
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    const spawner = new ContainerSpawner({ runner })
    await spawner.spawn({
      image: 'clawie/agent-runtime:0.2.0',
      spec: { intent: 'echo', payload: 'hi', task_id: 'task-1' },
    })

    assert.equal(capturedBin, 'docker')
    assert.equal(capturedArgs[0], 'run')
    assert.include(capturedArgs, '--rm')
    assert.include(capturedArgs, '--network=none')
    assert.include(capturedArgs, '--read-only')
    assert.equal(capturedArgs[capturedArgs.length - 1], 'clawie/agent-runtime:0.2.0')

    assert.deepEqual(JSON.parse(capturedStdin), {
      intent: 'echo',
      payload: 'hi',
      task_id: 'task-1',
    })
  })

  test('env map is rendered as -e KEY=VAL docker args', async ({ assert }) => {
    let capturedArgs: string[] = []
    const runner: ProcessRunner = async (_bin, args) => {
      capturedArgs = args
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    const spawner = new ContainerSpawner({ runner })
    await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', task_id: 't' },
      env: { ANTHROPIC_API_KEY: 'sk-test', OPENAI_API_KEY: 'oai-test' },
    })

    // Each -e flag is followed by a KEY=VAL pair.
    const envFlagPositions = capturedArgs.flatMap((a, i) => (a === '-e' ? [i] : []))
    assert.equal(envFlagPositions.length, 2)
    const pairs = envFlagPositions.map((i) => capturedArgs[i + 1])
    assert.includeMembers(pairs, ['ANTHROPIC_API_KEY=sk-test', 'OPENAI_API_KEY=oai-test'])
  })

  test('network mode "none" produces --network=none flag (default)', async ({ assert }) => {
    let capturedArgs: string[] = []
    const runner: ProcessRunner = async (_bin, args) => {
      capturedArgs = args
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    const spawner = new ContainerSpawner({ runner })
    await spawner.spawn({ image: 'img', spec: { intent: 'echo', task_id: 't' } })
    assert.include(capturedArgs, '--network=none')
  })

  test('network mode "bridge" produces --network=bridge flag', async ({ assert }) => {
    let capturedArgs: string[] = []
    const runner: ProcessRunner = async (_bin, args) => {
      capturedArgs = args
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    const spawner = new ContainerSpawner({ runner })
    await spawner.spawn({
      image: 'img',
      spec: { intent: 'chat', task_id: 't' },
      network: 'bridge',
    })
    assert.include(capturedArgs, '--network=bridge')
    assert.notInclude(capturedArgs, '--network=none')
  })

  test('sidecar mode: starts sidecar with -d, attaches agent via --network=container:NAME, stops sidecar after', async ({
    assert,
  }) => {
    const calls: Array<{ args: string[] }> = []
    const runner: ProcessRunner = async (_bin, args) => {
      calls.push({ args })
      if (args[0] === 'run' && args.includes('-d')) {
        return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
      }
      if (args[0] === 'stop') {
        return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    const spawner = new ContainerSpawner({ runner })
    await spawner.spawn({
      image: 'agent',
      spec: { intent: 'chat', task_id: 't' },
      network: 'sidecar',
      sidecar: {
        image: 'clawie/outcall:0.1.0',
        env: { ANTHROPIC_API_KEY: 'sk-test' },
        name: 'outcall-fixed',
      },
    })

    assert.equal(calls.length, 3)
    // sidecar start
    assert.equal(calls[0].args[0], 'run')
    assert.include(calls[0].args, '-d')
    assert.include(calls[0].args, 'clawie/outcall:0.1.0')
    const sidecarEnvIndex = calls[0].args.indexOf('-e')
    assert.equal(calls[0].args[sidecarEnvIndex + 1], 'ANTHROPIC_API_KEY=sk-test')
    // agent run
    assert.equal(calls[1].args[0], 'run')
    assert.include(calls[1].args, '--network=container:outcall-fixed')
    assert.notInclude(calls[1].args, '--network=bridge')
    assert.notInclude(calls[1].args, '--network=none')
    // sidecar stop
    assert.equal(calls[2].args[0], 'stop')
    assert.equal(calls[2].args[calls[2].args.length - 1], 'outcall-fixed')
  })

  test('sidecar mode: missing sidecar field returns cause=sidecar_missing', async ({ assert }) => {
    const runner: ProcessRunner = async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      timedOut: false,
    })
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'agent',
      spec: { intent: 'chat', task_id: 't' },
      network: 'sidecar',
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) assert.equal(result.envelope.cause, 'sidecar_missing')
  })

  test('sidecar mode: sidecar start failure surfaces as sidecar_start_failed', async ({
    assert,
  }) => {
    const runner: ProcessRunner = async (_bin, args) => {
      if (args[0] === 'run' && args.includes('-d')) {
        return {
          exitCode: 125,
          stdout: '',
          stderr: 'Unable to find image clawie/outcall:0.1.0',
          signal: null,
          timedOut: false,
        }
      }
      return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
    }
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'agent',
      spec: { intent: 'chat', task_id: 't' },
      network: 'sidecar',
      sidecar: { image: 'clawie/outcall:0.1.0', env: {} },
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.cause, 'sidecar_start_failed')
      assert.match(result.envelope.detail ?? '', /Unable to find image/)
    }
  })

  test('sidecar mode: still stops sidecar when agent run throws', async ({ assert }) => {
    const calls: string[] = []
    const runner: ProcessRunner = async (_bin, args) => {
      calls.push(args[0])
      if (args[0] === 'run' && args.includes('-d')) {
        return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
      }
      if (args[0] === 'stop') {
        return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
      }
      throw new Error('docker daemon disappeared')
    }
    const spawner = new ContainerSpawner({ runner })
    const result = await spawner.spawn({
      image: 'agent',
      spec: { intent: 'chat', task_id: 't' },
      network: 'sidecar',
      sidecar: { image: 'clawie/outcall:0.1.0', env: {}, name: 'cleanup-test' },
    })
    assert.isFalse(result.envelope.ok)
    if (!result.envelope.ok) assert.equal(result.envelope.cause, 'spawn_failed')
    // finally block must still have run the stop
    assert.include(calls, 'stop')
  })

  test('custom dockerBin is honored', async ({ assert }) => {
    let capturedBin = ''
    const runner: ProcessRunner = async (bin) => {
      capturedBin = bin
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    const spawner = new ContainerSpawner({ runner, dockerBin: '/usr/local/bin/podman' })
    await spawner.spawn({
      image: 'img',
      spec: { intent: 'echo', task_id: 't' },
    })
    assert.equal(capturedBin, '/usr/local/bin/podman')
  })
})

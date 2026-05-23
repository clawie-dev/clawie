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

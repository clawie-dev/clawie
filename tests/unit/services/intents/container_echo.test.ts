import { test } from '@japa/runner'
import {
  ContainerSpawner,
  setContainerSpawnerForTest,
  type ProcessRunner,
} from '#services/container_spawner'
import { containerEchoIntent, AGENT_RUNTIME_IMAGE } from '#services/intents/container_echo'

function spawnerWithStdout(stdout: string, opts: { exitCode?: number; stderr?: string } = {}) {
  const runner: ProcessRunner = async (_bin, _args, _stdin) => ({
    exitCode: opts.exitCode ?? 0,
    stdout,
    stderr: opts.stderr ?? '',
    signal: null,
    timedOut: false,
  })
  return new ContainerSpawner({ runner })
}

test.group('services/intents/container_echo', (group) => {
  group.each.teardown(() => setContainerSpawnerForTest(null))

  test('returns ok outcome when spawner returns ok envelope', async ({ assert }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(JSON.stringify({ ok: true, output: { message: 'hello: hi' } }))
    )
    const outcome = await containerEchoIntent({ taskId: 't1', payload: 'hi' })
    assert.deepEqual(outcome, { ok: true, output: { message: 'hello: hi' } })
  })

  test('maps spawner failure cause/detail through unchanged', async ({ assert }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(
        JSON.stringify({ ok: false, cause: 'intentional_failure', detail: 'requested' }),
        { exitCode: 1 }
      )
    )
    const outcome = await containerEchoIntent({ taskId: 't2', payload: { __fail: true } })
    assert.deepEqual(outcome, {
      ok: false,
      cause: 'intentional_failure',
      detail: 'requested',
    })
  })

  test('captures invalid_envelope when container emits non-JSON stdout', async ({ assert }) => {
    setContainerSpawnerForTest(spawnerWithStdout('garbage', { exitCode: 0 }))
    const outcome = await containerEchoIntent({ taskId: 't3', payload: null })
    assert.isFalse(outcome.ok)
    if (!outcome.ok) assert.equal(outcome.cause, 'invalid_envelope')
  })

  test('forwards taskId and payload to the container spec', async ({ assert }) => {
    let capturedStdin = ''
    const runner: ProcessRunner = async (_bin, _args, stdin) => {
      capturedStdin = stdin
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    setContainerSpawnerForTest(new ContainerSpawner({ runner }))
    await containerEchoIntent({ taskId: 'task-xyz', payload: { a: 1 } })
    const parsed = JSON.parse(capturedStdin)
    assert.equal(parsed.intent, 'echo')
    assert.equal(parsed.task_id, 'task-xyz')
    assert.deepEqual(parsed.payload, { a: 1 })
  })

  test('exposes the pinned agent-runtime image tag', ({ assert }) => {
    assert.equal(AGENT_RUNTIME_IMAGE, 'clawie/agent-runtime:0.2.0')
  })
})

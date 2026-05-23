import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { TaskStateMachine } from '#services/task_state_machine'
import { TaskExecutor } from '#services/task_executor'
import { registerBuiltinIntents, resetIntentsForTest } from '#services/intents/index'
import {
  ContainerSpawner,
  setContainerSpawnerForTest,
  type ProcessRunner,
} from '#services/container_spawner'

/**
 * Proves the container.echo path through the full durable lifecycle:
 *   create → claim → start → spawn (faked) → complete | fail
 *
 * Docker is replaced with a fake ProcessRunner so this runs in any
 * environment. A separate real-Docker integration test will be added
 * later, gated on an env flag.
 */

function runnerReturning(stdout: string, exitCode = 0): ProcessRunner {
  return async () => ({
    exitCode,
    stdout,
    stderr: '',
    signal: null,
    timedOut: false,
  })
}

test.group('integration/container_echo_lifecycle', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    resetIntentsForTest()
    registerBuiltinIntents()
    return () => {
      resetIntentsForTest()
      setContainerSpawnerForTest(null)
    }
  })

  test('container.echo completes the task when the container returns ok', async ({ assert }) => {
    setContainerSpawnerForTest(
      new ContainerSpawner({
        runner: runnerReturning(JSON.stringify({ ok: true, output: { message: 'hello: hi' } })),
      })
    )

    const sm = new TaskStateMachine()
    const task = await sm.create({
      intent: 'container.echo',
      payload: 'hi',
      actor: 'integration',
    })

    const done = await new TaskExecutor().execute(task.id, 'integration')

    assert.equal(done.status, 'completed')
    assert.deepEqual(done.parsedResult, { message: 'hello: hi' })
  })

  test('container.echo fails the task when the container returns an error envelope', async ({
    assert,
  }) => {
    setContainerSpawnerForTest(
      new ContainerSpawner({
        runner: runnerReturning(
          JSON.stringify({ ok: false, cause: 'intentional_failure', detail: 'no' }),
          1
        ),
      })
    )

    const sm = new TaskStateMachine()
    const task = await sm.create({
      intent: 'container.echo',
      payload: { __fail: true },
      actor: 'integration',
    })

    const done = await new TaskExecutor().execute(task.id, 'integration')

    assert.equal(done.status, 'failed')
    assert.equal(done.failureCause, 'intentional_failure')
    assert.equal(done.failureDetail, 'no')
  })

  test('container.echo fails the task when the container emits invalid stdout', async ({
    assert,
  }) => {
    setContainerSpawnerForTest(new ContainerSpawner({ runner: runnerReturning('not json', 0) }))

    const sm = new TaskStateMachine()
    const task = await sm.create({
      intent: 'container.echo',
      payload: null,
      actor: 'integration',
    })

    const done = await new TaskExecutor().execute(task.id, 'integration')

    assert.equal(done.status, 'failed')
    assert.equal(done.failureCause, 'invalid_envelope')
  })
})

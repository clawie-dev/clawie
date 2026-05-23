import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { TaskExecutor } from '#services/task_executor'
import { TaskStateMachine } from '#services/task_state_machine'
import { resetIntentsForTest, registerBuiltinIntents } from '#services/intents/index'
import { intentRegistry } from '#services/intents/registry'

test.group('services/task_executor', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    resetIntentsForTest()
    registerBuiltinIntents()
    return () => resetIntentsForTest()
  })

  test('executes an echo task end-to-end to completed', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'world', actor: 't' })
    const exec = new TaskExecutor()
    const done = await exec.execute(task.id)
    assert.equal(done.status, 'completed')
    assert.deepEqual(done.parsedResult, { message: 'hello: world' })
  })

  test('marks task failed when the intent reports failure', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: { __fail: true }, actor: 't' })
    const exec = new TaskExecutor()
    const done = await exec.execute(task.id)
    assert.equal(done.status, 'failed')
    assert.equal(done.failureCause, 'intentional_failure')
  })

  test('marks task failed with unknown_intent when intent is not registered', async ({
    assert,
  }) => {
    intentRegistry().clear()
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'does-not-exist', payload: null, actor: 't' })
    const exec = new TaskExecutor()
    const done = await exec.execute(task.id)
    assert.equal(done.status, 'failed')
    assert.equal(done.failureCause, 'unknown_intent')
  })

  test('captures thrown error as handler_threw', async ({ assert }) => {
    intentRegistry().register('boom', async () => {
      throw new Error('kaboom')
    })
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'boom', payload: null, actor: 't' })
    const exec = new TaskExecutor()
    const done = await exec.execute(task.id)
    assert.equal(done.status, 'failed')
    assert.equal(done.failureCause, 'handler_threw')
    assert.include(done.failureDetail ?? '', 'kaboom')
  })
})

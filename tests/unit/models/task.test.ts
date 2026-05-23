import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Task from '#models/task'

test.group('models/task', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('assigns a uuid id, default status, and version on create', async ({ assert }) => {
    const task = await Task.create({
      intent: 'echo',
      payload: JSON.stringify('x'),
      status: 'queued',
    })
    assert.match(task.id, /^[0-9a-f-]{36}$/i)
    assert.equal(task.status, 'queued')
    assert.equal(task.version, 0)
  })

  test('parsedPayload returns the original value', async ({ assert }) => {
    const task = await Task.create({
      intent: 'echo',
      payload: JSON.stringify({ a: 1 }),
      status: 'queued',
    })
    assert.deepEqual(task.parsedPayload, { a: 1 })
  })

  test('parsedResult returns null when result column is null', async ({ assert }) => {
    const task = await Task.create({
      intent: 'echo',
      payload: JSON.stringify(null),
      status: 'queued',
    })
    assert.isNull(task.parsedResult)
  })

  test('isTerminal returns true only for terminal statuses', async ({ assert }) => {
    const t = new Task()
    t.status = 'queued'
    assert.isFalse(t.isTerminal())
    t.status = 'completed'
    assert.isTrue(t.isTerminal())
    t.status = 'failed'
    assert.isTrue(t.isTerminal())
    t.status = 'aborted'
    assert.isTrue(t.isTerminal())
    t.status = 'running'
    assert.isFalse(t.isTerminal())
  })
})

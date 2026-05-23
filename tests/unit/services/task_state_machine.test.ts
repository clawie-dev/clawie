import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { TaskStateMachine } from '#services/task_state_machine'
import { setPolicyEngineForTest } from '#services/policy_engine'
import { installAllowAllPolicy } from '#tests/helpers/allow_all_policy'

test.group('services/task_state_machine', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    installAllowAllPolicy()
    return () => setPolicyEngineForTest(null)
  })

  test('create persists a task in queued status', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 'test' })
    assert.equal(task.status, 'queued')
    assert.equal(task.intent, 'echo')
  })

  test('idempotency key returns existing task on repeat create', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const a = await sm.create({ intent: 'echo', payload: 1, idempotencyKey: 'k', actor: 't' })
    const b = await sm.create({ intent: 'echo', payload: 2, idempotencyKey: 'k', actor: 't' })
    assert.equal(a.id, b.id)
  })

  test('claim moves queued → claimed and sets claimedBy', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    const claimed = await sm.claim(task.id, { workerId: 'w1' })
    assert.equal(claimed.status, 'claimed')
    assert.equal(claimed.claimedBy, 'w1')
  })

  test('start moves claimed → running', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    await sm.claim(task.id, { workerId: 'w1' })
    const running = await sm.start(task.id, 'w1')
    assert.equal(running.status, 'running')
    assert.isNotNull(running.startedAt)
  })

  test('complete moves running → completed and persists result', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    await sm.claim(task.id, { workerId: 'w1' })
    await sm.start(task.id, 'w1')
    const done = await sm.complete(task.id, 'w1', { ok: true })
    assert.equal(done.status, 'completed')
    assert.deepEqual(done.parsedResult, { ok: true })
    assert.isNotNull(done.finishedAt)
  })

  test('illegal transition raises TaskTransitionError', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    let caught: Error | null = null
    try {
      await sm.complete(task.id, 't', null)
    } catch (err) {
      caught = err as Error
    }
    assert.exists(caught)
    assert.equal(caught?.name, 'TaskTransitionError')
    assert.match(caught?.message ?? '', /Cannot transition/)
  })

  test('cannot transition out of a terminal state', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    await sm.claim(task.id, { workerId: 'w1' })
    await sm.start(task.id, 'w1')
    await sm.complete(task.id, 'w1', null)
    let caught: Error | null = null
    try {
      await sm.fail(task.id, 'w1', 'oops')
    } catch (err) {
      caught = err as Error
    }
    assert.exists(caught)
    assert.equal(caught?.name, 'TaskTransitionError')
  })

  test('fail moves running → failed and records cause + detail', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    await sm.claim(task.id, { workerId: 'w1' })
    await sm.start(task.id, 'w1')
    const failed = await sm.fail(task.id, 'w1', 'oom', 'memory exceeded')
    assert.equal(failed.status, 'failed')
    assert.equal(failed.failureCause, 'oom')
    assert.equal(failed.failureDetail, 'memory exceeded')
  })

  test('abort moves from queued → aborted', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    const aborted = await sm.abort(task.id, 't', 'operator aborted')
    assert.equal(aborted.status, 'aborted')
  })

  test('throws on unknown task', async ({ assert }) => {
    const sm = new TaskStateMachine()
    let caught: Error | null = null
    try {
      await sm.claim('nope', { workerId: 'w1' })
    } catch (err) {
      caught = err as Error
    }
    assert.exists(caught)
    assert.match(caught?.message ?? '', /not found/)
  })

  test('version increments on each transition', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const task = await sm.create({ intent: 'echo', payload: 'x', actor: 't' })
    assert.equal(task.version, 0)
    const claimed = await sm.claim(task.id, { workerId: 'w1' })
    assert.equal(claimed.version, 1)
    const running = await sm.start(task.id, 'w1')
    assert.equal(running.version, 2)
  })
})

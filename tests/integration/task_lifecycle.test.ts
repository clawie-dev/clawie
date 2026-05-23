import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { TaskStateMachine } from '#services/task_state_machine'
import { TaskExecutor } from '#services/task_executor'
import { registerBuiltinIntents, resetIntentsForTest } from '#services/intents/index'
import { setContainerSpawnerForTest } from '#services/container_spawner'
import { setPolicyEngineForTest } from '#services/policy_engine'
import { fakeContainerSpawner } from '#tests/helpers/fake_spawner'
import { installAllowAllPolicy } from '#tests/helpers/allow_all_policy'
import { auditLogger } from '#services/audit_logger'
import AuditEvent from '#models/audit_event'
import CostLedgerEntry from '#models/cost_ledger_entry'
import Task from '#models/task'

test.group('integration/task_lifecycle', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    resetIntentsForTest()
    registerBuiltinIntents()
    setContainerSpawnerForTest(fakeContainerSpawner())
    installAllowAllPolicy()
    return () => {
      resetIntentsForTest()
      setContainerSpawnerForTest(null)
      setPolicyEngineForTest(null)
    }
  })

  test('full happy-path: create → claim → start → complete with audit trail', async ({
    assert,
  }) => {
    const sm = new TaskStateMachine()
    const exec = new TaskExecutor()

    const created = await sm.create({ intent: 'echo', payload: 'happy', actor: 'integration' })
    const finished = await exec.execute(created.id, 'integration')

    assert.equal(finished.status, 'completed')
    assert.deepEqual(finished.parsedResult, { message: 'hello: happy' })

    const reloaded = await Task.findOrFail(created.id)
    assert.equal(reloaded.status, 'completed')

    const events = await AuditEvent.query().where('subject_id', created.id).orderBy('id', 'asc')
    const actions = events.map((e) => e.action)
    assert.includeMembers(actions, [
      'task.created',
      'task.claimed',
      'task.running',
      'container.spawn_started',
      'container.spawn_completed',
      'task.completed',
    ])
  })

  test('audit chain remains verifiable after a lifecycle', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const exec = new TaskExecutor()
    const created = await sm.create({ intent: 'echo', payload: 'x', actor: 'integration' })
    await exec.execute(created.id, 'integration')
    const result = await auditLogger().verifyChain()
    assert.deepEqual(result, { ok: true })
  })

  test('failure path: failing intent leaves task in failed status', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const exec = new TaskExecutor()
    const created = await sm.create({
      intent: 'echo',
      payload: { __fail: true },
      actor: 'integration',
    })
    const finished = await exec.execute(created.id, 'integration')
    assert.equal(finished.status, 'failed')
    assert.equal(finished.failureCause, 'intentional_failure')

    const reloaded = await Task.findOrFail(created.id)
    assert.equal(reloaded.status, 'failed')

    const events = await AuditEvent.query().where('subject_id', created.id).orderBy('id', 'asc')
    const last = events[events.length - 1]
    assert.equal(last.action, 'task.failed')
  })

  test('idempotency: same key returns same task', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const a = await sm.create({
      intent: 'echo',
      payload: 1,
      idempotencyKey: 'k',
      actor: 'integration',
    })
    const b = await sm.create({
      intent: 'echo',
      payload: 2,
      idempotencyKey: 'k',
      actor: 'integration',
    })
    assert.equal(a.id, b.id)
  })

  test('chat intent: completes, writes cost ledger row, audits cost.recorded', async ({
    assert,
  }) => {
    const sm = new TaskStateMachine()
    const exec = new TaskExecutor()
    const task = await sm.create({
      intent: 'chat',
      payload: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      },
      actor: 'integration',
    })

    const done = await exec.execute(task.id, 'integration')
    assert.equal(done.status, 'completed')

    const rows = await CostLedgerEntry.query().where('task_id', task.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].provider, 'anthropic')
    assert.equal(rows[0].model, 'claude-sonnet-4-6')

    const events = await AuditEvent.query().where('subject_id', task.id).orderBy('id', 'asc')
    const actions = events.map((e) => e.action)
    assert.includeMembers(actions, ['cost.recorded', 'container.spawn_completed', 'task.completed'])
  })
})

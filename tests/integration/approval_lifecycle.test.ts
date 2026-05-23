import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { TaskStateMachine } from '#services/task_state_machine'
import { TaskExecutor } from '#services/task_executor'
import { registerBuiltinIntents, resetIntentsForTest } from '#services/intents/index'
import { setContainerSpawnerForTest } from '#services/container_spawner'
import { setPolicyEngineForTest, PolicyEngine } from '#services/policy_engine'
import { fakeContainerSpawner } from '#tests/helpers/fake_spawner'
import Policy from '#models/policy'
import Approval from '#models/approval'
import AuditEvent from '#models/audit_event'
import Task from '#models/task'

/**
 * End-to-end approval flow. We use the real PolicyEngine (with seeded
 * policies) so the default-deny + transition semantics are actually
 * exercised. Containers are still faked.
 */
test.group('integration/approval_lifecycle', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    resetIntentsForTest()
    registerBuiltinIntents()
    setContainerSpawnerForTest(fakeContainerSpawner())
    setPolicyEngineForTest(new PolicyEngine())
    return () => {
      resetIntentsForTest()
      setContainerSpawnerForTest(null)
      setPolicyEngineForTest(null)
    }
  })

  test('no policies → task lands in approval_pending; approve drives it to completed', async ({
    assert,
  }) => {
    const sm = new TaskStateMachine()
    const exec = new TaskExecutor()

    const created = await sm.create({ intent: 'echo', payload: 'x', actor: 'integration' })
    assert.equal(created.status, 'approval_pending')

    const approval = await Approval.query().where('task_id', created.id).firstOrFail()
    assert.equal(approval.status, 'pending')

    const approved = await sm.approve(created.id, 'reviewer', 'looks fine')
    assert.equal(approved.status, 'queued')

    const finished = await exec.execute(created.id, 'integration')
    assert.equal(finished.status, 'completed')

    const reloadedApproval = await Approval.findOrFail(approval.id)
    assert.equal(reloadedApproval.status, 'approved')
    assert.equal(reloadedApproval.decidedBy, 'reviewer')
  })

  test('explicit allow policy → task goes straight to queued, no approval row', async ({
    assert,
  }) => {
    await Policy.create({
      name: 'allow echo',
      intentPattern: 'echo',
      predicates: '{}',
      decision: 'allow',
      priority: 10,
      createdBy: 'test',
    })

    const sm = new TaskStateMachine()
    const created = await sm.create({ intent: 'echo', payload: 'x', actor: 'integration' })
    assert.equal(created.status, 'queued')

    const approvals = await Approval.query().where('task_id', created.id)
    assert.equal(approvals.length, 0)
  })

  test('explicit deny policy → task immediately failed with cause=policy_denied', async ({
    assert,
  }) => {
    await Policy.create({
      name: 'deny chat',
      intentPattern: 'chat',
      predicates: '{}',
      decision: 'deny',
      priority: 10,
      createdBy: 'test',
    })

    const sm = new TaskStateMachine()
    const created = await sm.create({
      intent: 'chat',
      payload: { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [] },
      actor: 'integration',
    })
    assert.equal(created.status, 'failed')
    assert.equal(created.failureCause, 'policy_denied')

    const reloaded = await Task.findOrFail(created.id)
    assert.equal(reloaded.status, 'failed')
  })

  test('denyApproval transitions task to failed with cause=approval_denied', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const created = await sm.create({ intent: 'echo', payload: 'x', actor: 'integration' })

    const denied = await sm.denyApproval(created.id, 'reviewer', 'looks fishy')
    assert.equal(denied.status, 'failed')
    assert.equal(denied.failureCause, 'approval_denied')

    const rows = await AuditEvent.query().where('subject_id', created.id).orderBy('id', 'asc')
    const events = rows.map((e) => e.action)
    assert.includeMembers(events, ['policy.decided', 'approval.requested', 'approval.denied'])
  })

  test('expirePastDeadlines marks the approval expired and fails the task', async ({ assert }) => {
    const sm = new TaskStateMachine()
    const created = await sm.create({
      intent: 'echo',
      payload: 'x',
      actor: 'integration',
      approvalWindowMs: -1, // already expired
    })
    assert.equal(created.status, 'approval_pending')

    const expired = await sm.expirePastDeadlines(DateTime.utc().plus({ seconds: 1 }))
    assert.equal(expired, 1)

    const task = await Task.findOrFail(created.id)
    assert.equal(task.status, 'failed')
    assert.equal(task.failureCause, 'approval_expired')

    const approval = await Approval.query().where('task_id', created.id).firstOrFail()
    assert.equal(approval.status, 'expired')
  })
})

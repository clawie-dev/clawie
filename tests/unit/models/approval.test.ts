import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Approval from '#models/approval'

test.group('models/approval', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('round-trips persisted columns', async ({ assert }) => {
    const now = DateTime.utc()
    const a = await Approval.create({
      taskId: 't-1',
      status: 'pending',
      requestedAt: now,
      deadlineAt: now.plus({ minutes: 15 }),
    })
    const reloaded = await Approval.findOrFail(a.id)
    assert.equal(reloaded.taskId, 't-1')
    assert.equal(reloaded.status, 'pending')
    assert.equal(reloaded.decidedBy, null)
  })

  test('unique constraint prevents two approvals for the same task', async ({ assert }) => {
    const now = DateTime.utc()
    await Approval.create({
      taskId: 't-2',
      status: 'pending',
      requestedAt: now,
      deadlineAt: now.plus({ minutes: 5 }),
    })
    await assert.rejects(() =>
      Approval.create({
        taskId: 't-2',
        status: 'pending',
        requestedAt: now,
        deadlineAt: now.plus({ minutes: 5 }),
      })
    )
  })
})

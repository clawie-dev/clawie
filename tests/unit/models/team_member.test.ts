import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import TeamMember from '#models/team_member'

test.group('models/team_member', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('persists agent ↔ team association', async ({ assert }) => {
    const m = await TeamMember.create({
      teamId: 1,
      agentName: 'coder',
      role: 'member',
      addedAt: DateTime.utc(),
    })
    const r = await TeamMember.findOrFail(m.id)
    assert.equal(r.agentName, 'coder')
  })

  test('(team_id, agent_name) is unique', async ({ assert }) => {
    await TeamMember.create({
      teamId: 1,
      agentName: 'coder',
      role: 'member',
      addedAt: DateTime.utc(),
    })
    await assert.rejects(() =>
      TeamMember.create({
        teamId: 1,
        agentName: 'coder',
        role: 'lead',
        addedAt: DateTime.utc(),
      })
    )
  })
})

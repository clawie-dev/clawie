import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import AgentModification from '#models/agent_modification'

test.group('models/agent_modification', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('parsedChanges decodes the JSON column', async ({ assert }) => {
    const m = await AgentModification.create({
      agentName: 'coder',
      taskId: 't-x',
      status: 'pending',
      diff: '',
      proposedChanges: JSON.stringify([{ path: 'SOUL.md', content: 'hi' }]),
      createdAt: DateTime.utc(),
    })
    assert.deepEqual(m.parsedChanges, [{ path: 'SOUL.md', content: 'hi' }])
  })

  test('parsedChanges falls back to [] on bad JSON', async ({ assert }) => {
    const m = await AgentModification.create({
      agentName: 'coder',
      taskId: 't-y',
      status: 'pending',
      diff: '',
      proposedChanges: 'not-json',
      createdAt: DateTime.utc(),
    })
    assert.deepEqual(m.parsedChanges, [])
  })

  test('task_id is unique', async ({ assert }) => {
    await AgentModification.create({
      agentName: 'coder',
      taskId: 'dup',
      status: 'pending',
      diff: '',
      proposedChanges: '[]',
      createdAt: DateTime.utc(),
    })
    await assert.rejects(() =>
      AgentModification.create({
        agentName: 'coder',
        taskId: 'dup',
        status: 'pending',
        diff: '',
        proposedChanges: '[]',
        createdAt: DateTime.utc(),
      })
    )
  })
})

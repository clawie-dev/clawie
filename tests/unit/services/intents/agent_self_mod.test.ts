import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { agentSelfModIntent } from '#services/intents/agent_self_mod'
import AgentDefinition from '#models/agent_definition'
import AgentModification from '#models/agent_modification'

async function seedAgent(name = 'coder') {
  return AgentDefinition.create({
    name,
    soul: '# coder',
    agentsYaml: 'intents: [echo]',
    toolsYaml: 'allow: [github]',
    sourcePath: '/tmp/' + name,
    loadedAt: DateTime.utc(),
  })
}

test.group('services/intents/agent_self_mod', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('records a pending AgentModification with diff', async ({ assert }) => {
    await seedAgent('coder')
    const outcome = await agentSelfModIntent({
      taskId: 't-1',
      payload: {
        agentName: 'coder',
        changes: [{ path: 'TOOLS.yaml', content: 'allow: [github, npm]' }],
      },
    })
    assert.equal(outcome.ok, true)
    const row = await AgentModification.query().where('task_id', 't-1').firstOrFail()
    assert.equal(row.status, 'pending')
    assert.equal(row.agentName, 'coder')
    assert.match(row.diff, /TOOLS.yaml/)
    assert.deepEqual(row.parsedChanges, [{ path: 'TOOLS.yaml', content: 'allow: [github, npm]' }])
  })

  test('unknown agent fails with cause=unknown_agent', async ({ assert }) => {
    const outcome = await agentSelfModIntent({
      taskId: 't-2',
      payload: {
        agentName: 'ghost',
        changes: [{ path: 'SOUL.md', content: 'hi' }],
      },
    })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.cause, 'unknown_agent')
  })

  test('disallowed path fails with cause=invalid_payload', async ({ assert }) => {
    await seedAgent('coder')
    const outcome = await agentSelfModIntent({
      taskId: 't-3',
      payload: {
        agentName: 'coder',
        changes: [{ path: '../etc/passwd', content: 'root::0' }],
      },
    })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.cause, 'invalid_payload')
    assert.match(outcome.detail ?? '', /not allowed/)
  })

  test('empty changes array fails with cause=invalid_payload', async ({ assert }) => {
    const outcome = await agentSelfModIntent({
      taskId: 't-4',
      payload: { agentName: 'coder', changes: [] },
    })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.cause, 'invalid_payload')
  })

  test('no-change diff still records the modification (marked "no change")', async ({ assert }) => {
    await seedAgent('coder')
    const outcome = await agentSelfModIntent({
      taskId: 't-5',
      payload: {
        agentName: 'coder',
        changes: [{ path: 'TOOLS.yaml', content: 'allow: [github]' }],
      },
    })
    assert.equal(outcome.ok, true)
    const row = await AgentModification.query().where('task_id', 't-5').firstOrFail()
    assert.match(row.diff, /no change/)
  })
})

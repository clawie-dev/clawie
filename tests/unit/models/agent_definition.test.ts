import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import AgentDefinition from '#models/agent_definition'

test.group('models/agent_definition', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('round-trips persisted columns', async ({ assert }) => {
    const def = await AgentDefinition.create({
      name: 'analyst',
      soul: '# Analyst',
      agentsYaml: 'intents: []',
      toolsYaml: 'allow: []',
      sourcePath: '/Users/mark/agents/analyst',
      loadedAt: DateTime.utc(),
    })
    const reloaded = await AgentDefinition.findOrFail(def.id)
    assert.equal(reloaded.name, 'analyst')
    assert.equal(reloaded.sourcePath, '/Users/mark/agents/analyst')
  })

  test('name has unique constraint', async ({ assert }) => {
    await AgentDefinition.create({
      name: 'analyst',
      soul: '',
      agentsYaml: '',
      toolsYaml: '',
      sourcePath: '/a',
      loadedAt: DateTime.utc(),
    })
    await assert.rejects(() =>
      AgentDefinition.create({
        name: 'analyst',
        soul: '',
        agentsYaml: '',
        toolsYaml: '',
        sourcePath: '/b',
        loadedAt: DateTime.utc(),
      })
    )
  })
})

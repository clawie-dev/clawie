import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentLoader } from '#services/agent_loader'
import AgentDefinition from '#models/agent_definition'

function fixtureAgent(name: string, soul = '# Soul', agents = 'cron: []', tools = 'allow: []') {
  const dir = mkdtempSync(join(tmpdir(), 'clawie-agent-'))
  // Replace the random tmpdir basename with the desired agent name.
  const agentDir = join(dir, name)
  mkdirSync(agentDir)
  writeFileSync(join(agentDir, 'SOUL.md'), soul)
  writeFileSync(join(agentDir, 'AGENTS.yaml'), agents)
  writeFileSync(join(agentDir, 'TOOLS.yaml'), tools)
  return { agentDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test.group('services/agent_loader', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('loadFromDirectory creates a new AgentDefinition', async ({ assert }) => {
    const { agentDir, cleanup } = fixtureAgent('coder', '# coder soul')
    const { definition, isNew } = await new AgentLoader().loadFromDirectory(agentDir)
    cleanup()
    assert.isTrue(isNew)
    assert.equal(definition.name, 'coder')
    assert.equal(definition.soul, '# coder soul')
    assert.equal(definition.sourcePath, agentDir)
  })

  test('loadFromDirectory upserts an existing definition (isNew=false)', async ({ assert }) => {
    const first = fixtureAgent('marketer', '# v1')
    await new AgentLoader().loadFromDirectory(first.agentDir)
    first.cleanup()

    const second = fixtureAgent('marketer', '# v2')
    const { definition, isNew } = await new AgentLoader().loadFromDirectory(second.agentDir)
    second.cleanup()

    assert.isFalse(isNew)
    assert.equal(definition.soul, '# v2')
    const all = await AgentDefinition.query().where('name', 'marketer')
    assert.equal(all.length, 1)
  })

  test('directory name with a leading dot is rejected', async ({ assert }) => {
    const { agentDir, cleanup } = fixtureAgent('.hidden')
    await assert.rejects(
      () => new AgentLoader().loadFromDirectory(agentDir),
      /invalid agent directory/
    )
    cleanup()
  })

  test('missing required file raises ENOENT', async ({ assert }) => {
    const dir = mkdtempSync(join(tmpdir(), 'clawie-agent-bad-'))
    const agentDir = join(dir, 'broken')
    mkdirSync(agentDir)
    writeFileSync(join(agentDir, 'SOUL.md'), '# soul')
    // omit AGENTS.yaml and TOOLS.yaml
    await assert.rejects(() => new AgentLoader().loadFromDirectory(agentDir), /ENOENT/)
    rmSync(dir, { recursive: true, force: true })
  })
})

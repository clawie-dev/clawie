import { test } from '@japa/runner'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RulePackWriter } from '#services/egress/rule_pack_writer'

async function startFakeReload(reply: {
  status: number
  body: unknown
}): Promise<{ socketPath: string; close: () => Promise<void>; reloads: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'rulepack-'))
  const socketPath = join(dir, 'host.sock')
  let reloads = 0
  const server: Server = createServer((req, res) => {
    if (req.url === '/api/v1/rules/reload' && req.method === 'POST') {
      reloads++
    }
    res.writeHead(reply.status, { 'content-type': 'application/json' })
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return {
    socketPath,
    get reloads() {
      return reloads
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    },
  } as { socketPath: string; close: () => Promise<void>; reloads: number }
}

test.group('services/egress/rule_pack_writer', () => {
  test('writes YAML with team-scoped agent.name and triggers reload', async ({ assert }) => {
    const fake = await startFakeReload({
      status: 200,
      body: {
        success: true,
        data: { files_loaded: 1, rules_loaded: 2, warnings: [] },
      },
    })
    const rulesDir = mkdtempSync(join(tmpdir(), 'rules-'))
    try {
      const writer = new RulePackWriter({
        rulesDir,
        hostSocketPath: fake.socketPath,
      })
      const result = await writer.syncTeam({ teamSlug: 'engineering' })
      const yaml = readFileSync(result.filePath, 'utf8')
      assert.match(yaml, /agent.name == "clawie-engineering-chat"/)
      assert.match(yaml, /api.anthropic.com/)
      assert.match(yaml, /api.openai.com/)
      assert.equal(result.reloaded.rulesLoaded, 2)
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
      await fake.close()
    }
  })

  test('honors a custom allowedChatHosts list', async ({ assert }) => {
    const fake = await startFakeReload({
      status: 200,
      body: { success: true, data: { files_loaded: 1, rules_loaded: 1, warnings: [] } },
    })
    const rulesDir = mkdtempSync(join(tmpdir(), 'rules-'))
    try {
      const result = await new RulePackWriter({
        rulesDir,
        hostSocketPath: fake.socketPath,
      }).syncTeam({ teamSlug: 'support', allowedChatHosts: ['api.zendesk.com'] })
      const yaml = readFileSync(result.filePath, 'utf8')
      assert.match(yaml, /api.zendesk.com/)
      assert.notMatch(yaml, /api.anthropic.com/)
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
      await fake.close()
    }
  })

  test('gives hosts sharing a domain distinct rule ids', async ({ assert }) => {
    const fake = await startFakeReload({
      status: 200,
      body: { success: true, data: { files_loaded: 1, rules_loaded: 2, warnings: [] } },
    })
    const rulesDir = mkdtempSync(join(tmpdir(), 'rules-'))
    try {
      const result = await new RulePackWriter({
        rulesDir,
        hostSocketPath: fake.socketPath,
      }).syncTeam({
        teamSlug: 'support',
        allowedChatHosts: ['api.anthropic.com', 'eu.anthropic.com'],
      })
      const yaml = readFileSync(result.filePath, 'utf8')
      const ids = [...yaml.matchAll(/id: (\S+)/g)].map((m) => m[1])
      assert.deepEqual(ids, [
        'clawie-team-support-chat-api-anthropic-com',
        'clawie-team-support-chat-eu-anthropic-com',
      ])
      assert.equal(new Set(ids).size, ids.length)
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
      await fake.close()
    }
  })

  test('reload failure throws with the upstream body', async ({ assert }) => {
    const fake = await startFakeReload({
      status: 500,
      body: { success: false, error: 'rule engine borked' },
    })
    const rulesDir = mkdtempSync(join(tmpdir(), 'rules-'))
    try {
      const writer = new RulePackWriter({
        rulesDir,
        hostSocketPath: fake.socketPath,
      })
      await assert.rejects(() => writer.syncTeam({ teamSlug: 'engineering' }), /HTTP 500/)
    } finally {
      rmSync(rulesDir, { recursive: true, force: true })
      await fake.close()
    }
  })

  test('rejects invalid team slug', async ({ assert }) => {
    const writer = new RulePackWriter({})
    await assert.rejects(() => writer.syncTeam({ teamSlug: 'BAD SLUG' }), /invalid team slug/)
  })
})

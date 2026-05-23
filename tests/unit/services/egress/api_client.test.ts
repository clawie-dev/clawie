import { test } from '@japa/runner'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutcallApiClient } from '#services/egress/api_client'

/**
 * Verifies the wire format of `OutcallApiClient` against a fake
 * outcalld served over a Unix socket. No real daemon required.
 */

interface Reply {
  status: number
  body: unknown
}

async function startFake(routes: Map<string, () => Reply>): Promise<{
  socketPath: string
  server: Server
  close: () => Promise<void>
}> {
  const dir = mkdtempSync(join(tmpdir(), 'outcall-api-'))
  const socketPath = join(dir, 'host.sock')
  const server = createServer((req, res) => {
    const handler = routes.get(req.url ?? '')
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: 'no route' }))
      return
    }
    const r = handler()
    res.writeHead(r.status, { 'content-type': 'application/json' })
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return {
    socketPath,
    server,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test.group('services/egress/api_client', () => {
  test('bridgeStatus unwraps the envelope and returns the data', async ({ assert }) => {
    const fake = await startFake(
      new Map([
        [
          '/api/v1/bridge',
          () => ({
            status: 200,
            body: {
              success: true,
              data: { name: 'outcall0', up: true, index: 12, nftables_active: true },
            },
          }),
        ],
      ])
    )
    const client = new OutcallApiClient(fake.socketPath)
    const status = await client.bridgeStatus()
    await fake.close()
    assert.equal(status.name, 'outcall0')
    assert.isTrue(status.up)
    assert.equal(status.index, 12)
  })

  test('rulesList returns the array data', async ({ assert }) => {
    const fake = await startFake(
      new Map([
        [
          '/api/v1/rules',
          () => ({
            status: 200,
            body: {
              success: true,
              data: [
                {
                  id: 'clawie-chat-anthropic',
                  file: '/etc/outcall/rules.d/clawie-default.yaml',
                  action: 'allow',
                  condition_preview: 'agent.name == "clawie-chat"',
                  description: 'Clawie chat: anthropic',
                },
              ],
            },
          }),
        ],
      ])
    )
    const client = new OutcallApiClient(fake.socketPath)
    const rules = await client.rulesList()
    await fake.close()
    assert.equal(rules.length, 1)
    assert.equal(rules[0].action, 'allow')
  })

  test('proxyStatus returns connection counters', async ({ assert }) => {
    const fake = await startFake(
      new Map([
        [
          '/api/v1/proxy',
          () => ({
            status: 200,
            body: {
              success: true,
              data: {
                running: true,
                listen_address: '10.200.0.1:8080',
                proxy_url: 'http://10.200.0.1:8080',
                active_connections: 3,
                total_requests: 142,
                total_blocked: 17,
              },
            },
          }),
        ],
      ])
    )
    const client = new OutcallApiClient(fake.socketPath)
    const proxy = await client.proxyStatus()
    await fake.close()
    assert.equal(proxy.total_blocked, 17)
    assert.equal(proxy.proxy_url, 'http://10.200.0.1:8080')
  })

  test('non-200 status throws with the response body', async ({ assert }) => {
    const fake = await startFake(
      new Map([
        ['/api/v1/bridge', () => ({ status: 500, body: { success: false, error: 'boom' } })],
      ])
    )
    const client = new OutcallApiClient(fake.socketPath)
    await assert.rejects(() => client.bridgeStatus(), /HTTP 500/)
    await fake.close()
  })

  test('success=false in the envelope throws the error string', async ({ assert }) => {
    const fake = await startFake(
      new Map([
        [
          '/api/v1/rules',
          () => ({ status: 200, body: { success: false, error: 'no rules loaded' } }),
        ],
      ])
    )
    const client = new OutcallApiClient(fake.socketPath)
    await assert.rejects(() => client.rulesList(), /no rules loaded/)
    await fake.close()
  })

  test('unreachable socket surfaces a connect-refused error', async ({ assert }) => {
    const client = new OutcallApiClient('/tmp/no-such-outcall-test.sock')
    await assert.rejects(() => client.bridgeStatus(), /ENOENT|ECONNREFUSED|cannot reach/)
  })
})

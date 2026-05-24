import { test } from '@japa/runner'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { OutcallEgressProvider } from '#services/egress/outcall_provider'
import type { SpawnRequest } from '#services/container_spawner'

/**
 * Spin a fake outcalld over a Unix socket in a temp dir, then drive
 * the OutcallEgressProvider against it. This avoids any dependency on
 * a real daemon (and on Linux at all).
 */

interface FakeRoute {
  match: (method: string, url: string) => boolean
  reply: (body: string) => { status: number; body: string }
}

async function startFakeDaemon(routes: FakeRoute[]): Promise<{
  socketPath: string
  server: Server
  close: () => Promise<void>
  calls: Array<{ method: string; url: string; body: string }>
}> {
  const dir = mkdtempSync(join(tmpdir(), 'outcall-test-'))
  const socketPath = join(dir, 'host.sock')
  const calls: Array<{ method: string; url: string; body: string }> = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      calls.push({ method: req.method ?? '', url: req.url ?? '', body })
      const route = routes.find((r) => r.match(req.method ?? '', req.url ?? ''))
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'no route' }))
        return
      }
      const r = route.reply(body)
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(r.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return {
    socketPath,
    server,
    calls,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function bridgeOk(name = 'outcall0'): FakeRoute {
  return {
    match: (m, u) => m === 'GET' && u === '/api/v1/bridge',
    reply: () => ({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: { name, up: true, index: 12, nftables_active: true },
      }),
    }),
  }
}

function networkCreateOk(created = true): FakeRoute {
  return {
    match: (m, u) => m === 'POST' && u === '/api/v1/network/create',
    reply: () => ({
      status: 200,
      body: JSON.stringify({
        success: true,
        data: { network_id: 'fake-id', name: 'outcall-clawie', created },
      }),
    }),
  }
}

test.group('services/egress/outcall_provider', () => {
  test('bootstrap probes bridge then creates network, returns ok', async ({ assert }) => {
    const fake = await startFakeDaemon([bridgeOk(), networkCreateOk(true)])
    const provider = new OutcallEgressProvider({
      hostSocketPath: fake.socketPath,
      networkName: 'clawie',
    })
    const result = await provider.bootstrap()
    await fake.close()
    assert.deepEqual(result, { ok: true })
    assert.equal(fake.calls.length, 2)
    assert.equal(fake.calls[0].url, '/api/v1/bridge')
    assert.equal(fake.calls[1].url, '/api/v1/network/create')
    assert.deepEqual(JSON.parse(fake.calls[1].body), { name: 'clawie' })
  })

  test('bootstrap fails when bridge is down', async ({ assert }) => {
    const fake = await startFakeDaemon([
      {
        match: (m, u) => m === 'GET' && u === '/api/v1/bridge',
        reply: () => ({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: { name: 'x', up: false, index: null, nftables_active: false },
          }),
        }),
      },
    ])
    const provider = new OutcallEgressProvider({ hostSocketPath: fake.socketPath })
    const result = await provider.bootstrap()
    await fake.close()
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /bridge not ready/)
  })

  test('bootstrap fails when socket is unreachable', async ({ assert }) => {
    const provider = new OutcallEgressProvider({
      hostSocketPath: '/tmp/does-not-exist-outcall-test.sock',
    })
    const result = await provider.bootstrap()
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /cannot reach outcalld/)
  })

  test('wrap attaches the agent to outcall-<network> and injects HTTP(S)_PROXY', async ({
    assert,
  }) => {
    const provider = new OutcallEgressProvider({
      networkName: 'clawie',
      gateway: '10.200.0.1',
    })
    const base: SpawnRequest = {
      image: 'clawie/agent-runtime:0.4.1',
      spec: { intent: 'chat', task_id: 't', payload: null },
      network: 'bridge',
      env: { ANTHROPIC_API_KEY: 'sk-test' },
    }
    const wrapped = await provider.wrap(base, { intentName: 'chat' })
    assert.equal(wrapped.customNetworkName, 'outcall-clawie')
    assert.equal(wrapped.env?.HTTP_PROXY, 'http://10.200.0.1:8080')
    assert.equal(wrapped.env?.HTTPS_PROXY, 'http://10.200.0.1:8080')
    // existing env preserved
    assert.equal(wrapped.env?.ANTHROPIC_API_KEY, 'sk-test')
    // --dns + --name in extraArgs
    assert.include(wrapped.extraArgs ?? [], '--dns')
    assert.include(wrapped.extraArgs ?? [], '10.200.0.1')
    const nameIdx = (wrapped.extraArgs ?? []).indexOf('--name')
    assert.notEqual(nameIdx, -1)
    assert.match((wrapped.extraArgs ?? [])[nameIdx + 1] ?? '', /^clawie-chat-[0-9]{8}$/)
  })

  test('wrap mounts agent socket when mountAgentSocket is set', async ({ assert }) => {
    const provider = new OutcallEgressProvider({ mountAgentSocket: true })
    const wrapped = await provider.wrap(
      {
        image: 'clawie/agent-runtime:0.4.1',
        spec: { intent: 'chat', task_id: 't', payload: null },
      },
      { intentName: 'chat' }
    )
    const args = wrapped.extraArgs ?? []
    const volIdx = args.indexOf('-v')
    assert.notEqual(volIdx, -1)
    assert.equal(args[volIdx + 1], '/run/outcall/agent.sock:/run/outcall/agent.sock')
  })

  test('wrap honors teamSlug: per-team network + name prefix', async ({ assert }) => {
    const provider = new OutcallEgressProvider({ networkName: 'clawie' })
    const wrapped = await provider.wrap(
      {
        image: 'clawie/agent-runtime:0.4.1',
        spec: { intent: 'chat', task_id: 't', payload: null },
      },
      { intentName: 'chat', teamSlug: 'engineering' }
    )
    assert.equal(wrapped.customNetworkName, 'outcall-clawie-team-engineering')
    const args = wrapped.extraArgs ?? []
    const nameIdx = args.indexOf('--name')
    assert.notEqual(nameIdx, -1)
    assert.match(args[nameIdx + 1] ?? '', /^clawie-engineering-chat-[0-9]{8}$/)
  })

  test('wrap without teamSlug uses base network + base name', async ({ assert }) => {
    const provider = new OutcallEgressProvider({ networkName: 'clawie' })
    const wrapped = await provider.wrap(
      {
        image: 'clawie/agent-runtime:0.4.1',
        spec: { intent: 'chat', task_id: 't', payload: null },
      },
      { intentName: 'chat' }
    )
    assert.equal(wrapped.customNetworkName, 'outcall-clawie')
    const args = wrapped.extraArgs ?? []
    const nameIdx = args.indexOf('--name')
    assert.match(args[nameIdx + 1] ?? '', /^clawie-chat-[0-9]{8}$/)
  })

  test('wrap with no mountAgentSocket leaves no -v mount', async ({ assert }) => {
    const provider = new OutcallEgressProvider({})
    const wrapped = await provider.wrap(
      {
        image: 'clawie/agent-runtime:0.4.1',
        spec: { intent: 'chat', task_id: 't', payload: null },
      },
      { intentName: 'chat' }
    )
    assert.notInclude(wrapped.extraArgs ?? [], '-v')
  })
})

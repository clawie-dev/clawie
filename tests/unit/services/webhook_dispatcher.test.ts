import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { createHmac } from 'node:crypto'
import WebhookSubscription from '#models/webhook_subscription'
import AuditEvent from '#models/audit_event'
import { WebhookDispatcher } from '#services/webhook_dispatcher'

async function seedSub(
  pattern: string,
  url = 'http://example.test/hook',
  secret: string | null = null
) {
  return WebhookSubscription.create({
    name: `sub-${Math.random().toString(36).slice(2, 8)}`,
    url,
    eventPattern: pattern,
    secret,
    enabled: true,
    createdAt: DateTime.utc(),
  })
}

const sampleEvent = {
  id: 1,
  actor: 'system',
  action: 'task.completed',
  subjectKind: 'task',
  subjectId: 'abc',
  outcome: 'success',
  reason: null,
  details: { result: 'hi' },
  createdAt: '2026-05-23T00:00:00Z',
}

test.group('services/webhook_dispatcher', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('dispatches to matching subscriptions only', async ({ assert }) => {
    await seedSub('task.*')
    await seedSub('approval.*') // shouldn't match
    let fetchCalls = 0
    const dispatcher = new WebhookDispatcher({
      fetchImpl: (async () => {
        fetchCalls++
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    })
    const attempts = await dispatcher.dispatch(sampleEvent)
    assert.equal(attempts, 1)
    assert.equal(fetchCalls, 1)
  })

  test('emits HMAC signature header when secret is set', async ({ assert }) => {
    await seedSub('*', 'http://example.test/hook', 'shh')
    let capturedHeaders: Record<string, string> = {}
    const dispatcher = new WebhookDispatcher({
      fetchImpl: (async (_url: string, init: RequestInit) => {
        const h = new Headers(init.headers as Record<string, string>)
        h.forEach((v, k) => {
          capturedHeaders[k] = v
        })
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    })
    await dispatcher.dispatch(sampleEvent)
    assert.exists(capturedHeaders['x-clawie-signature'])
    const expected = createHmac('sha256', 'shh').update(JSON.stringify(sampleEvent)).digest('hex')
    assert.equal(capturedHeaders['x-clawie-signature'], `sha256=${expected}`)
  })

  test('non-2xx response is audited as delivery_failed', async ({ assert }) => {
    await seedSub('*')
    const dispatcher = new WebhookDispatcher({
      fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
    })
    await dispatcher.dispatch(sampleEvent)
    const audit = await AuditEvent.query().where('action', 'webhook.delivery_failed').first()
    assert.exists(audit)
    assert.equal(audit?.outcome, 'failure')
  })

  test('fetch throw is caught and audited', async ({ assert }) => {
    await seedSub('*')
    const dispatcher = new WebhookDispatcher({
      fetchImpl: (async () => {
        throw new Error('connection refused')
      }) as unknown as typeof fetch,
    })
    await dispatcher.dispatch(sampleEvent)
    const audit = await AuditEvent.query().where('action', 'webhook.delivery_failed').first()
    assert.exists(audit)
    assert.match(audit?.reason ?? '', /connection refused/)
  })

  test('disabled subscriptions are skipped', async ({ assert }) => {
    const s = await seedSub('*')
    s.enabled = false
    await s.save()
    let fetchCalls = 0
    const dispatcher = new WebhookDispatcher({
      fetchImpl: (async () => {
        fetchCalls++
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    })
    await dispatcher.dispatch(sampleEvent)
    assert.equal(fetchCalls, 0)
  })

  test('no subscriptions = no attempts, no error', async ({ assert }) => {
    const dispatcher = new WebhookDispatcher({
      fetchImpl: (async () => new Response('ok')) as unknown as typeof fetch,
    })
    const attempts = await dispatcher.dispatch(sampleEvent)
    assert.equal(attempts, 0)
  })
})

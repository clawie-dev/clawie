import { createHmac } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import WebhookSubscription from '#models/webhook_subscription'
import { auditLogger } from '#services/audit_logger'

/**
 * Phase 10 outbound webhooks. Best-effort POST to each enabled
 * subscription whose `event_pattern` matches the given audit action.
 *
 *   body    : the audit event row serialised as JSON
 *   headers : content-type=application/json,
 *             x-clawie-event=<action>,
 *             x-clawie-signature=sha256=<hex> when secret is set
 *
 * v1.0 ships single-attempt delivery; retry/backoff is queued for a
 * v1.x patch. Each attempt logs + audits its outcome (`webhook.delivered`
 * / `webhook.delivery_failed`).
 *
 * The dispatcher takes a `fetchImpl` so tests can inject a stub.
 */

export interface AuditEventLike {
  id: number
  actor: string
  action: string
  subjectKind: string | null
  subjectId: string | null
  outcome: string
  reason: string | null
  details: unknown
  createdAt: string
}

type FetchFn = typeof fetch

export interface WebhookDispatcherOptions {
  fetchImpl?: FetchFn
  timeoutMs?: number
}

export class WebhookDispatcher {
  private readonly fetchImpl: FetchFn
  private readonly timeoutMs: number

  constructor(opts: WebhookDispatcherOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? 5_000
  }

  /**
   * Dispatch one audit event to all matching subscriptions. Returns
   * the count of delivery attempts. Failures don't propagate; they're
   * logged + audited.
   */
  async dispatch(event: AuditEventLike): Promise<number> {
    const subs = await WebhookSubscription.query().where('enabled', true)
    const matching = subs.filter((s) => s.matches(event.action))
    if (matching.length === 0) return 0

    const body = JSON.stringify(event)
    let attempts = 0
    for (const sub of matching) {
      attempts++
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-clawie-event': event.action,
      }
      if (sub.secret) {
        const sig = createHmac('sha256', sub.secret).update(body).digest('hex')
        headers['x-clawie-signature'] = `sha256=${sig}`
      }
      try {
        const res = await Promise.race([
          this.fetchImpl(sub.url, { method: 'POST', headers, body }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('webhook timeout')), this.timeoutMs)
          ),
        ])
        await auditLogger().record({
          actor: 'webhook_dispatcher',
          action: res.ok ? 'webhook.delivered' : 'webhook.delivery_failed',
          subjectKind: 'webhook_subscription',
          subjectId: String(sub.id),
          outcome: res.ok ? 'success' : 'failure',
          reason: res.ok ? null : `HTTP ${res.status}`,
          details: { subscription: sub.name, status: res.status, event: event.action },
        })
        if (!res.ok) {
          logger.warn({ sub: sub.name, status: res.status }, 'webhook delivery non-2xx')
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        await auditLogger().record({
          actor: 'webhook_dispatcher',
          action: 'webhook.delivery_failed',
          subjectKind: 'webhook_subscription',
          subjectId: String(sub.id),
          outcome: 'failure',
          reason: detail,
          details: { subscription: sub.name, event: event.action },
        })
        logger.warn({ sub: sub.name, err: detail }, 'webhook delivery threw')
      }
    }
    return attempts
  }
}

let cachedInstance: WebhookDispatcher | null = null
export function webhookDispatcher(): WebhookDispatcher {
  if (!cachedInstance) cachedInstance = new WebhookDispatcher()
  return cachedInstance
}

export function setWebhookDispatcherForTest(d: WebhookDispatcher | null): void {
  cachedInstance = d
}

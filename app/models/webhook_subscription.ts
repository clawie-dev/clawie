import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Phase 10: outbound webhooks. A subscription matches audit events
 * by `event_pattern` (exact name, prefix-glob like `task.*`, or `*`)
 * and POSTs the event to `url`. When `secret` is set, the request
 * carries an `x-clawie-signature` header with `sha256=<hex>` HMAC over
 * the body.
 *
 * Delivery is best-effort: failures are logged + audited but not
 * retried in v1.0. Retry/backoff lands in a v1.x patch (spec 030).
 */
export default class WebhookSubscription extends BaseModel {
  static table = 'webhook_subscriptions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare url: string

  @column()
  declare eventPattern: string

  @column()
  declare secret: string | null

  @column()
  declare enabled: boolean

  @column.dateTime()
  declare createdAt: DateTime

  /**
   * Returns true if this subscription's pattern matches an event action.
   * Patterns:
   *   '*'           matches anything
   *   'task.*'      prefix glob (must end with `.*`)
   *   'task.failed' exact match
   */
  matches(action: string): boolean {
    if (this.eventPattern === '*') return true
    if (this.eventPattern.endsWith('.*')) {
      const prefix = this.eventPattern.slice(0, -1) // 'task.'
      return action.startsWith(prefix)
    }
    return action === this.eventPattern
  }
}

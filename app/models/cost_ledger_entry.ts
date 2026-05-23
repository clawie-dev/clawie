import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Phase 3 cost ledger. One row per LLM call. The dispatch layer writes
 * here when a containerized intent returns a `cost` field in its
 * envelope output. USD is stored as integer tenths of a cent
 * (`usd_tenths_of_cent`) so we can sum without float rounding drift.
 *
 * Helpers: `entry.dollars` and `entry.cents` reconstruct human-readable
 * values for display.
 */
export default class CostLedgerEntry extends BaseModel {
  static table = 'cost_ledger'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare taskId: string

  @column()
  declare provider: string

  @column()
  declare model: string

  @column()
  declare inputTokens: number

  @column()
  declare outputTokens: number

  @column()
  declare usdTenthsOfCent: number

  @column()
  declare costUnknown: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  get usdCents(): number {
    return this.usdTenthsOfCent / 10
  }

  get usdDollars(): number {
    return this.usdTenthsOfCent / 1000
  }
}

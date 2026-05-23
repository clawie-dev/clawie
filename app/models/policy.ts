import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type PolicyDecision = 'allow' | 'deny' | 'requires_approval'

/**
 * Phase 4 policy rules. The engine consults these in priority order
 * (highest first) when deciding whether a task may run, must wait for
 * approval, or must be denied outright. An empty table means strict
 * default-deny — every task lands in `requires_approval`.
 *
 * `predicates` is a JSON object of `{ path: expected }` exact-match
 * predicates against the task payload. Empty object = match-any.
 * Phase 4 keeps matching deliberately simple — no regex, no ranges;
 * spec 003 hardens this.
 */
export default class Policy extends BaseModel {
  static table = 'policies'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare intentPattern: string

  @column()
  declare predicates: string

  @column()
  declare decision: PolicyDecision

  @column()
  declare priority: number

  @column()
  declare createdBy: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  get parsedPredicates(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(this.predicates)
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type AuditOutcome = 'success' | 'failure' | 'pending' | 'denied'

export default class AuditEvent extends BaseModel {
  static table = 'audit_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare actor: string

  @column()
  declare action: string

  @column()
  declare subjectKind: string | null

  @column()
  declare subjectId: string | null

  @column()
  declare outcome: AuditOutcome

  @column()
  declare reason: string | null

  @column()
  declare details: string | null

  @column()
  declare prevHash: string | null

  @column()
  declare hash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  get parsedDetails(): unknown {
    if (this.details === null || this.details === undefined) return null
    try {
      return JSON.parse(this.details)
    } catch {
      return this.details
    }
  }
}

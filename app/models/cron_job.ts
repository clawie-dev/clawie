import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Phase 9: scheduled task creator. Each row is a recurring job: when
 * the scheduler ticks past `nextRunAt`, the job fires (creates a task
 * from `intent` + `payloadTemplate`), `lastRunAt` is set to the firing
 * time, and `nextRunAt` advances to the next match of `cronExpression`.
 *
 * The cron expression uses the 5-field standard form (minute hour
 * day-of-month month day-of-week). Parsing lives in
 * `app/services/cron.ts` so we can swap the parser without a model
 * migration.
 */
export default class CronJob extends BaseModel {
  static table = 'cron_jobs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare cronExpression: string

  @column()
  declare intent: string

  @column({ columnName: 'payload_template' })
  declare payloadTemplate: string

  @column()
  declare teamSlug: string | null

  @column()
  declare enabled: boolean

  @column.dateTime()
  declare lastRunAt: DateTime | null

  @column.dateTime()
  declare nextRunAt: DateTime

  @column()
  declare lastTaskId: string | null

  @column.dateTime()
  declare createdAt: DateTime

  get parsedPayload(): unknown {
    try {
      return JSON.parse(this.payloadTemplate)
    } catch {
      return null
    }
  }
}

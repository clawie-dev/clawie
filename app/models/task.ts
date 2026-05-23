import { BaseModel, column, beforeCreate } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'

export type TaskStatus =
  | 'approval_pending'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'timed_out'

export const TERMINAL_STATUSES: ReadonlyArray<TaskStatus> = [
  'completed',
  'failed',
  'aborted',
  'timed_out',
]

export default class Task extends BaseModel {
  static table = 'tasks'
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @column()
  declare idempotencyKey: string | null

  @column()
  declare intent: string

  @column()
  declare payload: string

  @column()
  declare status: TaskStatus

  @column()
  declare claimedBy: string | null

  @column.dateTime()
  declare claimExpiresAt: DateTime | null

  @column()
  declare result: string | null

  @column()
  declare failureCause: string | null

  @column()
  declare failureDetail: string | null

  @column()
  declare version: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare finishedAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @beforeCreate()
  static assignId(task: Task) {
    if (!task.id) {
      task.id = randomUUID()
    }
    if (task.version === undefined || task.version === null) {
      task.version = 0
    }
    if (!task.status) {
      task.status = 'queued'
    }
  }

  get parsedPayload(): unknown {
    try {
      return JSON.parse(this.payload)
    } catch {
      return this.payload
    }
  }

  get parsedResult(): unknown {
    if (this.result === null || this.result === undefined) return null
    try {
      return JSON.parse(this.result)
    } catch {
      return this.result
    }
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.includes(this.status)
  }
}

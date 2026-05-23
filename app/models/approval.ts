import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

/**
 * Phase 4 approval row. Created when the policy engine returns
 * `requires_approval`. One-to-one with the task (enforced by the
 * unique index on `task_id`).
 *
 * `deadline_at` is the decision window. A worker job
 * (`approvals:sweep`) marks past-deadline rows `expired` and fails the
 * matching task with cause `approval_expired`.
 */
export default class Approval extends BaseModel {
  static table = 'approvals'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare taskId: string

  @column()
  declare status: ApprovalStatus

  @column.dateTime()
  declare requestedAt: DateTime

  @column.dateTime()
  declare deadlineAt: DateTime

  @column()
  declare decidedBy: string | null

  @column.dateTime()
  declare decidedAt: DateTime | null

  @column()
  declare reason: string | null
}

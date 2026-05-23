import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type AgentModificationStatus = 'pending' | 'applied' | 'rejected'

/**
 * Phase 7: a proposed change to an agent's files, surfaced as a row
 * an operator approves or rejects. Tied 1:1 to the task that produced
 * it (the `agent.self_mod` intent), so the existing Phase 4 approval
 * flow can govern the same way it governs any other intent.
 *
 * The `diff` field is a unified diff for human review in the
 * dashboard. The `proposedChanges` field is the structured form the
 * apply step uses; if both diverge, the structured form wins (the
 * diff is human-friendly only).
 */
export default class AgentModification extends BaseModel {
  static table = 'agent_modifications'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare agentName: string

  @column()
  declare taskId: string

  @column()
  declare status: AgentModificationStatus

  @column()
  declare diff: string

  @column({ columnName: 'proposed_changes' })
  declare proposedChanges: string

  @column()
  declare decidedBy: string | null

  @column.dateTime()
  declare decidedAt: DateTime | null

  @column()
  declare reason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  get parsedChanges(): Array<{ path: string; content: string }> {
    try {
      const parsed = JSON.parse(this.proposedChanges)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
}

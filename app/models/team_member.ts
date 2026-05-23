import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type TeamRole = 'member' | 'lead'

/**
 * Phase 8: agent ↔ team association. An agent can be in multiple
 * teams; a team has many agents. The (team_id, agent_name) pair is
 * unique. `role` is a soft label for Phase 8b ergonomics (lead can
 * approve more rule classes); Phase 8 just persists it.
 */
export default class TeamMember extends BaseModel {
  static table = 'team_members'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare teamId: number

  @column()
  declare agentName: string

  @column()
  declare role: TeamRole

  @column.dateTime()
  declare addedAt: DateTime
}

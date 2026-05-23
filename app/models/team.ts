import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Phase 8: a Team groups agents that share an Outcall network, a
 * budget, and an approval queue. Slug is the dimension Outcall sees
 * (`outcall-clawie-team-<slug>`); name is what humans read.
 *
 * Cross-team isolation is structural in Outcall mode: each team gets
 * its own Docker network, so a hostile agent in Team A cannot reach
 * Team B's agents at L2/L3 even if rules were misconfigured.
 */
export default class Team extends BaseModel {
  static table = 'teams'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare slug: string

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column.dateTime()
  declare createdAt: DateTime
}

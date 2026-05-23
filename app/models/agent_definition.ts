import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Phase 7: an agent is a tuple of three files on disk. The loader
 * reads them and upserts a row here. Phase 8 (teams) will reference
 * AgentDefinition by name; Phase 9 (scheduler) will use AGENTS.yaml's
 * cron blocks. For Phase 7 this is just a snapshot model.
 *
 * The raw file contents are kept verbatim; parsing into structured
 * fields happens in `app/services/agent_loader.ts` so we can rev the
 * parser without re-reading from disk.
 */
export default class AgentDefinition extends BaseModel {
  static table = 'agents'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare soul: string

  @column({ columnName: 'agents_yaml' })
  declare agentsYaml: string

  @column({ columnName: 'tools_yaml' })
  declare toolsYaml: string

  @column()
  declare sourcePath: string

  @column.dateTime()
  declare loadedAt: DateTime
}

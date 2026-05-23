import { BaseCommand, flags, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace teams:create <slug> --name '<name>' --description '<text>'`
 * Slug becomes the Outcall network suffix; it must be URL/DNS safe.
 */
export default class TeamsCreate extends BaseCommand {
  static commandName = 'teams:create'
  static description = 'Create a team. Slug becomes the per-team Outcall network suffix.'
  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({ description: 'Team slug (DNS-safe; used in network name)' })
  declare slug: string

  @flags.string({ description: 'Human-readable team name (defaults to slug)' })
  declare name?: string

  @flags.string({ description: 'Description' })
  declare description?: string

  async run() {
    const { DateTime } = await import('luxon')
    const { default: Team } = await import('#models/team')
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(this.slug)) {
      this.logger.error('slug must match ^[a-z0-9][a-z0-9-]{0,62}$ (DNS-safe)')
      this.exitCode = 1
      return
    }
    const existing = await Team.query().where('slug', this.slug).first()
    if (existing) {
      this.logger.warning(`team "${this.slug}" already exists (id=${existing.id})`)
      return
    }
    const team = await Team.create({
      slug: this.slug,
      name: this.name ?? this.slug,
      description: this.description ?? null,
      createdAt: DateTime.utc(),
    })
    this.logger.success(`created team "${team.slug}" (id=${team.id})`)
  }
}

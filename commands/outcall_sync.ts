import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace outcall:sync --team <slug>` writes the per-team rule pack
 * to /etc/outcall/rules.d/clawie-team-<slug>.yaml and asks the daemon
 * to reload. Idempotent.
 */
export default class OutcallSync extends BaseCommand {
  static commandName = 'outcall:sync'
  static description = "Sync a team's Outcall rule pack to the daemon and reload"
  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Team slug to sync (matches a row in `teams`)' })
  declare team: string

  @flags.string({
    description: "Comma-separated hosts the team's chat intent may reach",
  })
  declare hosts?: string

  async run() {
    if (!this.team) {
      this.logger.error('--team is required')
      this.exitCode = 1
      return
    }
    const { default: Team } = await import('#models/team')
    const team = await Team.query().where('slug', this.team).first()
    if (!team) {
      this.logger.error(`no team with slug "${this.team}". Run teams:create first.`)
      this.exitCode = 1
      return
    }
    const { RulePackWriter } = await import('#services/egress/rule_pack_writer')
    const allowedChatHosts = this.hosts
      ? this.hosts
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : undefined
    try {
      const result = await new RulePackWriter().syncTeam({
        teamSlug: team.slug,
        allowedChatHosts,
      })
      this.logger.success(
        `wrote ${result.filePath} (${result.bytesWritten} bytes); reloaded ${result.reloaded.rulesLoaded} rule(s)`
      )
      if (result.reloaded.warnings.length > 0) {
        this.logger.warning(`warnings: ${result.reloaded.warnings.join('; ')}`)
      }
    } catch (err) {
      this.logger.error((err as Error).message)
      this.exitCode = 1
    }
  }
}

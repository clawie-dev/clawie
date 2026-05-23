import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace scheduler:tick` — one scheduler iteration. Fires due
 * cron jobs and sweeps expired approvals. Intended for a host cron
 * running every minute.
 */
export default class SchedulerTick extends BaseCommand {
  static commandName = 'scheduler:tick'
  static description = 'Run one scheduler iteration: fire due cron jobs + sweep expired approvals'
  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const { scheduler } = await import('#services/scheduler')
    const result = await scheduler().tick()
    this.logger.success(
      `tick: fired ${result.firedJobs} job(s), expired ${result.approvalsExpired} approval(s)`
    )
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        this.logger.error(`job ${e.jobName}: ${e.error}`)
      }
      this.exitCode = 1
    }
  }
}

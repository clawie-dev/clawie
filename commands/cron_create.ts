import { BaseCommand, flags, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace cron:create <name> --schedule '5 * * * *' --intent echo \
 *    --payload '"hello"' [--team engineering]`
 */
export default class CronCreate extends BaseCommand {
  static commandName = 'cron:create'
  static description = 'Create a recurring cron job that creates tasks on schedule'
  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({ description: 'Job name (unique)' })
  declare name: string

  @flags.string({ description: '5-field cron expression: "min hour dom mon dow"' })
  declare schedule: string

  @flags.string({ description: 'Intent name (e.g. echo, chat)' })
  declare intent: string

  @flags.string({ description: 'Payload as JSON string', default: 'null' })
  declare payload: string

  @flags.string({ description: 'Team slug to scope the task to' })
  declare team?: string

  async run() {
    if (!this.name || !this.schedule || !this.intent) {
      this.logger.error('name argument and --schedule, --intent flags are required')
      this.exitCode = 1
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(this.payload)
    } catch (err) {
      this.logger.error(`invalid --payload JSON: ${(err as Error).message}`)
      this.exitCode = 1
      return
    }

    const { DateTime } = await import('luxon')
    const { default: CronJob } = await import('#models/cron_job')
    const { nextFiring } = await import('#services/cron')

    const now = DateTime.utc()
    let next: ReturnType<typeof nextFiring>
    try {
      next = nextFiring(this.schedule, now)
    } catch (err) {
      this.logger.error(`invalid --schedule: ${(err as Error).message}`)
      this.exitCode = 1
      return
    }

    const existing = await CronJob.query().where('name', this.name).first()
    if (existing) {
      this.logger.warning(`job "${this.name}" already exists (id=${existing.id})`)
      return
    }

    const job = await CronJob.create({
      name: this.name,
      cronExpression: this.schedule,
      intent: this.intent,
      payloadTemplate: JSON.stringify(payload),
      teamSlug: this.team ?? null,
      enabled: true,
      lastRunAt: null,
      nextRunAt: next,
      lastTaskId: null,
      createdAt: now,
    })
    this.logger.success(`created cron job "${job.name}" (next: ${job.nextRunAt.toISO()})`)
  }
}

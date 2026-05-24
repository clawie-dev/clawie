import { BaseCommand, flags } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace task:queue` — list approvals (default: pending). Useful as
 * the operator's everyday view of "what needs me right now".
 */
export default class TaskQueue extends BaseCommand {
  static commandName = 'task:queue'
  static description = 'List approvals; default shows pending'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Status filter (pending | approved | denied | expired)' })
  declare status?: string

  @flags.boolean({ description: 'JSON output' })
  declare json: boolean

  async run() {
    const { default: Approval } = await import('#models/approval')
    const status = this.status ?? 'pending'
    const rows = await Approval.query()
      .where('status', status)
      .orderBy('requested_at', 'asc')
      .limit(200)

    const summary = rows.map((a) => ({
      taskId: a.taskId,
      status: a.status,
      requestedAt: a.requestedAt?.toISO?.() ?? null,
      deadlineAt: a.deadlineAt?.toISO?.() ?? null,
      decidedBy: a.decidedBy,
    }))

    if (this.json) {
      this.logger.log(JSON.stringify(summary, null, 2))
      return
    }
    if (rows.length === 0) {
      this.logger.info(`no ${status} approvals`)
      return
    }
    for (const row of summary) {
      this.logger.log(
        `${row.taskId}  ${row.status}  requested=${row.requestedAt}  deadline=${row.deadlineAt}`
      )
    }
  }
}

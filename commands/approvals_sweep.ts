import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace approvals:sweep` — expire pending approvals whose deadline
 * has passed. Marks the matching tasks `failed` with cause
 * `approval_expired`. Intended for the scheduler in Phase 9; the
 * command exists now so operators can run it on demand.
 */
export default class ApprovalsSweep extends BaseCommand {
  static commandName = 'approvals:sweep'
  static description = 'Mark past-deadline approvals as expired and fail their tasks'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const { taskStateMachine } = await import('#services/task_state_machine')
    const expired = await taskStateMachine().expirePastDeadlines()
    if (expired === 0) {
      this.logger.info('no expired approvals')
      return
    }
    this.logger.success(`expired ${expired} approval${expired === 1 ? '' : 's'}`)
  }
}

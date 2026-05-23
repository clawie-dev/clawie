import { BaseCommand, flags } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace task:approve --id <taskId> --decision approve|deny --reason '<text>'`
 * → moves a task out of approval_pending. On approve, the task is
 *   immediately executed and the result is printed.
 */
export default class TaskApprove extends BaseCommand {
  static commandName = 'task:approve'
  static description = 'Approve or deny a task waiting in approval_pending'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Task id (UUID)' })
  declare id: string

  @flags.string({
    description: 'Decision: approve | deny',
    default: 'approve',
  })
  declare decision: string

  @flags.string({ description: 'Optional reason logged with the decision' })
  declare reason?: string

  async run() {
    if (!this.id) {
      this.logger.error('--id is required')
      this.exitCode = 1
      return
    }
    if (this.decision !== 'approve' && this.decision !== 'deny') {
      this.logger.error(`--decision must be "approve" or "deny" (got "${this.decision}")`)
      this.exitCode = 1
      return
    }

    const { taskStateMachine } = await import('#services/task_state_machine')
    const { taskExecutor } = await import('#services/task_executor')

    try {
      const task =
        this.decision === 'approve'
          ? await taskStateMachine().approve(this.id, 'cli', this.reason ?? null)
          : await taskStateMachine().denyApproval(this.id, 'cli', this.reason ?? null)

      if (this.decision === 'approve' && task.status === 'queued') {
        const finished = await taskExecutor().execute(task.id, 'cli')
        this.logger.success(`task ${finished.id} approved → ${finished.status}`)
        if (finished.status === 'completed') {
          this.logger.log(`  result: ${JSON.stringify(finished.parsedResult)}`)
        }
        if (finished.status !== 'completed') this.exitCode = 1
        return
      }
      this.logger.success(`task ${task.id} → ${task.status}`)
    } catch (err) {
      this.logger.error((err as Error).message)
      this.exitCode = 1
    }
  }
}

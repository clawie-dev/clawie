import { BaseCommand, flags } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace task:run --intent echo --payload '"world"'`
 * → creates a durable task, drives it through the state machine,
 *   prints the result as JSON. Built-in intents execute inside the
 *   `clawie/agent-runtime` Docker image; the spawner emits
 *   `container.spawn_started` / `container.spawn_completed` /
 *   `container.spawn_failed` audit events alongside the standard task
 *   lifecycle events.
 */
export default class TaskRun extends BaseCommand {
  static commandName = 'task:run'
  static description = 'Create a durable task with the given intent and execute it in agent-runtime'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Intent name (e.g., echo)' })
  declare intent: string

  @flags.string({
    description: 'Payload as a JSON string (defaults to null)',
    default: 'null',
  })
  declare payload: string

  @flags.string({
    description: 'Idempotency key — re-runs with the same key return the same task',
  })
  declare idempotencyKey?: string

  @flags.boolean({
    description: 'JSON output instead of pretty',
  })
  declare json: boolean

  async run() {
    if (!this.intent) {
      this.logger.error('--intent is required')
      this.exitCode = 1
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(this.payload)
    } catch (err) {
      this.logger.error(`Invalid --payload JSON: ${(err as Error).message}`)
      this.exitCode = 1
      return
    }

    const { registerBuiltinIntents } = await import('#services/intents/index')
    const { intentRegistry } = await import('#services/intents/registry')
    const { taskStateMachine } = await import('#services/task_state_machine')
    const { taskExecutor } = await import('#services/task_executor')

    registerBuiltinIntents()

    if (!intentRegistry().has(this.intent)) {
      this.logger.error(
        `Unknown intent "${this.intent}". Registered: ${intentRegistry().list().join(', ') || '(none)'}`
      )
      this.exitCode = 1
      return
    }

    const created = await taskStateMachine().create({
      intent: this.intent,
      payload,
      idempotencyKey: this.idempotencyKey ?? null,
      actor: 'cli',
    })

    if (created.status === 'approval_pending') {
      this.logger.warning(
        `task ${created.id} requires approval. ` +
          `run: node ace task:approve --id ${created.id} --decision approve`
      )
      if (this.json) {
        this.logger.log(
          JSON.stringify(
            { id: created.id, intent: created.intent, status: created.status },
            null,
            2
          )
        )
      }
      this.exitCode = 0
      return
    }

    if (created.status === 'failed') {
      this.logger.error(`task ${created.id} → failed (policy denied)`)
      this.exitCode = 1
      return
    }

    const finished = await taskExecutor().execute(created.id, 'cli')

    const summary = {
      id: finished.id,
      intent: finished.intent,
      status: finished.status,
      result: finished.parsedResult,
      failureCause: finished.failureCause,
      failureDetail: finished.failureDetail,
    }

    if (this.json) {
      this.logger.log(JSON.stringify(summary, null, 2))
    } else {
      this.logger.success(`task ${finished.id} → ${finished.status}`)
      if (finished.status === 'completed') {
        this.logger.log(`  result: ${JSON.stringify(finished.parsedResult)}`)
      } else if (finished.status === 'failed') {
        this.logger.error(`  cause:  ${finished.failureCause}`)
        if (finished.failureDetail) {
          this.logger.error(`  detail: ${finished.failureDetail}`)
        }
      }
    }

    if (finished.status !== 'completed') {
      this.exitCode = 1
    }
  }
}

import { taskStateMachine } from '#services/task_state_machine'
import { intentRegistry } from '#services/intents/registry'
import type Task from '#models/task'

/**
 * Drives a task from queued → completed (or failed) by:
 *  1. claim → start (state machine)
 *  2. lookup intent handler
 *  3. invoke handler with the parsed payload
 *  4. complete or fail (state machine)
 *
 * Phase 1: in-process execution. Phase 2 will replace this with a Docker spawn.
 */
export class TaskExecutor {
  async execute(taskId: string, workerId = 'inproc'): Promise<Task> {
    const sm = taskStateMachine()
    await sm.claim(taskId, { workerId })
    const running = await sm.start(taskId, workerId)

    const handler = intentRegistry().get(running.intent)
    if (!handler) {
      return sm.fail(
        taskId,
        workerId,
        'unknown_intent',
        `No handler for intent "${running.intent}"`
      )
    }

    try {
      const outcome = await handler({
        taskId: running.id,
        payload: running.parsedPayload,
      })
      if (outcome.ok) {
        return sm.complete(taskId, workerId, outcome.output)
      }
      return sm.fail(taskId, workerId, outcome.cause, outcome.detail ?? null)
    } catch (err) {
      const cause = 'handler_threw'
      const detail = err instanceof Error ? err.message : String(err)
      return sm.fail(taskId, workerId, cause, detail)
    }
  }
}

let cachedInstance: TaskExecutor | null = null
export function taskExecutor(): TaskExecutor {
  if (!cachedInstance) cachedInstance = new TaskExecutor()
  return cachedInstance
}

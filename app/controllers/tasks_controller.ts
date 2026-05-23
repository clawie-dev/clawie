import type { HttpContext } from '@adonisjs/core/http'
import Task from '#models/task'
import { createTaskValidator } from '#validators/task'
import { taskStateMachine } from '#services/task_state_machine'
import { taskExecutor } from '#services/task_executor'
import { registerBuiltinIntents } from '#services/intents/index'
import { intentRegistry } from '#services/intents/registry'

/**
 * Phase 1 controller. POST creates a task and synchronously executes it
 * via the in-process executor (intentionally simple — Phase 2 will detach
 * via a worker queue).
 */
export default class TasksController {
  async index({ request, response }: HttpContext) {
    const limit = Math.min(Number.parseInt(request.input('limit', '50'), 10) || 50, 500)
    const status = request.input('status') as string | undefined
    let q = Task.query().orderBy('created_at', 'desc').limit(limit)
    if (status) q = q.where('status', status)
    const rows = await q
    return response.ok(rows.map(serializeTask))
  }

  async show({ params, response }: HttpContext) {
    const task = await Task.find(params.id)
    if (!task) return response.notFound({ error: { code: 'not_found', message: 'Task not found' } })
    return response.ok(serializeTask(task))
  }

  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createTaskValidator)
    registerBuiltinIntents()

    if (!intentRegistry().has(data.intent)) {
      return response.badRequest({
        error: {
          code: 'unknown_intent',
          message: `Unknown intent "${data.intent}"`,
          details: { registered: intentRegistry().list() },
        },
      })
    }

    const created = await taskStateMachine().create({
      intent: data.intent,
      payload: data.payload,
      idempotencyKey: data.idempotencyKey ?? null,
      actor: 'api',
    })

    // Tasks that need approval (or were policy-denied) don't run yet.
    // The caller sees the task in its current state and uses the
    // approval endpoints to drive it forward.
    if (created.status === 'approval_pending' || created.status === 'failed') {
      return response.created(serializeTask(created))
    }

    // Synchronous in-process execution for now. A worker queue lands
    // alongside the scheduler in Phase 9.
    const finished = await taskExecutor().execute(created.id, 'api')

    return response.created(serializeTask(finished))
  }
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    intent: task.intent,
    status: task.status,
    payload: task.parsedPayload,
    result: task.parsedResult,
    failureCause: task.failureCause,
    failureDetail: task.failureDetail,
    version: task.version,
    createdAt: task.createdAt.toISO(),
    startedAt: task.startedAt?.toISO() ?? null,
    finishedAt: task.finishedAt?.toISO() ?? null,
  }
}

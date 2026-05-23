// @no-test: covered via tests/integration/approval_lifecycle.test.ts and the
// future tests/functional/v1_approvals_api.test.ts. AdonisJS controllers are
// thin glue and are typically exercised through HTTP rather than unit tests.
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import Approval from '#models/approval'
import type Task from '#models/task'
import { taskStateMachine, TaskTransitionError } from '#services/task_state_machine'
import { taskExecutor } from '#services/task_executor'

const decisionValidator = vine.compile(
  vine.object({
    decision: vine.enum(['approve', 'deny']),
    reason: vine.string().trim().maxLength(1000).optional(),
  })
)

/**
 * Phase 4 approval REST surface.
 *   GET    /v1/approvals          list pending (with optional ?status=)
 *   POST   /v1/tasks/:id/approval { decision, reason? }  approve or deny
 */
export default class ApprovalsController {
  async index({ request, response }: HttpContext) {
    const status = (request.input('status', 'pending') as string).trim()
    const limit = Math.min(Number.parseInt(request.input('limit', '50'), 10) || 50, 500)
    const rows = await Approval.query()
      .where('status', status)
      .orderBy('requested_at', 'asc')
      .limit(limit)
    return response.ok(rows.map(serializeApproval))
  }

  async decide({ params, request, response }: HttpContext) {
    const data = await request.validateUsing(decisionValidator)
    const taskId = params.id
    const reason = data.reason ?? null

    try {
      const task =
        data.decision === 'approve'
          ? await taskStateMachine().approve(taskId, 'api', reason)
          : await taskStateMachine().denyApproval(taskId, 'api', reason)

      // After approval, kick the task immediately. Phase 9 moves this
      // off the request thread.
      if (data.decision === 'approve' && task.status === 'queued') {
        const finished = await taskExecutor().execute(task.id, 'api')
        return response.ok(serializeTask(finished))
      }
      return response.ok(serializeTask(task))
    } catch (err) {
      if (err instanceof TaskTransitionError) {
        return response.conflict({
          error: { code: 'invalid_transition', message: err.message },
        })
      }
      if (err instanceof Error && err.message.includes('No approval row')) {
        return response.notFound({
          error: { code: 'no_pending_approval', message: err.message },
        })
      }
      throw err
    }
  }
}

function serializeApproval(a: Approval) {
  return {
    id: a.id,
    taskId: a.taskId,
    status: a.status,
    requestedAt: a.requestedAt instanceof DateTime ? a.requestedAt.toISO() : a.requestedAt,
    deadlineAt: a.deadlineAt instanceof DateTime ? a.deadlineAt.toISO() : a.deadlineAt,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt instanceof DateTime ? a.decidedAt.toISO() : a.decidedAt,
    reason: a.reason,
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
    finishedAt: task.finishedAt?.toISO() ?? null,
  }
}

import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Task, { type TaskStatus, TERMINAL_STATUSES } from '#models/task'
import { auditLogger } from '#services/audit_logger'

/**
 * Allowed transitions for the Phase 1 minimal state machine.
 * Future phases extend this (e.g., awaiting_approval per spec 005).
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  queued: ['claimed', 'aborted'],
  claimed: ['running', 'aborted', 'timed_out'],
  // Phase 1: complete directly from running. The `completing` intermediate state
  // is reserved for later phases that need an async finalization step (e.g.,
  // container cleanup before marking the task done).
  running: ['completed', 'completing', 'failed', 'aborted', 'timed_out'],
  completing: ['completed', 'failed'],
  completed: [],
  failed: [],
  aborted: [],
  timed_out: [],
}

export class TaskTransitionError extends Error {
  constructor(
    public readonly task: Task,
    public readonly attempted: TaskStatus,
    message: string
  ) {
    super(message)
    this.name = 'TaskTransitionError'
  }
}

export class TaskConflictError extends Error {
  constructor(public readonly taskId: string) {
    super(`Optimistic-lock conflict for task ${taskId}`)
    this.name = 'TaskConflictError'
  }
}

export interface CreateTaskInput {
  intent: string
  payload: unknown
  idempotencyKey?: string | null
  actor?: string
}

export interface ClaimInput {
  workerId: string
  leaseSeconds?: number
}

export interface TransitionInput {
  to: TaskStatus
  actor: string
  reason?: string
  result?: unknown
  failureCause?: string | null
  failureDetail?: string | null
}

/**
 * Owns durable transitions on Task rows. All side-effects audited.
 */
export class TaskStateMachine {
  async create(input: CreateTaskInput): Promise<Task> {
    if (!input.intent || typeof input.intent !== 'string') {
      throw new Error('intent is required')
    }
    if (input.idempotencyKey) {
      const existing = await Task.query().where('idempotency_key', input.idempotencyKey).first()
      if (existing) return existing
    }
    const task = await Task.create({
      intent: input.intent,
      payload: JSON.stringify(input.payload ?? null),
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'queued',
      version: 0,
    })
    await auditLogger().record({
      actor: input.actor ?? 'system',
      action: 'task.created',
      subjectKind: 'task',
      subjectId: task.id,
      outcome: 'success',
      details: { intent: task.intent, idempotencyKey: task.idempotencyKey },
    })
    return task
  }

  async claim(taskId: string, claim: ClaimInput): Promise<Task> {
    const lease = claim.leaseSeconds ?? 300
    return this.transition(
      taskId,
      {
        to: 'claimed',
        actor: claim.workerId,
        reason: `lease ${lease}s`,
      },
      (task) => {
        task.claimedBy = claim.workerId
        task.claimExpiresAt = DateTime.utc().plus({ seconds: lease })
      }
    )
  }

  async start(taskId: string, actor: string): Promise<Task> {
    return this.transition(taskId, { to: 'running', actor }, (task) => {
      task.startedAt = task.startedAt ?? DateTime.utc()
    })
  }

  async complete(taskId: string, actor: string, result: unknown): Promise<Task> {
    return this.transition(taskId, { to: 'completed', actor, result }, (task) => {
      task.result = JSON.stringify(result ?? null)
      task.finishedAt = DateTime.utc()
    })
  }

  async fail(taskId: string, actor: string, cause: string, detail?: string | null): Promise<Task> {
    return this.transition(
      taskId,
      { to: 'failed', actor, failureCause: cause, failureDetail: detail ?? null },
      (task) => {
        task.failureCause = cause
        task.failureDetail = detail ?? null
        task.finishedAt = DateTime.utc()
      }
    )
  }

  async abort(taskId: string, actor: string, reason: string): Promise<Task> {
    return this.transition(taskId, { to: 'aborted', actor, reason }, (task) => {
      task.finishedAt = DateTime.utc()
    })
  }

  /**
   * Generic transition runner. Atomic via DB transaction + optimistic version check.
   */
  private async transition(
    taskId: string,
    transition: TransitionInput,
    mutate?: (task: Task) => void
  ): Promise<Task> {
    return db.transaction(async (trx) => {
      const task = await Task.query({ client: trx }).where('id', taskId).first()
      if (!task) {
        throw new Error(`Task ${taskId} not found`)
      }
      if (!this.canTransition(task.status, transition.to)) {
        throw new TaskTransitionError(
          task,
          transition.to,
          `Cannot transition task ${taskId} from ${task.status} → ${transition.to}`
        )
      }

      const fromStatus = task.status
      const fromVersion = task.version

      mutate?.(task)
      task.status = transition.to
      task.version = fromVersion + 1
      task.useTransaction(trx)

      const updated = (await Task.query({ client: trx })
        .where('id', taskId)
        .where('version', fromVersion)
        .update({
          status: task.status,
          version: task.version,
          claimed_by: task.claimedBy,
          claim_expires_at: task.claimExpiresAt?.toSQL() ?? null,
          result: task.result,
          failure_cause: task.failureCause,
          failure_detail: task.failureDetail,
          started_at: task.startedAt?.toSQL() ?? null,
          finished_at: task.finishedAt?.toSQL() ?? null,
          updated_at: DateTime.utc().toSQL(),
        })) as unknown
      const affected = Array.isArray(updated) ? updated[0] : (updated as number)
      if (affected === 0) {
        throw new TaskConflictError(taskId)
      }

      await auditLogger().record({
        actor: transition.actor,
        action: `task.${transition.to}`,
        subjectKind: 'task',
        subjectId: taskId,
        outcome: 'success',
        reason: transition.reason ?? null,
        details: {
          from: fromStatus,
          to: transition.to,
          ...(transition.result !== undefined ? { result: transition.result } : {}),
          ...(transition.failureCause ? { failureCause: transition.failureCause } : {}),
        },
        trx,
      })

      return task
    })
  }

  private canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
  }
}

let cachedInstance: TaskStateMachine | null = null
export function taskStateMachine(): TaskStateMachine {
  if (!cachedInstance) cachedInstance = new TaskStateMachine()
  return cachedInstance
}

export { ALLOWED_TRANSITIONS, TERMINAL_STATUSES }

import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import Task, { type TaskStatus, TERMINAL_STATUSES } from '#models/task'
import Approval from '#models/approval'
import { auditLogger } from '#services/audit_logger'
import { policyEngine } from '#services/policy_engine'

/**
 * Phase 4 transitions. `approval_pending` joins the pre-execution
 * states (tasks land here when the policy engine returns
 * `requires_approval`; an approval row tracks the deadline). Approval
 * either promotes the task to `queued` or fails it with cause
 * `approval_denied` / `approval_expired`.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
  approval_pending: ['queued', 'failed', 'aborted'],
  queued: ['claimed', 'aborted'],
  claimed: ['running', 'aborted', 'timed_out'],
  // The `completing` intermediate state is reserved for later phases that
  // need an async finalization step (e.g. container cleanup) before the
  // task can be marked done.
  running: ['completed', 'completing', 'failed', 'aborted', 'timed_out'],
  completing: ['completed', 'failed'],
  completed: [],
  failed: [],
  aborted: [],
  timed_out: [],
}

const DEFAULT_APPROVAL_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

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
  approvalWindowMs?: number
  /** Phase 8: tasks scoped to a team get team-isolated egress (Outcall network). */
  teamSlug?: string | null
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

    const actor = input.actor ?? 'system'
    const decision = await policyEngine().decide({
      intent: input.intent,
      payload: input.payload,
      actor,
    })

    const initialStatus: TaskStatus =
      decision.decision === 'allow'
        ? 'queued'
        : decision.decision === 'deny'
          ? 'failed'
          : 'approval_pending'

    const task = await Task.create({
      intent: input.intent,
      payload: JSON.stringify(input.payload ?? null),
      idempotencyKey: input.idempotencyKey ?? null,
      status: initialStatus,
      version: 0,
      teamSlug: input.teamSlug ?? null,
      failureCause: decision.decision === 'deny' ? 'policy_denied' : null,
      failureDetail: decision.decision === 'deny' ? decision.reason : null,
      finishedAt: decision.decision === 'deny' ? DateTime.utc() : null,
    })

    await auditLogger().record({
      actor,
      action: 'task.created',
      subjectKind: 'task',
      subjectId: task.id,
      outcome: 'success',
      details: { intent: task.intent, idempotencyKey: task.idempotencyKey },
    })

    await auditLogger().record({
      actor: 'policy_engine',
      action: 'policy.decided',
      subjectKind: 'task',
      subjectId: task.id,
      outcome: decision.decision === 'deny' ? 'denied' : 'success',
      reason: decision.reason,
      details: {
        decision: decision.decision,
        ruleId: decision.ruleId,
        ruleName: decision.ruleName,
      },
    })

    if (decision.decision === 'requires_approval') {
      const window = input.approvalWindowMs ?? DEFAULT_APPROVAL_WINDOW_MS
      const now = DateTime.utc()
      await Approval.create({
        taskId: task.id,
        status: 'pending',
        requestedAt: now,
        deadlineAt: now.plus({ milliseconds: window }),
      })
      await auditLogger().record({
        actor: 'policy_engine',
        action: 'approval.requested',
        subjectKind: 'task',
        subjectId: task.id,
        outcome: 'pending',
        details: { decisionWindowMs: window },
      })
    }

    if (decision.decision === 'deny') {
      await auditLogger().record({
        actor: 'policy_engine',
        action: 'task.failed',
        subjectKind: 'task',
        subjectId: task.id,
        outcome: 'failure',
        reason: 'policy_denied',
        details: { ruleId: decision.ruleId, ruleName: decision.ruleName },
      })
    }

    return task
  }

  /**
   * Approve a pending task. Transitions the task from `approval_pending`
   * to `queued`. The approval row is updated with the decider + reason.
   */
  async approve(taskId: string, actor: string, reason: string | null = null): Promise<Task> {
    return db.transaction(async (trx) => {
      const approval = await Approval.query({ client: trx }).where('task_id', taskId).first()
      if (!approval) throw new Error(`No approval row for task ${taskId}`)
      if (approval.status !== 'pending') {
        throw new Error(`Approval for task ${taskId} is already ${approval.status}`)
      }

      approval.useTransaction(trx)
      approval.status = 'approved'
      approval.decidedBy = actor
      approval.decidedAt = DateTime.utc()
      approval.reason = reason
      await approval.save()

      const task = await this.transitionInTrx(
        trx,
        taskId,
        { to: 'queued', actor, reason: reason ?? 'approved' },
        undefined
      )

      await auditLogger().record({
        actor,
        action: 'approval.granted',
        subjectKind: 'task',
        subjectId: taskId,
        outcome: 'success',
        reason,
        trx,
      })

      return task
    })
  }

  /**
   * Deny a pending task. Transitions the task to `failed` with cause
   * `approval_denied`.
   */
  async denyApproval(taskId: string, actor: string, reason: string | null = null): Promise<Task> {
    return db.transaction(async (trx) => {
      const approval = await Approval.query({ client: trx }).where('task_id', taskId).first()
      if (!approval) throw new Error(`No approval row for task ${taskId}`)
      if (approval.status !== 'pending') {
        throw new Error(`Approval for task ${taskId} is already ${approval.status}`)
      }

      approval.useTransaction(trx)
      approval.status = 'denied'
      approval.decidedBy = actor
      approval.decidedAt = DateTime.utc()
      approval.reason = reason
      await approval.save()

      const task = await this.transitionInTrx(
        trx,
        taskId,
        {
          to: 'failed',
          actor,
          failureCause: 'approval_denied',
          failureDetail: reason ?? 'approval denied',
        },
        (t) => {
          t.failureCause = 'approval_denied'
          t.failureDetail = reason ?? 'approval denied'
          t.finishedAt = DateTime.utc()
        }
      )

      await auditLogger().record({
        actor,
        action: 'approval.denied',
        subjectKind: 'task',
        subjectId: taskId,
        outcome: 'denied',
        reason,
        trx,
      })

      return task
    })
  }

  /**
   * Expire all approval rows whose deadline has passed. Returns the
   * number of approvals expired. Each affected task is moved to
   * `failed` with cause `approval_expired`.
   */
  async expirePastDeadlines(now: DateTime = DateTime.utc()): Promise<number> {
    const stale = await Approval.query()
      .where('status', 'pending')
      .where('deadline_at', '<=', now.toSQL()!)

    let expired = 0
    for (const approval of stale) {
      await db.transaction(async (trx) => {
        approval.useTransaction(trx)
        approval.status = 'expired'
        approval.decidedBy = 'system'
        approval.decidedAt = now
        approval.reason = 'deadline exceeded'
        await approval.save()

        await this.transitionInTrx(
          trx,
          approval.taskId,
          {
            to: 'failed',
            actor: 'system',
            failureCause: 'approval_expired',
            failureDetail: 'decision window exceeded',
          },
          (t) => {
            t.failureCause = 'approval_expired'
            t.failureDetail = 'decision window exceeded'
            t.finishedAt = now
          }
        )

        await auditLogger().record({
          actor: 'system',
          action: 'approval.expired',
          subjectKind: 'task',
          subjectId: approval.taskId,
          outcome: 'failure',
          reason: 'deadline exceeded',
          trx,
        })
      })
      expired++
    }
    return expired
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
    return db.transaction((trx) => this.transitionInTrx(trx, taskId, transition, mutate))
  }

  private async transitionInTrx(
    trx: TransactionClientContract,
    taskId: string,
    transition: TransitionInput,
    mutate: ((task: Task) => void) | undefined
  ): Promise<Task> {
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

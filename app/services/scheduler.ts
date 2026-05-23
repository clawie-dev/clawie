import { DateTime } from 'luxon'
import CronJob from '#models/cron_job'
import { taskStateMachine } from '#services/task_state_machine'
import { auditLogger } from '#services/audit_logger'
import { nextFiring } from '#services/cron'

/**
 * Phase 9 scheduler. Each `tick(now)` call:
 *   1. Fetches enabled cron jobs whose `nextRunAt <= now`.
 *   2. For each, creates a task via the state machine, using the job's
 *      `intent`, parsed `payloadTemplate`, and `teamSlug`.
 *   3. Updates the job's `lastRunAt` + `lastTaskId` + advances
 *      `nextRunAt` to the next match.
 *   4. Emits one `cron.fired` audit event per job that fired.
 *
 * Operators call `scheduler:tick` on a host cron (every minute) for
 * Phase 9. Phase 10 will introduce an in-process ticker that runs
 * continuously when Clawie's server is up; the manual CLI stays as a
 * dev/test/debug path.
 *
 * Approvals sweep runs in the same tick to keep operator workflow
 * single-button: one cron entry, one `scheduler:tick`, both deadlines
 * and recurring jobs handled.
 */
export interface TickResult {
  firedJobs: number
  approvalsExpired: number
  errors: Array<{ jobName: string; error: string }>
}

export class Scheduler {
  async tick(now: DateTime = DateTime.utc()): Promise<TickResult> {
    const due = await CronJob.query()
      .where('enabled', true)
      .where('next_run_at', '<=', now.toSQL()!)
      .orderBy('next_run_at', 'asc')

    const errors: Array<{ jobName: string; error: string }> = []
    const sm = taskStateMachine()
    const audit = auditLogger()
    let fired = 0

    for (const job of due) {
      try {
        const task = await sm.create({
          intent: job.intent,
          payload: job.parsedPayload,
          actor: `cron:${job.name}`,
          teamSlug: job.teamSlug,
        })
        job.lastRunAt = now
        job.lastTaskId = task.id
        job.nextRunAt = nextFiring(job.cronExpression, now)
        await job.save()

        await audit.record({
          actor: 'scheduler',
          action: 'cron.fired',
          subjectKind: 'cron_job',
          subjectId: String(job.id),
          outcome: 'success',
          details: {
            jobName: job.name,
            intent: job.intent,
            taskId: task.id,
            nextRunAt: job.nextRunAt.toISO(),
          },
        })
        fired++
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        errors.push({ jobName: job.name, error: detail })
        await audit.record({
          actor: 'scheduler',
          action: 'cron.fire_failed',
          subjectKind: 'cron_job',
          subjectId: String(job.id),
          outcome: 'failure',
          reason: detail,
        })
      }
    }

    const approvalsExpired = await sm.expirePastDeadlines(now)

    return { firedJobs: fired, approvalsExpired, errors }
  }
}

let cachedInstance: Scheduler | null = null
export function scheduler(): Scheduler {
  if (!cachedInstance) cachedInstance = new Scheduler()
  return cachedInstance
}

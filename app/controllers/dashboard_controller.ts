// @no-test: AdonisJS controller-as-glue covered by tests/functional/dashboard.test.ts
// (a future addition); read-only views over models that already have unit-test mirrors.
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import Task from '#models/task'
import Approval from '#models/approval'
import AuditEvent from '#models/audit_event'
import AgentModification from '#models/agent_modification'
import { egressProvider } from '#services/egress/provider'
import { OutcallApiClient } from '#services/egress/api_client'

/**
 * Phase 6 dashboard. Renders three sections in a single React page:
 *
 *   - Tasks    : latest 50, with status, intent, result/failure summary.
 *   - Approvals: pending queue, oldest first, with deadline countdown.
 *   - Audit    : latest 100 events from the hash-chained log.
 *
 * Mutations (approve / deny) do NOT live here -- the dashboard POSTs to
 * the existing `/v1/tasks/:id/approval` REST endpoint so a single
 * code path handles both UI and API.
 */
export default class DashboardController {
  async index({ inertia }: HttpContext) {
    const [tasks, approvals, events, mods] = await Promise.all([
      Task.query().orderBy('created_at', 'desc').limit(50),
      Approval.query().where('status', 'pending').orderBy('requested_at', 'asc'),
      AuditEvent.query().orderBy('id', 'desc').limit(100),
      AgentModification.query().orderBy('created_at', 'desc').limit(50),
    ])

    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const egress = await loadEgressData()

    const props = {
      tasks: tasks.map(serializeTask),
      approvals: approvals.map((a) => serializeApproval(a, taskById.get(a.taskId))),
      audit: events.map(serializeEvent),
      modifications: mods.map(serializeModification),
      egress,
      now: DateTime.utc().toISO(),
    }
    // The page name + prop shape is enforced by `inertia/pages/dashboard/index.tsx`'s
    // `React.FC<DashboardProps>`. The `as never` cast bypasses a TypeScript narrowing
    // bug visible only when the inertia tsconfig type-checks backend controllers
    // through the auto-generated #generated/controllers chain: the InertiaPages
    // augmentation isn't visible from that compilation unit, so the page-name
    // parameter narrows to `never`. Under the app tsconfig the call type-checks
    // cleanly without the cast. Revisit if/when AdonisJS Inertia ships a typed
    // helper that doesn't depend on module augmentation.
    return inertia.render('dashboard/index', props as never)
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
    createdAt: task.createdAt.toISO(),
    finishedAt: task.finishedAt?.toISO() ?? null,
  }
}

function serializeApproval(a: Approval, task: Task | undefined) {
  return {
    id: a.id,
    taskId: a.taskId,
    intent: task?.intent ?? null,
    payloadSummary: task ? summarisePayload(task.parsedPayload) : null,
    requestedAt: a.requestedAt instanceof DateTime ? a.requestedAt.toISO() : a.requestedAt,
    deadlineAt: a.deadlineAt instanceof DateTime ? a.deadlineAt.toISO() : a.deadlineAt,
  }
}

function serializeEvent(e: AuditEvent) {
  return {
    id: e.id,
    actor: e.actor,
    action: e.action,
    subjectKind: e.subjectKind,
    subjectId: e.subjectId,
    outcome: e.outcome,
    reason: e.reason,
    details: e.parsedDetails,
    createdAt: e.createdAt.toISO(),
  }
}

function serializeModification(m: AgentModification) {
  return {
    id: m.id,
    agentName: m.agentName,
    taskId: m.taskId,
    status: m.status,
    paths: m.parsedChanges.map((c) => c.path),
    diff: m.diff,
    createdAt: m.createdAt instanceof DateTime ? m.createdAt.toISO() : m.createdAt,
    decidedBy: m.decidedBy,
    reason: m.reason,
  }
}

function summarisePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '—'
  if (typeof payload === 'string') return payload.slice(0, 80)
  try {
    const json = JSON.stringify(payload)
    return json.slice(0, 80) + (json.length > 80 ? '…' : '')
  } catch {
    return String(payload).slice(0, 80)
  }
}

type EgressData =
  | { active: false; providerName: string }
  | {
      active: true
      providerName: 'outcall'
      bridge: { name: string; up: boolean; nftablesActive: boolean }
      rules: Array<{
        id: string
        file: string
        action: string
        conditionPreview: string
        description: string | null
      }>
      proxy: {
        running: boolean
        listenAddress: string
        proxyUrl: string
        activeConnections: number
        totalRequests: number
        totalBlocked: number
      }
    }
  | { active: false; providerName: string; error: string }

/**
 * When the active EgressProvider is Outcall, fetch the read-side state
 * from `/run/outcall/host.sock`. Any failure (daemon down, socket
 * permission, parse error) degrades to an `active: false` shape with
 * an error string so the UI can show "Outcall configured but
 * unreachable" instead of breaking the whole dashboard.
 */
async function loadEgressData(): Promise<EgressData> {
  const provider = egressProvider()
  if (provider.name !== 'outcall') {
    return { active: false, providerName: provider.name }
  }

  const socketPath = process.env.OUTCALL_HOST_SOCKET ?? '/run/outcall/host.sock'
  const client = new OutcallApiClient(socketPath)
  try {
    const [bridge, rules, proxy] = await Promise.all([
      client.bridgeStatus(),
      client.rulesList(),
      client.proxyStatus(),
    ])
    return {
      active: true,
      providerName: 'outcall',
      bridge: {
        name: bridge.name,
        up: bridge.up,
        nftablesActive: bridge.nftables_active,
      },
      rules: rules.map((r) => ({
        id: r.id,
        file: r.file,
        action: r.action,
        conditionPreview: r.condition_preview,
        description: r.description,
      })),
      proxy: {
        running: proxy.running,
        listenAddress: proxy.listen_address,
        proxyUrl: proxy.proxy_url,
        activeConnections: proxy.active_connections,
        totalRequests: proxy.total_requests,
        totalBlocked: proxy.total_blocked,
      },
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.warn({ socketPath, error: detail }, 'dashboard: failed to read Outcall state')
    return { active: false, providerName: 'outcall', error: detail }
  }
}

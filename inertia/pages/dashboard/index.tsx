import React, { useEffect, useState } from 'react'
import { router } from '@inertiajs/react'

interface Task {
  id: string
  intent: string
  status: string
  payload: unknown
  result: unknown
  failureCause: string | null
  failureDetail: string | null
  createdAt: string
  finishedAt: string | null
}

interface Approval {
  id: number
  taskId: string
  intent: string | null
  payloadSummary: string | null
  requestedAt: string
  deadlineAt: string
}

interface AuditEvent {
  id: number
  actor: string
  action: string
  subjectKind: string | null
  subjectId: string | null
  outcome: string
  reason: string | null
  details: unknown
  createdAt: string
}

type EgressData =
  | { active: false; providerName: string; error?: string }
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

interface AgentModification {
  id: number
  agentName: string
  taskId: string
  status: 'pending' | 'applied' | 'rejected'
  paths: string[]
  diff: string
  createdAt: string
  decidedBy: string | null
  reason: string | null
}

interface DashboardProps {
  tasks: Task[]
  approvals: Approval[]
  audit: AuditEvent[]
  modifications: AgentModification[]
  egress: EgressData
  now: string
}

type Tab = 'tasks' | 'approvals' | 'audit' | 'egress' | 'mods'

const POLL_MS = 5_000

const Dashboard: React.FC<DashboardProps> = (props) => {
  const [tab, setTab] = useState<Tab>('approvals')

  useEffect(() => {
    const id = setInterval(() => {
      router.reload({
        only: ['tasks', 'approvals', 'audit', 'modifications', 'egress', 'now'],
      })
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Clawie</h1>
        <div style={styles.subtitle}>
          {props.tasks.length} tasks · {props.approvals.length} pending approvals · last refresh{' '}
          {fmtTime(props.now)}
        </div>
      </header>

      <nav style={styles.tabs}>
        <TabButton current={tab} target="approvals" onClick={setTab}>
          Approvals ({props.approvals.length})
        </TabButton>
        <TabButton current={tab} target="tasks" onClick={setTab}>
          Tasks ({props.tasks.length})
        </TabButton>
        <TabButton current={tab} target="audit" onClick={setTab}>
          Audit ({props.audit.length})
        </TabButton>
        <TabButton current={tab} target="egress" onClick={setTab}>
          Egress ({props.egress.active ? props.egress.rules.length : '—'})
        </TabButton>
        <TabButton current={tab} target="mods" onClick={setTab}>
          Self-Mods ({props.modifications.filter((m) => m.status === 'pending').length})
        </TabButton>
      </nav>

      {tab === 'approvals' && <ApprovalsTab approvals={props.approvals} now={props.now} />}
      {tab === 'tasks' && <TasksTab tasks={props.tasks} />}
      {tab === 'audit' && <AuditTab audit={props.audit} />}
      {tab === 'egress' && <EgressTab egress={props.egress} />}
      {tab === 'mods' && <ModsTab modifications={props.modifications} />}
    </div>
  )
}

export default Dashboard

function TabButton({
  current,
  target,
  onClick,
  children,
}: {
  current: Tab
  target: Tab
  onClick: (t: Tab) => void
  children: React.ReactNode
}) {
  const active = current === target
  return (
    <button
      type="button"
      onClick={() => onClick(target)}
      style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
    >
      {children}
    </button>
  )
}

function ApprovalsTab({ approvals, now }: { approvals: Approval[]; now: string }) {
  if (approvals.length === 0) {
    return <div style={styles.empty}>No pending approvals.</div>
  }

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Intent</th>
          <th style={styles.th}>Payload</th>
          <th style={styles.th}>Requested</th>
          <th style={styles.th}>Deadline</th>
          <th style={styles.th}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {approvals.map((a) => (
          <tr key={a.id}>
            <td style={styles.td}>
              <code>{a.intent ?? '—'}</code>
            </td>
            <td style={styles.td}>
              <code style={styles.payload}>{a.payloadSummary ?? '—'}</code>
            </td>
            <td style={styles.td}>{fmtTime(a.requestedAt)}</td>
            <td style={styles.td}>{fmtDeadline(a.deadlineAt, now)}</td>
            <td style={styles.td}>
              <ApprovalActions taskId={a.taskId} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ApprovalActions({ taskId }: { taskId: string }) {
  const [busy, setBusy] = useState(false)

  async function decide(decision: 'approve' | 'deny') {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/v1/tasks/${taskId}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (!res.ok) {
        const body = await res.text()
        alert(`Decision failed: ${res.status} ${body.slice(0, 200)}`)
      } else {
        router.reload({ only: ['tasks', 'approvals', 'audit', 'now'] })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('approve')}
        style={{ ...styles.button, ...styles.approve }}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('deny')}
        style={{ ...styles.button, ...styles.deny }}
      >
        Deny
      </button>
    </div>
  )
}

function TasksTab({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <div style={styles.empty}>No tasks yet.</div>
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Status</th>
          <th style={styles.th}>Intent</th>
          <th style={styles.th}>Created</th>
          <th style={styles.th}>Finished</th>
          <th style={styles.th}>Outcome</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td style={styles.td}>
              <StatusBadge status={t.status} />
            </td>
            <td style={styles.td}>
              <code>{t.intent}</code>
            </td>
            <td style={styles.td}>{fmtTime(t.createdAt)}</td>
            <td style={styles.td}>{t.finishedAt ? fmtTime(t.finishedAt) : '—'}</td>
            <td style={styles.td}>
              {t.status === 'completed' && (
                <code style={styles.payload}>{summarise(t.result)}</code>
              )}
              {t.status === 'failed' && (
                <code style={{ ...styles.payload, color: '#a33' }}>
                  {t.failureCause}: {t.failureDetail ?? '—'}
                </code>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AuditTab({ audit }: { audit: AuditEvent[] }) {
  if (audit.length === 0) {
    return <div style={styles.empty}>Audit log is empty.</div>
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Time</th>
          <th style={styles.th}>Actor</th>
          <th style={styles.th}>Action</th>
          <th style={styles.th}>Subject</th>
          <th style={styles.th}>Outcome</th>
          <th style={styles.th}>Reason</th>
        </tr>
      </thead>
      <tbody>
        {audit.map((e) => (
          <tr key={e.id}>
            <td style={styles.td}>{fmtTime(e.createdAt)}</td>
            <td style={styles.td}>
              <code>{e.actor}</code>
            </td>
            <td style={styles.td}>
              <code>{e.action}</code>
            </td>
            <td style={styles.td}>
              {e.subjectKind && e.subjectId ? (
                <code style={styles.payload}>
                  {e.subjectKind}:{e.subjectId.slice(0, 8)}
                </code>
              ) : (
                '—'
              )}
            </td>
            <td style={styles.td}>
              <OutcomeBadge outcome={e.outcome} />
            </td>
            <td style={styles.td}>{e.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ModsTab({ modifications }: { modifications: AgentModification[] }) {
  if (modifications.length === 0) {
    return (
      <div style={styles.empty}>
        No agent modifications. Run an <code>agent.self_mod</code> intent to propose changes.
      </div>
    )
  }
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Agent</th>
          <th style={styles.th}>Files</th>
          <th style={styles.th}>Status</th>
          <th style={styles.th}>Created</th>
          <th style={styles.th}>Diff</th>
        </tr>
      </thead>
      <tbody>
        {modifications.map((m) => (
          <tr key={m.id}>
            <td style={styles.td}>
              <code>{m.agentName}</code>
            </td>
            <td style={styles.td}>
              <code style={styles.payload}>{m.paths.join(', ')}</code>
            </td>
            <td style={styles.td}>
              <ModStatusBadge status={m.status} />
            </td>
            <td style={styles.td}>{fmtTime(m.createdAt)}</td>
            <td style={styles.td}>
              <pre style={styles.diff}>{m.diff}</pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ModStatusBadge({ status }: { status: string }) {
  const color = status === 'applied' ? '#3a7' : status === 'rejected' ? '#a33' : '#c93'
  return <span style={{ ...styles.badge, backgroundColor: color }}>{status}</span>
}

function EgressTab({ egress }: { egress: EgressData }) {
  if (!egress.active) {
    const hint =
      egress.providerName === 'null'
        ? 'Set CLAWIE_EGRESS=outcall and run an outcalld daemon to populate this view.'
        : `Provider configured as "${egress.providerName}" but unreachable.${egress.error ? ` Error: ${egress.error}` : ''}`
    return <div style={styles.empty}>{hint}</div>
  }

  const blockRate =
    egress.proxy.totalRequests > 0
      ? ((egress.proxy.totalBlocked / egress.proxy.totalRequests) * 100).toFixed(1)
      : '0.0'

  return (
    <div>
      <section style={styles.egressSection}>
        <h3 style={styles.h3}>Daemon</h3>
        <div style={styles.metricRow}>
          <Metric
            label="Bridge"
            value={egress.bridge.name}
            tone={egress.bridge.up ? 'ok' : 'warn'}
          />
          <Metric label="Up" value={egress.bridge.up ? 'yes' : 'no'} tone={egress.bridge.up ? 'ok' : 'warn'} />
          <Metric
            label="nftables"
            value={egress.bridge.nftablesActive ? 'active' : 'inactive'}
            tone={egress.bridge.nftablesActive ? 'ok' : 'warn'}
          />
          <Metric label="Proxy" value={egress.proxy.proxyUrl} />
        </div>
      </section>

      <section style={styles.egressSection}>
        <h3 style={styles.h3}>Proxy counters</h3>
        <div style={styles.metricRow}>
          <Metric label="Active connections" value={String(egress.proxy.activeConnections)} />
          <Metric label="Total requests" value={String(egress.proxy.totalRequests)} />
          <Metric
            label="Total blocked"
            value={String(egress.proxy.totalBlocked)}
            tone={egress.proxy.totalBlocked > 0 ? 'warn' : 'ok'}
          />
          <Metric label="Block rate" value={`${blockRate}%`} />
        </div>
      </section>

      <section style={styles.egressSection}>
        <h3 style={styles.h3}>Active rules ({egress.rules.length})</h3>
        {egress.rules.length === 0 ? (
          <div style={styles.empty}>
            No rules loaded. Drop a preset into <code>/etc/outcall/rules.d/</code> and run{' '}
            <code>outcall rules reload</code>.
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Condition</th>
                <th style={styles.th}>File</th>
              </tr>
            </thead>
            <tbody>
              {egress.rules.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>
                    <ActionBadge action={r.action} />
                  </td>
                  <td style={styles.td}>
                    <code>{r.id}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.payload}>{r.conditionPreview}</code>
                  </td>
                  <td style={styles.td}>
                    <code style={styles.payload}>{r.file.split('/').pop()}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div
        style={{
          ...styles.metricValue,
          color: tone === 'warn' ? '#a33' : tone === 'ok' ? '#3a7' : '#222',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const color = action === 'allow' ? '#3a7' : action === 'block' ? '#a33' : '#888'
  return <span style={{ ...styles.badge, backgroundColor: color }}>{action}</span>
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? '#888'
  return <span style={{ ...styles.badge, backgroundColor: color }}>{status}</span>
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const color =
    outcome === 'success' ? '#3a7' : outcome === 'failure' || outcome === 'denied' ? '#a33' : '#888'
  return <span style={{ ...styles.badge, backgroundColor: color }}>{outcome}</span>
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#3a7',
  failed: '#a33',
  running: '#369',
  queued: '#888',
  approval_pending: '#c93',
  claimed: '#369',
  aborted: '#888',
  timed_out: '#a33',
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

function fmtDeadline(deadline: string, now: string): string {
  try {
    const ms = new Date(deadline).getTime() - new Date(now).getTime()
    if (ms <= 0) return 'expired'
    const mins = Math.floor(ms / 60_000)
    const secs = Math.floor((ms % 60_000) / 1000)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  } catch {
    return deadline
  }
}

function summarise(v: unknown): string {
  if (v === null || v === undefined) return '—'
  try {
    const s = JSON.stringify(v)
    return s.length > 80 ? s.slice(0, 80) + '…' : s
  } catch {
    return String(v).slice(0, 80)
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto' },
  header: { marginBottom: 16 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#666', fontSize: 13, marginTop: 4 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid #ddd', marginBottom: 16 },
  tab: {
    padding: '10px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontSize: 14,
  },
  tabActive: { borderBottomColor: '#369', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #ddd', color: '#666' },
  td: { padding: '8px 12px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' },
  payload: { fontSize: 12, color: '#444', wordBreak: 'break-all' },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    color: '#fff',
    fontSize: 11,
    textTransform: 'uppercase' as const,
  },
  button: {
    padding: '6px 12px',
    fontSize: 12,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    color: '#fff',
  },
  approve: { background: '#3a7' },
  deny: { background: '#a33' },
  empty: { padding: 24, textAlign: 'center' as const, color: '#888' },
  egressSection: { marginBottom: 24 },
  h3: { fontSize: 14, color: '#666', margin: '0 0 8px', fontWeight: 600 },
  metricRow: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  metric: {
    padding: '8px 12px',
    border: '1px solid #eee',
    borderRadius: 4,
    minWidth: 140,
    background: '#fafafa',
  },
  metricLabel: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, marginBottom: 2 },
  metricValue: { fontSize: 14, fontWeight: 600 },
  diff: {
    margin: 0,
    fontSize: 11,
    fontFamily: 'monospace',
    background: '#fafafa',
    padding: 8,
    borderRadius: 3,
    maxWidth: 400,
    overflow: 'auto' as const,
  },
}

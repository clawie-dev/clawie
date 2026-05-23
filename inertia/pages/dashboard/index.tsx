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

interface DashboardProps {
  tasks: Task[]
  approvals: Approval[]
  audit: AuditEvent[]
  now: string
}

type Tab = 'tasks' | 'approvals' | 'audit'

const POLL_MS = 5_000

const Dashboard: React.FC<DashboardProps> = (props) => {
  const [tab, setTab] = useState<Tab>('approvals')

  useEffect(() => {
    const id = setInterval(() => {
      router.reload({ only: ['tasks', 'approvals', 'audit', 'now'] })
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
      </nav>

      {tab === 'approvals' && <ApprovalsTab approvals={props.approvals} now={props.now} />}
      {tab === 'tasks' && <TasksTab tasks={props.tasks} />}
      {tab === 'audit' && <AuditTab audit={props.audit} />}
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
}

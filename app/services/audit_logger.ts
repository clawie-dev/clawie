import { createHash } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditEvent, { type AuditOutcome } from '#models/audit_event'

export interface AuditInput {
  actor: string
  action: string
  subjectKind?: string | null
  subjectId?: string | null
  outcome: AuditOutcome
  reason?: string | null
  details?: unknown
  /**
   * Optional transaction client. When the calling code is inside a
   * `db.transaction(...)`, pass `trx` so the audit row participates in the
   * same transaction (atomic with the audited side-effect) AND avoids SQLite
   * write-lock contention between separate connections.
   */
  trx?: TransactionClientContract
}

/**
 * Append-only audit logger. Each event is hash-chained to its predecessor;
 * the chain is verifiable via `verifyChain()`.
 */
export class AuditLogger {
  async record(input: AuditInput): Promise<AuditEvent> {
    const trx = input.trx

    const last = await (trx
      ? AuditEvent.query({ client: trx }).orderBy('id', 'desc').first()
      : AuditEvent.query().orderBy('id', 'desc').first())
    const prevHash = last?.hash ?? null
    const detailsString = input.details === undefined ? null : JSON.stringify(input.details)

    const event = new AuditEvent()
    event.actor = input.actor
    event.action = input.action
    event.subjectKind = input.subjectKind ?? null
    event.subjectId = input.subjectId ?? null
    event.outcome = input.outcome
    event.reason = input.reason ?? null
    event.details = detailsString
    event.prevHash = prevHash
    // Compute hash BEFORE insert so the row lands atomically with a valid
    // hash on first save. `id` is intentionally excluded — sequential identical
    // events still produce distinct hashes via `prevHash`.
    event.hash = this.computeHash({
      actor: event.actor,
      action: event.action,
      subjectKind: event.subjectKind,
      subjectId: event.subjectId,
      outcome: event.outcome,
      reason: event.reason,
      details: event.details,
      prevHash: event.prevHash,
    })
    if (trx) event.useTransaction(trx)
    await event.save()
    return event
  }

  /**
   * Recompute the chain and confirm each row's hash matches its content.
   * Returns the first mismatched event id, or null on a clean chain.
   */
  async verifyChain(): Promise<{ ok: true } | { ok: false; brokenAt: number }> {
    const events = await AuditEvent.query().orderBy('id', 'asc')
    let prevHash: string | null = null
    for (const event of events) {
      const expected = this.computeHash({
        actor: event.actor,
        action: event.action,
        subjectKind: event.subjectKind,
        subjectId: event.subjectId,
        outcome: event.outcome,
        reason: event.reason,
        details: event.details,
        prevHash,
      })
      if (event.prevHash !== prevHash || event.hash !== expected) {
        return { ok: false, brokenAt: event.id }
      }
      prevHash = event.hash
    }
    return { ok: true }
  }

  private computeHash(payload: Record<string, unknown>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort())
    return createHash('sha256').update(canonical).digest('hex')
  }
}

let cachedInstance: AuditLogger | null = null
export function auditLogger(): AuditLogger {
  if (!cachedInstance) cachedInstance = new AuditLogger()
  return cachedInstance
}

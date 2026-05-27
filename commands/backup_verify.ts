import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace backup:verify <path>` — open a snapshot and check that:
 *   - it's a SQLite file
 *   - the schema includes our expected tables
 *   - the audit_events hash chain verifies end-to-end
 *
 * Restore is a manual operation (`cp <backup> <db-path>` then restart);
 * v1.0 deliberately doesn't ship an in-place restore command because
 * doing it safely requires coordinating with a running daemon. Phase
 * 11+ adds that. Verification + manual restore is the operator
 * workflow for v1.0.
 */
export default class BackupVerify extends BaseCommand {
  static commandName = 'backup:verify'
  static description = 'Verify a SQLite snapshot has the expected schema + a clean audit chain'
  static options: CommandOptions = {
    startApp: false,
  }

  @args.string({ description: 'Path to a snapshot file' })
  declare path: string

  async run() {
    if (!this.path) {
      this.logger.error('path is required')
      this.exitCode = 1
      return
    }
    const { existsSync, statSync } = await import('node:fs')
    if (!existsSync(this.path)) {
      this.logger.error(`no file at ${this.path}`)
      this.exitCode = 1
      return
    }
    // better-sqlite3 doesn't ship .d.ts; we only need a tiny surface here.
    type Conn = {
      prepare: (sql: string) => {
        get: (...a: unknown[]) => unknown
        all: () => unknown[]
      }
      close: () => void
    }
    const mod = await import('better-sqlite3' as string)
    const Database = mod.default as new (
      path: string,
      opts: { readonly: boolean; fileMustExist: boolean }
    ) => Conn
    let conn: Conn
    try {
      conn = new Database(this.path, { readonly: true, fileMustExist: true })
    } catch (err) {
      this.logger.error(`cannot open as SQLite: ${(err as Error).message}`)
      this.exitCode = 1
      return
    }

    const expected = ['tasks', 'audit_events', 'policies', 'approvals', 'teams', 'cron_jobs']
    const missing: string[] = []
    for (const table of expected) {
      const row = conn
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table)
      if (!row) missing.push(table)
    }
    if (missing.length > 0) {
      this.logger.error(`missing tables: ${missing.join(', ')}`)
      conn.close()
      this.exitCode = 1
      return
    }

    // Walk the audit chain, recomputing each event's hash with the same
    // function the live logger uses so the two can't drift.
    const { computeAuditHash } = await import('#services/audit_hash')
    let prevHash: string | null = null
    let brokenAt: number | null = null
    const rows = conn
      .prepare(
        `SELECT id, actor, action, subject_kind, subject_id, outcome, reason, details, prev_hash, hash FROM audit_events ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>
    for (const row of rows) {
      const payload = {
        actor: row.actor,
        action: row.action,
        subjectKind: row.subject_kind,
        subjectId: row.subject_id,
        outcome: row.outcome,
        reason: row.reason,
        details: row.details,
        prevHash,
      }
      const expectedHash = computeAuditHash(payload)
      if (row.prev_hash !== prevHash || row.hash !== expectedHash) {
        brokenAt = row.id as number
        break
      }
      prevHash = row.hash as string
    }
    const size = statSync(this.path).size
    conn.close()

    if (brokenAt !== null) {
      this.logger.error(`audit chain broken at event id=${brokenAt}`)
      this.exitCode = 1
      return
    }
    this.logger.success(
      `${this.path} ok (${size} bytes, ${rows.length} audit events, chain verified)`
    )
  }
}

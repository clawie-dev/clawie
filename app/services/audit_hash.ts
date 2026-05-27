import { createHash } from 'node:crypto'

/**
 * Canonical SHA-256 of one audit event's content, chained to its predecessor
 * via the `prevHash` field. Shared by the live audit logger
 * (`#services/audit_logger`) and the standalone backup verifier
 * (`backup:verify`) so the two can never drift — a divergence between them
 * would make a clean chain look broken or hide a real tamper.
 *
 * Keys are sorted so serialization is insertion-order independent. Every
 * field passed here is a primitive (`details` is pre-stringified upstream),
 * so no nested object reaches `JSON.stringify` where the sorted-key replacer
 * would behave as a recursive allow-list.
 */
export function computeAuditHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

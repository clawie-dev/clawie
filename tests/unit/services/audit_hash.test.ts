import { test } from '@japa/runner'
import { computeAuditHash } from '#services/audit_hash'

const base = {
  actor: 'system',
  action: 'task.created',
  subjectKind: 'task',
  subjectId: 'abc',
  outcome: 'success',
  reason: null,
  details: '{"intent":"echo"}',
  prevHash: null,
}

test.group('services/audit_hash', () => {
  test('produces a 64-char hex sha256', ({ assert }) => {
    assert.match(computeAuditHash(base), /^[0-9a-f]{64}$/)
  })

  test('is deterministic for identical input', ({ assert }) => {
    assert.equal(computeAuditHash(base), computeAuditHash({ ...base }))
  })

  test('is insertion-order independent (keys are sorted before hashing)', ({ assert }) => {
    const reordered = {
      prevHash: base.prevHash,
      details: base.details,
      reason: base.reason,
      outcome: base.outcome,
      subjectId: base.subjectId,
      subjectKind: base.subjectKind,
      action: base.action,
      actor: base.actor,
    }
    assert.equal(computeAuditHash(base), computeAuditHash(reordered))
  })

  test('changing any field changes the hash', ({ assert }) => {
    assert.notEqual(computeAuditHash(base), computeAuditHash({ ...base, action: 'task.failed' }))
  })

  test('changing prevHash changes the hash (chain linkage)', ({ assert }) => {
    assert.notEqual(computeAuditHash(base), computeAuditHash({ ...base, prevHash: 'deadbeef' }))
  })
})

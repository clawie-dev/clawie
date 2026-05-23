import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { AuditLogger } from '#services/audit_logger'
import AuditEvent from '#models/audit_event'

test.group('services/audit_logger', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('records an event with a non-empty hash and null prevHash for the first event', async ({
    assert,
  }) => {
    const logger = new AuditLogger()
    const evt = await logger.record({
      actor: 'system',
      action: 'task.created',
      subjectKind: 'task',
      subjectId: 'abc',
      outcome: 'success',
    })
    assert.isString(evt.hash)
    assert.isAbove(evt.hash.length, 0)
    assert.isNull(evt.prevHash)
  })

  test('chains prevHash to the previous event hash', async ({ assert }) => {
    const logger = new AuditLogger()
    const a = await logger.record({ actor: 'system', action: 'a', outcome: 'success' })
    const b = await logger.record({ actor: 'system', action: 'b', outcome: 'success' })
    const c = await logger.record({ actor: 'system', action: 'c', outcome: 'success' })
    assert.equal(b.prevHash, a.hash)
    assert.equal(c.prevHash, b.hash)
  })

  test('verifyChain returns ok on a fresh sequence', async ({ assert }) => {
    const logger = new AuditLogger()
    await logger.record({ actor: 'system', action: 'a', outcome: 'success' })
    await logger.record({ actor: 'system', action: 'b', outcome: 'success' })
    const result = await logger.verifyChain()
    assert.deepEqual(result, { ok: true })
  })

  test('verifyChain detects tampering', async ({ assert }) => {
    const logger = new AuditLogger()
    const a = await logger.record({ actor: 'system', action: 'a', outcome: 'success' })
    await logger.record({ actor: 'system', action: 'b', outcome: 'success' })
    a.action = 'tampered'
    await a.save()
    const result = await logger.verifyChain()
    assert.equal(result.ok, false)
  })

  test('verifyChain handles an empty audit log', async ({ assert }) => {
    const logger = new AuditLogger()
    await AuditEvent.query().delete()
    const result = await logger.verifyChain()
    assert.deepEqual(result, { ok: true })
  })
})

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import AuditEvent from '#models/audit_event'

test.group('models/audit_event', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('parsedDetails returns null when details is null', async ({ assert }) => {
    const evt = await AuditEvent.create({
      actor: 'system',
      action: 'test',
      outcome: 'success',
      hash: 'x',
    })
    assert.isNull(evt.parsedDetails)
  })

  test('parsedDetails roundtrips JSON', async ({ assert }) => {
    const evt = await AuditEvent.create({
      actor: 'system',
      action: 'test',
      outcome: 'success',
      details: JSON.stringify({ key: 'value' }),
      hash: 'x',
    })
    assert.deepEqual(evt.parsedDetails, { key: 'value' })
  })
})

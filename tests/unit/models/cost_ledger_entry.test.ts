import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CostLedgerEntry from '#models/cost_ledger_entry'

test.group('models/cost_ledger_entry', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('usdCents and usdDollars accessors convert from tenths-of-cent', async ({ assert }) => {
    const row = await CostLedgerEntry.create({
      taskId: 't1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 5,
      usdTenthsOfCent: 123, // 12.3 cents = $0.123
      costUnknown: false,
    })
    assert.equal(row.usdCents, 12.3)
    assert.closeTo(row.usdDollars, 0.123, 1e-9)
  })

  test('costUnknown defaults to false', async ({ assert }) => {
    const row = await CostLedgerEntry.create({
      taskId: 't2',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 1,
      outputTokens: 1,
      usdTenthsOfCent: 0,
    })
    const reloaded = await CostLedgerEntry.findOrFail(row.id)
    assert.equal(reloaded.costUnknown, false)
  })

  test('round-trips persisted columns', async ({ assert }) => {
    await CostLedgerEntry.create({
      taskId: 'task-r',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      inputTokens: 100,
      outputTokens: 50,
      usdTenthsOfCent: 75,
      costUnknown: true,
    })
    const row = await CostLedgerEntry.query().where('task_id', 'task-r').firstOrFail()
    assert.equal(row.provider, 'anthropic')
    assert.equal(row.model, 'claude-haiku-4-5')
    assert.equal(row.inputTokens, 100)
    assert.equal(row.outputTokens, 50)
    assert.equal(row.usdTenthsOfCent, 75)
    assert.equal(row.costUnknown, true)
  })
})

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Policy from '#models/policy'
import { PolicyEngine } from '#services/policy_engine'

async function seedPolicy(
  partial: Partial<{
    name: string
    intentPattern: string
    predicates: string
    decision: 'allow' | 'deny' | 'requires_approval'
    priority: number
    createdBy: string
  }>
): Promise<Policy> {
  return Policy.create({
    name: partial.name ?? 'rule',
    intentPattern: partial.intentPattern ?? '*',
    predicates: partial.predicates ?? '{}',
    decision: partial.decision ?? 'allow',
    priority: partial.priority ?? 0,
    createdBy: partial.createdBy ?? 'test',
  })
}

test.group('services/policy_engine', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('default-deny: empty policy table → requires_approval', async ({ assert }) => {
    const result = await new PolicyEngine().decide({
      intent: 'chat',
      payload: {},
      actor: 't',
    })
    assert.equal(result.decision, 'requires_approval')
    assert.match(result.reason, /default-deny/)
  })

  test('intent_pattern "*" matches any intent', async ({ assert }) => {
    await seedPolicy({ intentPattern: '*', decision: 'allow' })
    const r1 = await new PolicyEngine().decide({ intent: 'echo', payload: {}, actor: 't' })
    const r2 = await new PolicyEngine().decide({ intent: 'chat', payload: {}, actor: 't' })
    assert.equal(r1.decision, 'allow')
    assert.equal(r2.decision, 'allow')
  })

  test('exact intent_pattern beats catch-all only via priority', async ({ assert }) => {
    await seedPolicy({ intentPattern: '*', decision: 'allow', priority: 1 })
    await seedPolicy({ intentPattern: 'chat', decision: 'deny', priority: 10 })

    const r = await new PolicyEngine().decide({ intent: 'chat', payload: {}, actor: 't' })
    assert.equal(r.decision, 'deny')
    assert.equal(r.ruleName, 'rule')
  })

  test('predicate match against payload via dot-paths', async ({ assert }) => {
    await seedPolicy({
      name: 'cheap-claude',
      intentPattern: 'chat',
      predicates: JSON.stringify({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      }),
      decision: 'allow',
      priority: 10,
    })

    const matching = await new PolicyEngine().decide({
      intent: 'chat',
      payload: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      actor: 't',
    })
    const wrongModel = await new PolicyEngine().decide({
      intent: 'chat',
      payload: { provider: 'anthropic', model: 'claude-opus-4-7' },
      actor: 't',
    })
    assert.equal(matching.decision, 'allow')
    assert.equal(wrongModel.decision, 'requires_approval')
  })

  test('ties on priority resolve to the most restrictive decision', async ({ assert }) => {
    await seedPolicy({ name: 'permissive', intentPattern: 'chat', decision: 'allow', priority: 5 })
    await seedPolicy({ name: 'strict', intentPattern: 'chat', decision: 'deny', priority: 5 })

    const r = await new PolicyEngine().decide({
      intent: 'chat',
      payload: {},
      actor: 't',
    })
    assert.equal(r.decision, 'deny')
    assert.equal(r.ruleName, 'strict')
  })

  test('higher priority always wins over lower priority', async ({ assert }) => {
    await seedPolicy({ name: 'low-deny', intentPattern: '*', decision: 'deny', priority: 1 })
    await seedPolicy({ name: 'high-allow', intentPattern: '*', decision: 'allow', priority: 10 })
    const r = await new PolicyEngine().decide({ intent: 'echo', payload: {}, actor: 't' })
    assert.equal(r.decision, 'allow')
    assert.equal(r.ruleName, 'high-allow')
  })

  test('nested-path predicates work via dot notation', async ({ assert }) => {
    await seedPolicy({
      name: 'cap',
      intentPattern: 'chat',
      predicates: JSON.stringify({ 'options.max_tokens': 100 }),
      decision: 'allow',
      priority: 5,
    })
    const r = await new PolicyEngine().decide({
      intent: 'chat',
      payload: { options: { max_tokens: 100 } },
      actor: 't',
    })
    assert.equal(r.decision, 'allow')
  })

  test('non-matching predicate falls through to default-deny', async ({ assert }) => {
    await seedPolicy({
      intentPattern: 'chat',
      predicates: JSON.stringify({ provider: 'anthropic' }),
      decision: 'allow',
      priority: 5,
    })
    const r = await new PolicyEngine().decide({
      intent: 'chat',
      payload: { provider: 'openai' },
      actor: 't',
    })
    assert.equal(r.decision, 'requires_approval')
  })
})

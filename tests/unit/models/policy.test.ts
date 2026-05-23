import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Policy from '#models/policy'

test.group('models/policy', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('parsedPredicates returns the JSON object', async ({ assert }) => {
    const p = await Policy.create({
      name: 'rule',
      intentPattern: '*',
      predicates: JSON.stringify({ provider: 'anthropic' }),
      decision: 'allow',
      priority: 0,
      createdBy: 't',
    })
    assert.deepEqual(p.parsedPredicates, { provider: 'anthropic' })
  })

  test('parsedPredicates returns empty object on malformed JSON', async ({ assert }) => {
    const p = await Policy.create({
      name: 'rule',
      intentPattern: '*',
      predicates: 'not-json',
      decision: 'allow',
      priority: 0,
      createdBy: 't',
    })
    assert.deepEqual(p.parsedPredicates, {})
  })

  test('parsedPredicates returns empty object for non-object JSON', async ({ assert }) => {
    const p = await Policy.create({
      name: 'rule',
      intentPattern: '*',
      predicates: '"a string"',
      decision: 'allow',
      priority: 0,
      createdBy: 't',
    })
    assert.deepEqual(p.parsedPredicates, {})
  })
})

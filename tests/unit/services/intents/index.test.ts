import { test } from '@japa/runner'
import { registerBuiltinIntents, resetIntentsForTest } from '#services/intents/index'
import { intentRegistry } from '#services/intents/registry'

test.group('services/intents/index', (group) => {
  group.each.setup(() => {
    resetIntentsForTest()
    return () => resetIntentsForTest()
  })

  test('registerBuiltinIntents registers echo', async ({ assert }) => {
    registerBuiltinIntents()
    assert.isTrue(intentRegistry().has('echo'))
  })

  test('registerBuiltinIntents is idempotent', async ({ assert }) => {
    registerBuiltinIntents()
    registerBuiltinIntents()
    registerBuiltinIntents()
    assert.deepEqual(intentRegistry().list(), ['echo'])
  })
})

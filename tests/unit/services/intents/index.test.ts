import { test } from '@japa/runner'
import { registerBuiltinIntents, resetIntentsForTest } from '#services/intents/index'
import { intentRegistry } from '#services/intents/registry'

test.group('services/intents/index', (group) => {
  group.each.setup(() => {
    resetIntentsForTest()
    return () => resetIntentsForTest()
  })

  test('registerBuiltinIntents registers echo and chat', async ({ assert }) => {
    registerBuiltinIntents()
    assert.isTrue(intentRegistry().has('echo'))
    assert.isTrue(intentRegistry().has('chat'))
  })

  test('registerBuiltinIntents is idempotent', async ({ assert }) => {
    registerBuiltinIntents()
    registerBuiltinIntents()
    registerBuiltinIntents()
    assert.deepEqual(intentRegistry().list(), ['chat', 'echo'])
  })
})

import { test } from '@japa/runner'
import { registerBuiltinIntents, resetIntentsForTest } from '#services/intents/index'
import { intentRegistry } from '#services/intents/registry'

test.group('services/intents/index', (group) => {
  group.each.setup(() => {
    resetIntentsForTest()
    return () => resetIntentsForTest()
  })

  test('registerBuiltinIntents registers echo, chat, and agent.self_mod', async ({ assert }) => {
    registerBuiltinIntents()
    assert.isTrue(intentRegistry().has('echo'))
    assert.isTrue(intentRegistry().has('chat'))
    assert.isTrue(intentRegistry().has('agent.self_mod'))
  })

  test('registerBuiltinIntents is idempotent', async ({ assert }) => {
    registerBuiltinIntents()
    registerBuiltinIntents()
    registerBuiltinIntents()
    assert.deepEqual(intentRegistry().list(), ['agent.self_mod', 'chat', 'echo'])
  })
})

import { test } from '@japa/runner'
import { IntentRegistry } from '#services/intents/registry'

test.group('services/intents/registry', () => {
  test('register + has + get + list work as expected', async ({ assert }) => {
    const reg = new IntentRegistry()
    reg.register('foo', async () => ({ ok: true, output: 1 }))
    reg.register('bar', async () => ({ ok: true, output: 2 }))
    assert.isTrue(reg.has('foo'))
    assert.isTrue(reg.has('bar'))
    assert.isFalse(reg.has('baz'))
    assert.deepEqual(reg.list(), ['bar', 'foo'])
    assert.isFunction(reg.get('foo'))
  })

  test('register throws on empty name', async ({ assert }) => {
    const reg = new IntentRegistry()
    assert.throws(() => reg.register('', async () => ({ ok: true, output: 0 })))
  })

  test('register throws on duplicate name', async ({ assert }) => {
    const reg = new IntentRegistry()
    reg.register('x', async () => ({ ok: true, output: 0 }))
    assert.throws(() => reg.register('x', async () => ({ ok: true, output: 0 })))
  })

  test('clear empties the registry', async ({ assert }) => {
    const reg = new IntentRegistry()
    reg.register('x', async () => ({ ok: true, output: 0 }))
    reg.clear()
    assert.isFalse(reg.has('x'))
    assert.deepEqual(reg.list(), [])
  })
})

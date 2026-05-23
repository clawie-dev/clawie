import { test } from '@japa/runner'
import { echoIntent } from '#services/intents/echo'

test.group('services/intents/echo', () => {
  test('returns hello: <string payload>', async ({ assert }) => {
    const out = await echoIntent({ taskId: 't1', payload: 'world' })
    assert.deepEqual(out, { ok: true, output: { message: 'hello: world' } })
  })

  test('stringifies object payload', async ({ assert }) => {
    const out = await echoIntent({ taskId: 't1', payload: { a: 1 } })
    assert.equal(out.ok, true)
    if (out.ok) {
      assert.deepEqual(out.output, { message: 'hello: {"a":1}' })
    }
  })

  test('returns empty hello for null payload', async ({ assert }) => {
    const out = await echoIntent({ taskId: 't1', payload: null })
    assert.deepEqual(out, { ok: true, output: { message: 'hello: ' } })
  })

  test('fails deterministically when payload.__fail is true', async ({ assert }) => {
    const out = await echoIntent({ taskId: 't1', payload: { __fail: true } })
    assert.deepEqual(out, {
      ok: false,
      cause: 'intentional_failure',
      detail: 'payload requested failure',
    })
  })
})

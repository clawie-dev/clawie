import { test } from '@japa/runner'
import { createTaskValidator } from '#validators/task'

test.group('validators/task', () => {
  test('accepts a valid create-task payload', async ({ assert }) => {
    const out = await createTaskValidator.validate({
      intent: 'echo',
      payload: { hello: 'world' },
    })
    assert.equal(out.intent, 'echo')
  })

  test('rejects missing intent', async ({ assert }) => {
    await assert.rejects(() => createTaskValidator.validate({}))
  })

  test('rejects too-long intent', async ({ assert }) => {
    await assert.rejects(() =>
      createTaskValidator.validate({ intent: 'a'.repeat(65), payload: null })
    )
  })

  test('accepts optional idempotencyKey', async ({ assert }) => {
    const out = await createTaskValidator.validate({
      intent: 'echo',
      payload: null,
      idempotencyKey: 'abc',
    })
    assert.equal(out.idempotencyKey, 'abc')
  })
})

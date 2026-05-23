import { test } from '@japa/runner'
import {
  credentialBroker,
  setCredentialBrokerForTest,
  PROVIDER_ENV_VAR,
} from '#services/credential_broker'

test.group('services/credential_broker', (group) => {
  // The default broker reads from process.env; back up + restore.
  let saved: Record<string, string | undefined>
  group.each.setup(() => {
    saved = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    }
    setCredentialBrokerForTest(null)
  })
  group.each.teardown(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    setCredentialBrokerForTest(null)
  })

  test('PROVIDER_ENV_VAR maps providers to env var names', ({ assert }) => {
    assert.equal(PROVIDER_ENV_VAR.anthropic, 'ANTHROPIC_API_KEY')
    assert.equal(PROVIDER_ENV_VAR.openai, 'OPENAI_API_KEY')
  })

  test('envFor includes only providers whose env vars are set', ({ assert }) => {
    process.env.ANTHROPIC_API_KEY = 'ant-key'
    delete process.env.OPENAI_API_KEY
    const env = credentialBroker().envFor(['anthropic', 'openai'])
    assert.deepEqual(env, { ANTHROPIC_API_KEY: 'ant-key' })
  })

  test('envFor returns empty object when nothing is set', ({ assert }) => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    const env = credentialBroker().envFor(['anthropic', 'openai'])
    assert.deepEqual(env, {})
  })

  test('envFor ignores empty-string env vars', ({ assert }) => {
    process.env.ANTHROPIC_API_KEY = ''
    const env = credentialBroker().envFor(['anthropic'])
    assert.deepEqual(env, {})
  })

  test('setCredentialBrokerForTest replaces the singleton', ({ assert }) => {
    setCredentialBrokerForTest({
      envFor: () => ({ FAKE: 'value' }),
    })
    assert.deepEqual(credentialBroker().envFor(['anthropic']), { FAKE: 'value' })
  })
})

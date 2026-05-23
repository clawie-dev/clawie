import { test } from '@japa/runner'
import {
  NullEgressProvider,
  egressProvider,
  setEgressProviderForTest,
  type EgressProvider,
} from '#services/egress/provider'
import type { SpawnRequest } from '#services/container_spawner'

const SAMPLE_REQUEST: SpawnRequest = {
  image: 'clawie/agent-runtime:0.4.1',
  spec: { intent: 'chat', task_id: 't-1', payload: null },
  network: 'bridge',
}

test.group('services/egress/provider', (group) => {
  group.each.teardown(() => setEgressProviderForTest(null))

  test('default provider is NullEgressProvider', async ({ assert }) => {
    setEgressProviderForTest(null)
    assert.equal(egressProvider().name, 'null')
  })

  test('NullEgressProvider returns the request unchanged', async ({ assert }) => {
    const wrapped = await new NullEgressProvider().wrap(SAMPLE_REQUEST, { intentName: 'chat' })
    assert.equal(wrapped, SAMPLE_REQUEST)
  })

  test('setEgressProviderForTest swaps the singleton', async ({ assert }) => {
    const fake: EgressProvider = {
      name: 'fake',
      async wrap(req) {
        return { ...req, env: { TEST_INJECTED: 'yes' } }
      },
    }
    setEgressProviderForTest(fake)
    const result = await egressProvider().wrap(SAMPLE_REQUEST, { intentName: 'chat' })
    assert.equal(egressProvider().name, 'fake')
    assert.equal(result.env?.TEST_INJECTED, 'yes')
  })

  test('intentName is passed through to the provider context', async ({ assert }) => {
    let captured = ''
    const recorder: EgressProvider = {
      name: 'recorder',
      async wrap(req, ctx) {
        captured = ctx.intentName
        return req
      },
    }
    setEgressProviderForTest(recorder)
    await egressProvider().wrap(SAMPLE_REQUEST, { intentName: 'echo' })
    assert.equal(captured, 'echo')
  })
})

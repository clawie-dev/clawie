import { test } from '@japa/runner'
import { selectEgressProviderFromEnv } from '#services/egress/index'

test.group('services/egress/index', (group) => {
  // Save + restore env so tests stay isolated.
  let saved: Record<string, string | undefined>
  group.each.setup(() => {
    saved = {
      CLAWIE_EGRESS: process.env.CLAWIE_EGRESS,
      OUTCALL_HOST_SOCKET: process.env.OUTCALL_HOST_SOCKET,
    }
  })
  group.each.teardown(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test('default (unset) returns the null provider', async ({ assert }) => {
    delete process.env.CLAWIE_EGRESS
    const provider = await selectEgressProviderFromEnv()
    assert.equal(provider.name, 'null')
  })

  test('explicit "null" returns the null provider', async ({ assert }) => {
    process.env.CLAWIE_EGRESS = 'null'
    const provider = await selectEgressProviderFromEnv()
    assert.equal(provider.name, 'null')
  })

  test('unknown value falls back to null', async ({ assert }) => {
    process.env.CLAWIE_EGRESS = 'nonsense'
    const provider = await selectEgressProviderFromEnv()
    assert.equal(provider.name, 'null')
  })

  test('CLAWIE_EGRESS=outcall with unreachable daemon degrades to null', async ({ assert }) => {
    process.env.CLAWIE_EGRESS = 'outcall'
    process.env.OUTCALL_HOST_SOCKET = '/tmp/does-not-exist-clawie-test.sock'
    const provider = await selectEgressProviderFromEnv()
    assert.equal(provider.name, 'null')
  })
})

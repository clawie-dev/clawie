import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  ContainerSpawner,
  setContainerSpawnerForTest,
  type ProcessRunner,
} from '#services/container_spawner'
import { containerDispatch, AGENT_RUNTIME_IMAGE } from '#services/intents/dispatch'
import AuditEvent from '#models/audit_event'
import CostLedgerEntry from '#models/cost_ledger_entry'

function spawnerWithStdout(stdout: string, opts: { exitCode?: number; stderr?: string } = {}) {
  const runner: ProcessRunner = async () => ({
    exitCode: opts.exitCode ?? 0,
    stdout,
    stderr: opts.stderr ?? '',
    signal: null,
    timedOut: false,
  })
  return new ContainerSpawner({ runner })
}

test.group('services/intents/dispatch', (group) => {
  // Audit logger writes to the DB on every spawn lifecycle event.
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => setContainerSpawnerForTest(null))

  test('returns ok outcome when container returns ok envelope', async ({ assert }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(JSON.stringify({ ok: true, output: { message: 'hello: hi' } }))
    )
    const handler = containerDispatch('echo')
    const outcome = await handler({ taskId: 't1', payload: 'hi' })
    assert.deepEqual(outcome, { ok: true, output: { message: 'hello: hi' } })
  })

  test('maps failure cause and detail through unchanged', async ({ assert }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(
        JSON.stringify({ ok: false, cause: 'intentional_failure', detail: 'requested' }),
        { exitCode: 1 }
      )
    )
    const outcome = await containerDispatch('echo')({
      taskId: 't2',
      payload: { __fail: true },
    })
    assert.deepEqual(outcome, {
      ok: false,
      cause: 'intentional_failure',
      detail: 'requested',
    })
  })

  test('reports invalid_envelope when container emits non-JSON', async ({ assert }) => {
    setContainerSpawnerForTest(spawnerWithStdout('garbage'))
    const outcome = await containerDispatch('echo')({ taskId: 't3', payload: null })
    assert.isFalse(outcome.ok)
    if (!outcome.ok) assert.equal(outcome.cause, 'invalid_envelope')
  })

  test('forwards intent name, taskId, and payload to the container spec', async ({ assert }) => {
    let capturedStdin = ''
    const runner: ProcessRunner = async (_bin, _args, stdin) => {
      capturedStdin = stdin
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    setContainerSpawnerForTest(new ContainerSpawner({ runner }))
    await containerDispatch('echo')({ taskId: 'task-xyz', payload: { a: 1 } })
    const parsed = JSON.parse(capturedStdin)
    assert.equal(parsed.intent, 'echo')
    assert.equal(parsed.task_id, 'task-xyz')
    assert.deepEqual(parsed.payload, { a: 1 })
  })

  test('passes a custom image override into the spawn request', async ({ assert }) => {
    let capturedArgs: string[] = []
    const runner: ProcessRunner = async (_bin, args) => {
      capturedArgs = args
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: null }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    setContainerSpawnerForTest(new ContainerSpawner({ runner }))
    await containerDispatch('echo', { image: 'custom/image:dev' })({
      taskId: 't',
      payload: null,
    })
    assert.equal(capturedArgs[capturedArgs.length - 1], 'custom/image:dev')
  })

  test('exposes the pinned agent-runtime image tag', ({ assert }) => {
    assert.equal(AGENT_RUNTIME_IMAGE, 'clawie/agent-runtime:0.4.0')
  })

  test('sidecar mode injects credentials into the sidecar, not the agent', async ({ assert }) => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const calls: string[][] = []
    const runner: ProcessRunner = async (_bin, args) => {
      calls.push(args)
      if (args[0] === 'run' && args.includes('-d')) {
        return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
      }
      if (args[0] === 'stop') {
        return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, output: { provider: 'anthropic' } }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }
    setContainerSpawnerForTest(new ContainerSpawner({ runner }))
    const { containerDispatch: cd } = await import('#services/intents/dispatch')
    await cd('chat', {
      network: 'sidecar',
      credentialProviders: ['anthropic'],
    })({ taskId: 'sidecar-test', payload: null })
    delete process.env.ANTHROPIC_API_KEY

    const sidecarStart = calls.find((c) => c[0] === 'run' && c.includes('-d'))
    const agentRun = calls.find((c) => c[0] === 'run' && !c.includes('-d'))
    assert.exists(sidecarStart)
    assert.exists(agentRun)
    // sidecar received the credential
    const sidecarHasKey = sidecarStart!.some((a) => a === 'ANTHROPIC_API_KEY=sk-test')
    assert.isTrue(sidecarHasKey)
    // agent did NOT get the credential -- only OUTCALL_URL
    const agentHasKey = agentRun!.some((a) => a === 'ANTHROPIC_API_KEY=sk-test')
    const agentHasOutcallUrl = agentRun!.some((a) => a === 'OUTCALL_URL=http://localhost:8080')
    assert.isFalse(agentHasKey)
    assert.isTrue(agentHasOutcallUrl)
  })

  test('emits container.spawn_started + container.spawn_completed on success', async ({
    assert,
  }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(JSON.stringify({ ok: true, output: { message: 'hello: x' } }))
    )
    await containerDispatch('echo')({ taskId: 'task-a', payload: 'x' })

    const events = await AuditEvent.query().where('subject_id', 'task-a').orderBy('id', 'asc')
    const actions = events.map((e) => e.action)
    assert.deepEqual(actions, ['container.spawn_started', 'container.spawn_completed'])
    assert.equal(events[1].outcome, 'success')
  })

  test('writes a cost_ledger row + cost.recorded audit when envelope includes cost', async ({
    assert,
  }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(
        JSON.stringify({
          ok: true,
          output: {
            completion: 'hi back',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 10, output_tokens: 5 },
            cost: { usd_cents: 0.12 },
          },
        })
      )
    )
    await containerDispatch('chat')({ taskId: 'cost-task', payload: null })

    const rows = await CostLedgerEntry.query().where('task_id', 'cost-task')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].provider, 'anthropic')
    assert.equal(rows[0].model, 'claude-sonnet-4-6')
    assert.equal(rows[0].inputTokens, 10)
    assert.equal(rows[0].outputTokens, 5)
    // 0.12 cents -> 1.2 tenths -> round to nearest int -> 1
    assert.equal(rows[0].usdTenthsOfCent, 1)

    const events = await AuditEvent.query().where('subject_id', 'cost-task').orderBy('id', 'asc')
    const actions = events.map((e) => e.action)
    assert.includeMembers(actions, ['cost.recorded', 'container.spawn_completed'])
  })

  test('skips cost_ledger when envelope output lacks provider/model/usage', async ({ assert }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(JSON.stringify({ ok: true, output: { message: 'hello: x' } }))
    )
    await containerDispatch('echo')({ taskId: 'no-cost', payload: 'x' })

    const rows = await CostLedgerEntry.query().where('task_id', 'no-cost')
    assert.equal(rows.length, 0)
  })

  test('records cost row with cost_unknown=true when provider model is not priced', async ({
    assert,
  }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(
        JSON.stringify({
          ok: true,
          output: {
            completion: 'x',
            provider: 'anthropic',
            model: 'claude-mystery-9',
            usage: { input_tokens: 1, output_tokens: 1 },
            cost: null,
            cost_unknown: true,
          },
        })
      )
    )
    await containerDispatch('chat')({ taskId: 'unknown-cost', payload: null })

    const rows = await CostLedgerEntry.query().where('task_id', 'unknown-cost')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].usdTenthsOfCent, 0)
    assert.equal(rows[0].costUnknown, true)
  })

  test('emits container.spawn_failed (outcome=failure) when container reports failure', async ({
    assert,
  }) => {
    setContainerSpawnerForTest(
      spawnerWithStdout(JSON.stringify({ ok: false, cause: 'intentional_failure', detail: 'no' }), {
        exitCode: 1,
      })
    )
    await containerDispatch('echo')({ taskId: 'task-b', payload: { __fail: true } })

    const events = await AuditEvent.query().where('subject_id', 'task-b').orderBy('id', 'asc')
    const actions = events.map((e) => e.action)
    assert.deepEqual(actions, ['container.spawn_started', 'container.spawn_failed'])
    assert.equal(events[1].outcome, 'failure')
    assert.equal(events[1].reason, 'intentional_failure')
  })
})

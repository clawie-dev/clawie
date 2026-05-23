import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import CronJob from '#models/cron_job'
import Task from '#models/task'
import { Scheduler } from '#services/scheduler'
import { resetIntentsForTest, registerBuiltinIntents } from '#services/intents/index'
import { setContainerSpawnerForTest } from '#services/container_spawner'
import { setPolicyEngineForTest } from '#services/policy_engine'
import { fakeContainerSpawner } from '#tests/helpers/fake_spawner'
import { installAllowAllPolicy } from '#tests/helpers/allow_all_policy'

async function seedJob(
  overrides: Partial<{
    name: string
    cronExpression: string
    intent: string
    payload: unknown
    nextRunAt: DateTime
    enabled: boolean
    teamSlug: string | null
  }> = {}
) {
  const now = DateTime.utc()
  return CronJob.create({
    name: overrides.name ?? 'job-1',
    cronExpression: overrides.cronExpression ?? '* * * * *',
    intent: overrides.intent ?? 'echo',
    payloadTemplate: JSON.stringify(overrides.payload ?? 'hello'),
    teamSlug: overrides.teamSlug ?? null,
    enabled: overrides.enabled ?? true,
    lastRunAt: null,
    nextRunAt: overrides.nextRunAt ?? now.minus({ minutes: 1 }),
    lastTaskId: null,
    createdAt: now,
  })
}

test.group('services/scheduler', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    resetIntentsForTest()
    registerBuiltinIntents()
    setContainerSpawnerForTest(fakeContainerSpawner())
    installAllowAllPolicy()
    return () => {
      resetIntentsForTest()
      setContainerSpawnerForTest(null)
      setPolicyEngineForTest(null)
    }
  })

  test('tick fires due jobs and advances next_run_at', async ({ assert }) => {
    const job = await seedJob({ nextRunAt: DateTime.utc().minus({ minutes: 1 }) })
    const result = await new Scheduler().tick()
    assert.equal(result.firedJobs, 1)
    const reloaded = await CronJob.findOrFail(job.id)
    assert.exists(reloaded.lastTaskId)
    assert.isAbove(reloaded.nextRunAt.toMillis(), DateTime.utc().toMillis())
  })

  test('tick creates a task with the job intent and payload', async ({ assert }) => {
    await seedJob({ intent: 'echo', payload: { custom: true } })
    await new Scheduler().tick()
    const tasks = await Task.query()
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].intent, 'echo')
    assert.deepEqual(tasks[0].parsedPayload, { custom: true })
  })

  test('tick skips disabled jobs', async ({ assert }) => {
    await seedJob({ enabled: false })
    const result = await new Scheduler().tick()
    assert.equal(result.firedJobs, 0)
  })

  test('tick skips jobs whose next_run_at is still in the future', async ({ assert }) => {
    await seedJob({ nextRunAt: DateTime.utc().plus({ hours: 1 }) })
    const result = await new Scheduler().tick()
    assert.equal(result.firedJobs, 0)
  })

  test('tick forwards teamSlug into the created task', async ({ assert }) => {
    await seedJob({ teamSlug: 'engineering' })
    await new Scheduler().tick()
    const tasks = await Task.query()
    assert.equal(tasks[0].teamSlug, 'engineering')
  })
})

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import CronJob from '#models/cron_job'

test.group('models/cron_job', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('parsedPayload decodes the JSON column', async ({ assert }) => {
    const j = await CronJob.create({
      name: 'j1',
      cronExpression: '0 * * * *',
      intent: 'echo',
      payloadTemplate: JSON.stringify({ k: 1 }),
      teamSlug: null,
      enabled: true,
      lastRunAt: null,
      nextRunAt: DateTime.utc(),
      lastTaskId: null,
      createdAt: DateTime.utc(),
    })
    assert.deepEqual(j.parsedPayload, { k: 1 })
  })

  test('name is unique', async ({ assert }) => {
    await CronJob.create({
      name: 'dup',
      cronExpression: '* * * * *',
      intent: 'echo',
      payloadTemplate: 'null',
      teamSlug: null,
      enabled: true,
      lastRunAt: null,
      nextRunAt: DateTime.utc(),
      lastTaskId: null,
      createdAt: DateTime.utc(),
    })
    await assert.rejects(() =>
      CronJob.create({
        name: 'dup',
        cronExpression: '* * * * *',
        intent: 'echo',
        payloadTemplate: 'null',
        teamSlug: null,
        enabled: true,
        lastRunAt: null,
        nextRunAt: DateTime.utc(),
        lastTaskId: null,
        createdAt: DateTime.utc(),
      })
    )
  })
})

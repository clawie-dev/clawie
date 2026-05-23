import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import WebhookSubscription from '#models/webhook_subscription'

function sub(pattern: string) {
  const s = new WebhookSubscription()
  s.name = 'x'
  s.url = 'http://x'
  s.eventPattern = pattern
  s.enabled = true
  s.createdAt = DateTime.utc()
  return s
}

test.group('models/webhook_subscription', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('matches "*" wildcard', ({ assert }) => {
    assert.isTrue(sub('*').matches('task.completed'))
    assert.isTrue(sub('*').matches('anything'))
  })

  test('matches prefix glob "task.*"', ({ assert }) => {
    assert.isTrue(sub('task.*').matches('task.completed'))
    assert.isTrue(sub('task.*').matches('task.failed'))
    assert.isFalse(sub('task.*').matches('approval.granted'))
  })

  test('matches exact name', ({ assert }) => {
    assert.isTrue(sub('cron.fired').matches('cron.fired'))
    assert.isFalse(sub('cron.fired').matches('cron.fire_failed'))
  })

  test('name uniqueness on the DB level', async ({ assert }) => {
    await WebhookSubscription.create({
      name: 'dup',
      url: 'http://a',
      eventPattern: '*',
      enabled: true,
      createdAt: DateTime.utc(),
    })
    await assert.rejects(() =>
      WebhookSubscription.create({
        name: 'dup',
        url: 'http://b',
        eventPattern: '*',
        enabled: true,
        createdAt: DateTime.utc(),
      })
    )
  })
})

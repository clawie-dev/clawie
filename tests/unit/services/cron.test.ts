import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { parseCron, nextFiring } from '#services/cron'

test.group('services/cron', () => {
  test('parses standard 5-field expression', ({ assert }) => {
    const c = parseCron('0 * * * *')
    assert.equal(c.minute.matches.size, 1)
    assert.isTrue(c.minute.matches.has(0))
    assert.equal(c.hour.matches.size, 24)
  })

  test('parses ranges and lists', ({ assert }) => {
    const c = parseCron('0,15,30,45 9-17 * * 1-5')
    assert.equal(c.minute.matches.size, 4)
    assert.equal(c.hour.matches.size, 9) // 9..17
    assert.equal(c.dayOfWeek.matches.size, 5) // Mon..Fri
  })

  test('parses step values', ({ assert }) => {
    const c = parseCron('*/15 * * * *')
    assert.deepEqual(
      [...c.minute.matches].sort((a, b) => a - b),
      [0, 15, 30, 45]
    )
  })

  test('parses a step on an explicit range', ({ assert }) => {
    const c = parseCron('5-59/15 * * * *')
    assert.deepEqual(
      [...c.minute.matches].sort((a, b) => a - b),
      [5, 20, 35, 50]
    )
  })

  test('rejects a step on a bare value', ({ assert }) => {
    assert.throws(() => parseCron('5/15 * * * *'), /step needs "\*" or a range/)
  })

  test('rejects wrong field count', ({ assert }) => {
    assert.throws(() => parseCron('* * *'), /5 fields/)
  })

  test('rejects out-of-range', ({ assert }) => {
    assert.throws(() => parseCron('60 * * * *'), /outside range/)
  })

  test('nextFiring for "0 9 * * *" gives 09:00 same day if before, next day if after', ({
    assert,
  }) => {
    const morning = DateTime.fromISO('2026-05-23T08:00:00Z', { zone: 'utc' })
    const next1 = nextFiring('0 9 * * *', morning)
    assert.equal(next1.toISO(), '2026-05-23T09:00:00.000Z')

    const afternoon = DateTime.fromISO('2026-05-23T10:00:00Z', { zone: 'utc' })
    const next2 = nextFiring('0 9 * * *', afternoon)
    assert.equal(next2.toISO(), '2026-05-24T09:00:00.000Z')
  })

  test('nextFiring for every minute returns the next minute', ({ assert }) => {
    const t = DateTime.fromISO('2026-05-23T12:34:56Z', { zone: 'utc' })
    const next = nextFiring('* * * * *', t)
    assert.equal(next.toISO(), '2026-05-23T12:35:00.000Z')
  })

  test('nextFiring for weekday-only skips weekend', ({ assert }) => {
    // 2026-05-23 is a Saturday. dow=1..5 (Mon..Fri) using POSIX cron (1..5).
    const sat = DateTime.fromISO('2026-05-23T10:00:00Z', { zone: 'utc' })
    const next = nextFiring('0 9 * * 1-5', sat)
    // Next Mon 09:00 UTC = 2026-05-25T09:00
    assert.equal(next.toISO(), '2026-05-25T09:00:00.000Z')
  })
})

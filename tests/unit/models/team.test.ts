import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Team from '#models/team'

test.group('models/team', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('round-trips persisted columns', async ({ assert }) => {
    const t = await Team.create({
      slug: 'engineering',
      name: 'Engineering',
      description: 'Coders + devops',
      createdAt: DateTime.utc(),
    })
    const r = await Team.findOrFail(t.id)
    assert.equal(r.slug, 'engineering')
    assert.equal(r.name, 'Engineering')
  })

  test('slug is unique', async ({ assert }) => {
    await Team.create({ slug: 'dup', name: 'A', description: null, createdAt: DateTime.utc() })
    await assert.rejects(() =>
      Team.create({ slug: 'dup', name: 'B', description: null, createdAt: DateTime.utc() })
    )
  })
})

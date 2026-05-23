import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'audit_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('actor', 64).notNullable().index()
      table.string('action', 64).notNullable().index()
      table.string('subject_kind', 32).nullable()
      table.string('subject_id', 64).nullable().index()
      table.string('outcome', 32).notNullable()
      table.text('reason').nullable()
      table.text('details').nullable()
      table.string('prev_hash', 64).nullable()
      table.string('hash', 64).notNullable()
      table.timestamp('created_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

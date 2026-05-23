import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'cost_ledger'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('task_id', 64).notNullable().index()
      table.string('provider', 16).notNullable()
      table.string('model', 64).notNullable()
      table.integer('input_tokens').notNullable()
      table.integer('output_tokens').notNullable()
      // USD cents at 1 decimal precision -> stored as integer tenths-of-a-cent.
      // 100 = 1 cent, 10 = 0.1 cent. Phase 3 stub; spec 007 will revisit.
      table.integer('usd_tenths_of_cent').notNullable()
      table.boolean('cost_unknown').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

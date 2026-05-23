import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'policies'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('name', 128).notNullable()
      // '*' matches any intent; otherwise an exact intent name.
      table.string('intent_pattern', 64).notNullable().index()
      // JSON of {path: expected_value} predicates. Empty object {} = match-any.
      table.text('predicates').notNullable()
      table.string('decision', 16).notNullable() // allow | deny | requires_approval
      table.integer('priority').notNullable().defaultTo(0)
      table.string('created_by', 64).notNullable()
      table.timestamp('created_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'approvals'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('task_id', 64).notNullable().unique().index()
      table.string('status', 16).notNullable().index() // pending | approved | denied | expired
      table.timestamp('requested_at').notNullable().index()
      table.timestamp('deadline_at').notNullable().index()
      table.string('decided_by', 64).nullable()
      table.timestamp('decided_at').nullable()
      table.text('reason').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

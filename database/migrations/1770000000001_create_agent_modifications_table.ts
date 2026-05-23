import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'agent_modifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('agent_name', 128).notNullable().index()
      table.string('task_id', 64).notNullable().unique().index()
      table.string('status', 16).notNullable().index() // pending | applied | rejected
      table.text('diff').notNullable() // unified diff against current AgentDefinition
      table.text('proposed_changes').notNullable() // JSON: [{path, content}]
      table.string('decided_by', 64).nullable()
      table.timestamp('decided_at').nullable()
      table.text('reason').nullable()
      table.timestamp('created_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

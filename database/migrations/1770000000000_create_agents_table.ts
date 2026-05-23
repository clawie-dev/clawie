import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'agents'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('name', 128).notNullable().unique().index()
      table.text('soul').notNullable() // SOUL.md raw content
      table.text('agents_yaml').notNullable() // AGENTS.yaml raw content
      table.text('tools_yaml').notNullable() // TOOLS.yaml raw content
      table.string('source_path', 512).notNullable() // host path the loader read from
      table.timestamp('loaded_at').notNullable().index()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

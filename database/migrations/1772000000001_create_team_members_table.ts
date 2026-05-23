import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'team_members'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.integer('team_id').notNullable().index()
      table.string('agent_name', 128).notNullable().index()
      table.string('role', 32).notNullable().defaultTo('member')
      table.timestamp('added_at').notNullable()
      table.unique(['team_id', 'agent_name'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

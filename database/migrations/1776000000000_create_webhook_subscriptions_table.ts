import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'webhook_subscriptions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('name', 128).notNullable().unique()
      table.string('url', 512).notNullable()
      table.string('event_pattern', 64).notNullable() // e.g. 'task.completed', 'task.*', '*'
      table.string('secret', 128).nullable() // for HMAC signing
      table.boolean('enabled').notNullable().defaultTo(true).index()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

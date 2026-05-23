import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 36).notNullable().primary()
      table.string('idempotency_key', 128).nullable().index()
      table.string('intent', 64).notNullable().index()
      table.text('payload').notNullable()
      table.string('status', 32).notNullable().index()
      table.string('claimed_by', 64).nullable()
      table.timestamp('claim_expires_at').nullable()
      table.text('result').nullable()
      table.string('failure_cause', 64).nullable()
      table.text('failure_detail').nullable()
      table.integer('version').notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('started_at').nullable()
      table.timestamp('finished_at').nullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

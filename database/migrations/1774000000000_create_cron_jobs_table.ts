import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'cron_jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable().primary()
      table.string('name', 128).notNullable().unique().index()
      table.string('cron_expression', 64).notNullable() // 5-field cron (min hour dom mon dow)
      table.string('intent', 64).notNullable()
      table.text('payload_template').notNullable() // JSON
      table.string('team_slug', 64).nullable()
      table.boolean('enabled').notNullable().defaultTo(true).index()
      table.timestamp('last_run_at').nullable()
      table.timestamp('next_run_at').notNullable().index()
      table.string('last_task_id', 64).nullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}

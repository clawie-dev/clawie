import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace backup:create <destination>` — write a consistent
 * snapshot of the SQLite DB to <destination>. Uses SQLite's
 * `VACUUM INTO` which is atomic, online (no downtime), and produces
 * a file the destination opener can use immediately. Destination must
 * not already exist.
 *
 * Phase 10 v1.0: minimum-viable backup. PR queue: streaming +
 * checksum verification + automated restore-test in v1.x.
 */
export default class BackupCreate extends BaseCommand {
  static commandName = 'backup:create'
  static description = 'Atomic SQLite snapshot to <destination> via VACUUM INTO'
  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({ description: 'Destination file path (must not exist)' })
  declare destination: string

  async run() {
    if (!this.destination) {
      this.logger.error('destination is required')
      this.exitCode = 1
      return
    }
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const { existsSync, statSync } = await import('node:fs')
    if (existsSync(this.destination)) {
      this.logger.error(`destination ${this.destination} already exists (VACUUM INTO refuses)`)
      this.exitCode = 1
      return
    }
    try {
      // VACUUM INTO is online + atomic; SQLite serializes it against
      // ongoing writes. No need for downtime.
      await db.rawQuery(`VACUUM INTO ?`, [this.destination])
      const size = statSync(this.destination).size
      this.logger.success(`wrote ${size} bytes to ${this.destination}`)
    } catch (err) {
      this.logger.error((err as Error).message)
      this.exitCode = 1
    }
  }
}

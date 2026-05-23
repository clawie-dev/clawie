import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace agents:load <directory>` — reads an agent's three files
 * from disk and upserts an `AgentDefinition` row. The directory's
 * basename becomes the agent's name.
 *
 *   <directory>/SOUL.md
 *   <directory>/AGENTS.yaml
 *   <directory>/TOOLS.yaml
 *
 * Phase 7: filesystem-driven. Phase 8 will add a `git`-backed loader
 * that watches a remote agency repo.
 */
export default class AgentsLoad extends BaseCommand {
  static commandName = 'agents:load'
  static description = 'Load an agent from a directory containing SOUL.md, AGENTS.yaml, TOOLS.yaml'
  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({ description: 'Path to the agent directory' })
  declare directory: string

  async run() {
    if (!this.directory) {
      this.logger.error('directory is required')
      this.exitCode = 1
      return
    }
    const { agentLoader } = await import('#services/agent_loader')
    try {
      const { definition, isNew } = await agentLoader().loadFromDirectory(this.directory)
      this.logger.success(
        `${isNew ? 'created' : 'updated'} agent "${definition.name}" from ${definition.sourcePath}`
      )
    } catch (err) {
      this.logger.error((err as Error).message)
      this.exitCode = 1
    }
  }
}

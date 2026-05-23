import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { DateTime } from 'luxon'
import AgentDefinition from '#models/agent_definition'

/**
 * Phase 7 agent file loader. An agent lives in a directory with three
 * files at its root:
 *
 *   SOUL.md       -- the agent's identity / persona / operating philosophy.
 *                    Free-form markdown; surfaced verbatim to LLM calls.
 *   AGENTS.yaml   -- intents the agent ships + their schedules (cron),
 *                    plus declared upstream dependencies. Phase 9 will
 *                    consume the schedules; Phase 7 just reads + persists.
 *   TOOLS.yaml    -- the tool surface the agent claims to need: file
 *                    globs, allowed-host hints, env vars it expects.
 *                    Phase 7a feeds these into Outcall's permissions
 *                    check.
 *
 * The agent's *name* is the directory's basename. Loader is read-only
 * against the filesystem; it upserts an AgentDefinition row and
 * returns it.
 *
 * No YAML parsing here -- we persist the raw text and let consumers
 * parse on demand. Spec 008 pins the YAML shape; this loader stays
 * agnostic so the schema can rev without a loader change.
 */

export interface LoadedAgent {
  definition: AgentDefinition
  isNew: boolean
}

export class AgentLoader {
  async loadFromDirectory(directory: string): Promise<LoadedAgent> {
    const name = basename(directory)
    if (!name || name.startsWith('.')) {
      throw new Error(`invalid agent directory name: ${directory}`)
    }

    const [soul, agentsYaml, toolsYaml] = await Promise.all([
      readFile(join(directory, 'SOUL.md'), 'utf8'),
      readFile(join(directory, 'AGENTS.yaml'), 'utf8'),
      readFile(join(directory, 'TOOLS.yaml'), 'utf8'),
    ])

    const now = DateTime.utc()
    const existing = await AgentDefinition.query().where('name', name).first()
    if (existing) {
      existing.soul = soul
      existing.agentsYaml = agentsYaml
      existing.toolsYaml = toolsYaml
      existing.sourcePath = directory
      existing.loadedAt = now
      await existing.save()
      return { definition: existing, isNew: false }
    }

    const definition = await AgentDefinition.create({
      name,
      soul,
      agentsYaml,
      toolsYaml,
      sourcePath: directory,
      loadedAt: now,
    })
    return { definition, isNew: true }
  }
}

let cachedInstance: AgentLoader | null = null
export function agentLoader(): AgentLoader {
  if (!cachedInstance) cachedInstance = new AgentLoader()
  return cachedInstance
}

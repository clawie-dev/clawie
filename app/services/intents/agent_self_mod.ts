import { DateTime } from 'luxon'
import AgentDefinition from '#models/agent_definition'
import AgentModification from '#models/agent_modification'
import type { IntentContext, IntentOutcome } from '#services/intents/registry'

/**
 * Phase 7 `agent.self_mod` intent. The agent (running in its
 * container) submits proposed changes to its own SOUL/AGENTS/TOOLS
 * files as a structured payload:
 *
 *   {
 *     agentName: "coder",
 *     changes: [
 *       { path: "AGENTS.yaml", content: "<full file content>" },
 *       { path: "TOOLS.yaml",  content: "..." }
 *     ]
 *   }
 *
 * The intent writes an AgentModification row in `pending` state, runs
 * a minimal unified diff against the currently loaded snapshot, and
 * returns the diff in the envelope output. Phase 4's approval flow
 * surfaces the row via the dashboard; an operator approves → a later
 * phase actually writes the files (Phase 7 deliberately stops at
 * "proposal recorded" -- it does not mutate the filesystem on apply).
 *
 * Why intent-local (not containerised): the agent already runs in its
 * container and emits a self_mod intent to the control plane. Re-
 * spawning a container just to record a proposal is wasteful. The
 * dispatch layer can register this intent as `network: 'none'` later
 * if we ever want it to roundtrip through agent-runtime.
 */

export interface SelfModPayload {
  agentName: string
  changes: Array<{ path: string; content: string }>
}

export async function agentSelfModIntent(ctx: IntentContext): Promise<IntentOutcome> {
  const validated = validate(ctx.payload)
  if (!validated.ok) return validated.failure

  const { agentName, changes } = validated.value
  const current = await AgentDefinition.query().where('name', agentName).first()
  if (!current) {
    return {
      ok: false,
      cause: 'unknown_agent',
      detail: `no AgentDefinition for "${agentName}" (load it first via agents:load)`,
    }
  }

  const diff = buildDiff(current, changes)

  await AgentModification.create({
    agentName,
    taskId: ctx.taskId,
    status: 'pending',
    diff,
    proposedChanges: JSON.stringify(changes),
    createdAt: DateTime.utc(),
  })

  return {
    ok: true,
    output: {
      agentName,
      modificationsSummary: changes.map((c) => c.path),
      diff,
    },
  }
}

function validate(
  payload: unknown
):
  | { ok: true; value: SelfModPayload }
  | { ok: false; failure: { ok: false; cause: string; detail: string } } {
  if (typeof payload !== 'object' || payload === null) {
    return fail('invalid_payload', 'payload must be an object')
  }
  const p = payload as Record<string, unknown>
  if (typeof p.agentName !== 'string' || p.agentName.length === 0) {
    return fail('invalid_payload', 'agentName is required')
  }
  if (!Array.isArray(p.changes) || p.changes.length === 0) {
    return fail('invalid_payload', 'changes must be a non-empty array')
  }
  for (const c of p.changes) {
    if (
      typeof c !== 'object' ||
      c === null ||
      typeof (c as { path?: unknown }).path !== 'string' ||
      typeof (c as { content?: unknown }).content !== 'string'
    ) {
      return fail('invalid_payload', 'each change needs {path:string, content:string}')
    }
    const path = (c as { path: string }).path
    if (!ALLOWED_PATHS.has(path)) {
      return fail(
        'invalid_payload',
        `path "${path}" not allowed; must be one of ${[...ALLOWED_PATHS].join(', ')}`
      )
    }
  }
  return {
    ok: true,
    value: {
      agentName: p.agentName,
      changes: p.changes as Array<{ path: string; content: string }>,
    },
  }
}

function fail(cause: string, detail: string) {
  return { ok: false as const, failure: { ok: false as const, cause, detail } }
}

const ALLOWED_PATHS = new Set(['SOUL.md', 'AGENTS.yaml', 'TOOLS.yaml'])

/**
 * Minimal hunk-free unified-diff-ish output. Lists each changed path
 * and shows the old vs new line counts. A real `diff -u` would need
 * either a dep or a hand-rolled LCS; for Phase 7 the dashboard just
 * needs to show that *something* changed so the reviewer reads the
 * proposedChanges JSON. Phase 8+ can swap this for a real diff.
 */
function buildDiff(
  current: AgentDefinition,
  changes: Array<{ path: string; content: string }>
): string {
  const before: Record<string, string> = {
    'SOUL.md': current.soul,
    'AGENTS.yaml': current.agentsYaml,
    'TOOLS.yaml': current.toolsYaml,
  }
  const lines: string[] = []
  for (const c of changes) {
    const oldContent = before[c.path] ?? ''
    if (oldContent === c.content) {
      lines.push(`# ${c.path}: no change`)
      continue
    }
    const oldLines = oldContent.split('\n').length
    const newLines = c.content.split('\n').length
    lines.push(`# ${c.path}: ${oldLines} -> ${newLines} lines`)
    lines.push(`--- a/${c.path}`)
    lines.push(`+++ b/${c.path}`)
    lines.push(`@@ summary @@`)
    lines.push(`- (old contents, ${oldContent.length} bytes)`)
    lines.push(`+ (new contents, ${c.content.length} bytes)`)
    lines.push('')
  }
  return lines.join('\n')
}

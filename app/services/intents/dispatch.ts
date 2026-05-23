import { containerSpawner, type NetworkMode } from '#services/container_spawner'
import { auditLogger } from '#services/audit_logger'
import { credentialBroker, type Provider } from '#services/credential_broker'
import CostLedgerEntry from '#models/cost_ledger_entry'
import type { IntentContext, IntentHandler, IntentOutcome } from '#services/intents/registry'

/**
 * Phase 3 dispatch layer. `containerDispatch(intentName, opts)` returns
 * an IntentHandler that:
 *   1. records `container.spawn_started`
 *   2. spawns the pinned agent-runtime image with the per-intent
 *      network mode + credential env
 *   3. parses the envelope; if it carries a cost field, writes a
 *      cost_ledger row and emits a `cost.recorded` audit event
 *   4. records `container.spawn_completed` (success) or
 *      `container.spawn_failed` (failure)
 *
 * Built-in intents (registered in `intents/index.ts`):
 *   - echo  -> network:none, no credentials, no cost expected
 *   - chat  -> network:bridge, providers:[anthropic,openai], cost expected
 */

export const AGENT_RUNTIME_IMAGE = 'clawie/agent-runtime:0.3.0'

export interface ContainerDispatchOptions {
  image?: string
  timeoutMs?: number
  network?: NetworkMode
  /** Providers whose credentials should be injected into the container's env. */
  credentialProviders?: ReadonlyArray<Provider>
}

interface ParsedCost {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  usdTenthsOfCent: number
  costUnknown: boolean
}

export function containerDispatch(
  intentName: string,
  opts: ContainerDispatchOptions = {}
): IntentHandler {
  const image = opts.image ?? AGENT_RUNTIME_IMAGE
  const network = opts.network ?? 'none'

  return async (ctx: IntentContext): Promise<IntentOutcome> => {
    const audit = auditLogger()
    await audit.record({
      actor: 'container_spawner',
      action: 'container.spawn_started',
      subjectKind: 'task',
      subjectId: ctx.taskId,
      outcome: 'success',
      details: { image, intent: intentName, network },
    })

    const env = opts.credentialProviders?.length
      ? credentialBroker().envFor(opts.credentialProviders)
      : undefined

    const result = await containerSpawner().spawn({
      image,
      spec: {
        intent: intentName,
        payload: ctx.payload,
        task_id: ctx.taskId,
      },
      signal: ctx.signal,
      timeoutMs: opts.timeoutMs,
      network,
      env,
    })

    if (result.envelope.ok) {
      const cost = parseCost(result.envelope.output)
      if (cost) {
        await CostLedgerEntry.create({
          taskId: ctx.taskId,
          provider: cost.provider,
          model: cost.model,
          inputTokens: cost.inputTokens,
          outputTokens: cost.outputTokens,
          usdTenthsOfCent: cost.usdTenthsOfCent,
          costUnknown: cost.costUnknown,
        })
        await audit.record({
          actor: 'cost_ledger',
          action: 'cost.recorded',
          subjectKind: 'task',
          subjectId: ctx.taskId,
          outcome: 'success',
          details: cost,
        })
      }

      await audit.record({
        actor: 'container_spawner',
        action: 'container.spawn_completed',
        subjectKind: 'task',
        subjectId: ctx.taskId,
        outcome: 'success',
        details: {
          image,
          intent: intentName,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      })
      return { ok: true, output: result.envelope.output }
    }

    await audit.record({
      actor: 'container_spawner',
      action: 'container.spawn_failed',
      subjectKind: 'task',
      subjectId: ctx.taskId,
      outcome: 'failure',
      reason: result.envelope.cause,
      details: {
        image,
        intent: intentName,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        cause: result.envelope.cause,
        detail: result.envelope.detail,
      },
    })
    return {
      ok: false,
      cause: result.envelope.cause,
      detail: result.envelope.detail,
    }
  }
}

function parseCost(output: unknown): ParsedCost | null {
  if (typeof output !== 'object' || output === null) return null
  const o = output as Record<string, unknown>
  if (typeof o.provider !== 'string' || typeof o.model !== 'string') return null
  const usage = o.usage
  if (typeof usage !== 'object' || usage === null) return null
  const u = usage as Record<string, unknown>
  if (typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') {
    return null
  }
  const costField = o.cost as { usd_cents: number } | null | undefined
  const usdCents = costField && typeof costField.usd_cents === 'number' ? costField.usd_cents : 0
  return {
    provider: o.provider,
    model: o.model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    usdTenthsOfCent: Math.round(usdCents * 10),
    costUnknown: o.cost_unknown === true,
  }
}

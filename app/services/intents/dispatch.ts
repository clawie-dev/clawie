import { containerSpawner } from '#services/container_spawner'
import { auditLogger } from '#services/audit_logger'
import type { IntentContext, IntentHandler, IntentOutcome } from '#services/intents/registry'

/**
 * Phase 2 dispatch layer: turn an intent name into a handler that
 * delegates execution to the `clawie/agent-runtime` image via
 * `ContainerSpawner`. The container has its own copy of the intent's
 * implementation; this side only knows the contract.
 *
 * Per PHASES.md Phase 2 acceptance:
 *   "same `task:run` command now executes inside Docker"
 *
 * So `registerBuiltinIntents()` wires built-in intents through this
 * dispatcher rather than to their in-process handlers directly. The
 * in-process handlers (e.g. `app/services/intents/echo.ts`) still
 * exist as reference implementations and as direct unit-test fixtures.
 */

export const AGENT_RUNTIME_IMAGE = 'clawie/agent-runtime:0.2.1'

export interface ContainerDispatchOptions {
  image?: string
  timeoutMs?: number
}

export function containerDispatch(
  intentName: string,
  opts: ContainerDispatchOptions = {}
): IntentHandler {
  const image = opts.image ?? AGENT_RUNTIME_IMAGE
  return async (ctx: IntentContext): Promise<IntentOutcome> => {
    const audit = auditLogger()
    await audit.record({
      actor: 'container_spawner',
      action: 'container.spawn_started',
      subjectKind: 'task',
      subjectId: ctx.taskId,
      outcome: 'success',
      details: { image, intent: intentName },
    })

    const result = await containerSpawner().spawn({
      image,
      spec: {
        intent: intentName,
        payload: ctx.payload,
        task_id: ctx.taskId,
      },
      signal: ctx.signal,
      timeoutMs: opts.timeoutMs,
    })

    if (result.envelope.ok) {
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

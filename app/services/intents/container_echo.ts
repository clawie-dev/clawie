import { containerSpawner } from '#services/container_spawner'
import type { IntentContext, IntentOutcome } from '#services/intents/registry'

/**
 * `container.echo` — Phase 2 proof of the container execution path.
 *
 * Identical semantics to the in-process `echo` intent, but the work runs
 * inside the `clawie/agent-runtime` image. Used to verify the spawner +
 * stdin/stdout envelope contract end-to-end before introducing real
 * outcall workloads.
 */
export const AGENT_RUNTIME_IMAGE = 'clawie/agent-runtime:0.2.0'

export async function containerEchoIntent(ctx: IntentContext): Promise<IntentOutcome> {
  const result = await containerSpawner().spawn({
    image: AGENT_RUNTIME_IMAGE,
    spec: {
      intent: 'echo',
      payload: ctx.payload,
      task_id: ctx.taskId,
    },
    signal: ctx.signal,
  })

  if (result.envelope.ok) {
    return { ok: true, output: result.envelope.output }
  }
  return {
    ok: false,
    cause: result.envelope.cause,
    detail: result.envelope.detail,
  }
}

import {
  ContainerSpawner,
  type ProcessRunner,
  type ContainerTaskSpec,
} from '#services/container_spawner'
import { echoIntent } from '#services/intents/echo'
import type { IntentOutcome } from '#services/intents/registry'

/**
 * In-process stand-in for the agent-runtime container. Decodes the
 * stdin spec the way the real container does, dispatches to the
 * matching in-process handler (the same code the image ships), then
 * encodes the outcome as the on-stdout JSON envelope.
 *
 * Used by Phase 1 + Phase 2 tests that drive the full lifecycle but
 * don't want a real Docker dependency in CI. Real-Docker integration
 * is a separate suite gated on an env flag (Phase 2+).
 */

type InProcessHandler = (payload: unknown, taskId: string) => Promise<IntentOutcome>

const HANDLERS: Record<string, InProcessHandler> = {
  echo: (payload, taskId) => echoIntent({ taskId, payload }),
}

export function fakeContainerSpawner(): ContainerSpawner {
  const runner: ProcessRunner = async (_bin, _args, stdin) => {
    let spec: ContainerTaskSpec
    try {
      spec = JSON.parse(stdin)
    } catch {
      return {
        exitCode: 1,
        stdout: JSON.stringify({ ok: false, cause: 'invalid_json', detail: 'fake' }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }

    const handler = HANDLERS[spec.intent]
    if (!handler) {
      return {
        exitCode: 1,
        stdout: JSON.stringify({
          ok: false,
          cause: 'unknown_intent',
          detail: `fake runtime has no handler for "${spec.intent}"`,
        }),
        stderr: '',
        signal: null,
        timedOut: false,
      }
    }

    const outcome = await handler(spec.payload, spec.task_id)
    return {
      exitCode: outcome.ok ? 0 : 1,
      stdout: JSON.stringify(outcome),
      stderr: '',
      signal: null,
      timedOut: false,
    }
  }

  return new ContainerSpawner({ runner })
}

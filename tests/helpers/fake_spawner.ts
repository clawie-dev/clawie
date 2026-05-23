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

/**
 * Phase 3 chat stub: the real chat intent runs inside the container
 * and calls Anthropic/OpenAI. The fake here returns a synthetic
 * completion + usage + cost so the clawie-side dispatch + cost-ledger
 * code can be exercised end-to-end without network.
 */
const fakeChat: InProcessHandler = async (payload) => {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, cause: 'invalid_payload', detail: 'must be object' }
  }
  const p = payload as Record<string, unknown>
  return {
    ok: true,
    output: {
      completion: `(stub-reply for model=${p.model})`,
      provider: p.provider,
      model: p.model,
      usage: { input_tokens: 7, output_tokens: 4 },
      cost: { usd_cents: 0.42 },
    },
  }
}

const HANDLERS: Record<string, InProcessHandler> = {
  echo: (payload, taskId) => echoIntent({ taskId, payload }),
  chat: fakeChat,
}

export function fakeContainerSpawner(): ContainerSpawner {
  const runner: ProcessRunner = async (_bin, args, stdin) => {
    // Sidecar lifecycle calls -- `docker run -d ...` (start) and
    // `docker stop NAME` (teardown). Both produce no JSON envelope;
    // we just return success so the agent run proceeds.
    if (args[0] === 'run' && args.includes('-d')) {
      return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
    }
    if (args[0] === 'stop') {
      return { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
    }

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

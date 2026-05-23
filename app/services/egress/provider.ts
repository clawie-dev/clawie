import type { SpawnRequest } from '#services/container_spawner'

/**
 * Phase 5 introduces a pluggable egress layer. The dispatch path builds a
 * `SpawnRequest`, then asks the active `EgressProvider` to decorate it
 * with whatever extra Docker flags, env vars, or network attachments
 * make the network surface safer.
 *
 * - The **null provider** (default) returns the request unchanged. This
 *   is the model an operator gets out of the box: containers run with
 *   `--network=bridge` for `chat` intents, with credentials in env. No
 *   isolation beyond Docker's defaults.
 *
 * - The **outcall provider** (Phase 5b) will attach the container to
 *   the operator's running `outcalld` daemon — adding `--network`,
 *   `--dns`, `HTTP(S)_PROXY` env, and the agent shim mount. That
 *   provider lives in `outcall_provider.ts` and is loaded only when
 *   `CLAWIE_EGRESS=outcall` is set.
 *
 * Important dependency note: Outcall does NOT depend on Clawie. Clawie
 * may optionally depend on Outcall. So the `EgressProvider` interface
 * stays Clawie-shaped; Outcall-specific concerns (rules, identity
 * label conventions, socket paths) live inside the outcall provider,
 * not in this interface.
 */

export interface EgressProviderContext {
  /** The intent name being dispatched. Lets providers scope rules per intent. */
  intentName: string
  /** Phase 8: optional team slug. Outcall provider uses it to pick a per-team network. */
  teamSlug?: string | null
}

export interface EgressProvider {
  readonly name: string
  /**
   * Decorate the spawn request. Implementations may return the same object
   * (mutated) or a new one. Pure-functional style preferred but not required.
   */
  wrap(req: SpawnRequest, ctx: EgressProviderContext): Promise<SpawnRequest>
}

export class NullEgressProvider implements EgressProvider {
  readonly name = 'null'
  async wrap(req: SpawnRequest, _ctx: EgressProviderContext): Promise<SpawnRequest> {
    return req
  }
}

let cachedInstance: EgressProvider | null = null
export function egressProvider(): EgressProvider {
  if (!cachedInstance) cachedInstance = new NullEgressProvider()
  return cachedInstance
}

export function setEgressProviderForTest(provider: EgressProvider | null): void {
  cachedInstance = provider
}

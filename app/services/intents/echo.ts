import type { IntentContext, IntentOutcome } from '#services/intents/registry'

/**
 * `echo` — the simplest possible intent. Phase 1 fixture for proving
 * the durable task lifecycle works end-to-end without LLMs or containers.
 *
 * Returns `{ message: "hello: <payload as string>" }`.
 *
 * Failure mode: if payload contains `__fail: true`, fails deterministically.
 * Used by tests to verify failure paths.
 */
export async function echoIntent(ctx: IntentContext): Promise<IntentOutcome> {
  if (
    typeof ctx.payload === 'object' &&
    ctx.payload !== null &&
    (ctx.payload as Record<string, unknown>).__fail === true
  ) {
    return {
      ok: false,
      cause: 'intentional_failure',
      detail: 'payload requested failure',
    }
  }

  let asString: string
  if (ctx.payload === null || ctx.payload === undefined) {
    asString = ''
  } else if (typeof ctx.payload === 'string') {
    asString = ctx.payload
  } else {
    asString = JSON.stringify(ctx.payload)
  }

  return {
    ok: true,
    output: { message: `hello: ${asString}` },
  }
}

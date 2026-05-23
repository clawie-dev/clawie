import { intentRegistry } from '#services/intents/registry'
import { containerDispatch } from '#services/intents/dispatch'
import { agentSelfModIntent } from '#services/intents/agent_self_mod'

let registeredFlag = false

/**
 * Idempotently register the built-in intents into the registry.
 * Called at app boot and at the start of each test that needs intents.
 *
 * Phase 2: built-in intents are routed through the container dispatch
 * layer. The matching in-process handler (e.g. `echoIntent`) lives in
 * the agent-runtime image and is also kept here for direct unit testing.
 */
export function registerBuiltinIntents(): void {
  if (registeredFlag) return
  const reg = intentRegistry()
  if (!reg.has('echo')) {
    reg.register('echo', containerDispatch('echo'))
  }
  if (!reg.has('chat')) {
    reg.register(
      'chat',
      containerDispatch('chat', {
        network: 'bridge',
        credentialProviders: ['anthropic', 'openai'],
        timeoutMs: 120_000,
      })
    )
  }
  // Phase 7: agent self-modifications run in-process -- they only touch
  // Clawie's DB to record a proposal. No container roundtrip needed.
  if (!reg.has('agent.self_mod')) {
    reg.register('agent.self_mod', agentSelfModIntent)
  }
  registeredFlag = true
}

/**
 * For tests: clear the registry + reset the registration latch so each
 * test starts from a known state.
 */
export function resetIntentsForTest(): void {
  intentRegistry().clear()
  registeredFlag = false
}

import { intentRegistry } from '#services/intents/registry'
import { echoIntent } from '#services/intents/echo'

let registeredFlag = false

/**
 * Idempotently register the built-in intents into the registry.
 * Called at app boot and at the start of each test that needs intents.
 */
export function registerBuiltinIntents(): void {
  if (registeredFlag) return
  const reg = intentRegistry()
  if (!reg.has('echo')) reg.register('echo', echoIntent)
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

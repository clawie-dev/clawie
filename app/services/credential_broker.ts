/**
 * Phase 3 credential broker — STUB.
 *
 * Reads provider API keys from the control-plane process env. The real
 * broker (spec 012) will replace this with per-team, audit-logged
 * credential issuance. For now we mirror the env vars into the
 * container's env when the dispatched intent declares it needs them.
 *
 * Returned shape: `{ [ENV_NAME]: <value> }`. Missing keys are silently
 * dropped — the chat handler emits its own `missing_credential` if the
 * provider it was asked to call has no key.
 *
 * Tests inject a fake broker via `setCredentialBrokerForTest()`.
 */

export type Provider = 'anthropic' | 'openai'

export const PROVIDER_ENV_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
}

export interface CredentialBroker {
  envFor(providers: ReadonlyArray<Provider>): Record<string, string>
}

class EnvCredentialBroker implements CredentialBroker {
  envFor(providers: ReadonlyArray<Provider>): Record<string, string> {
    const env: Record<string, string> = {}
    for (const provider of providers) {
      const varName = PROVIDER_ENV_VAR[provider]
      const value = process.env[varName]
      if (value && value.length > 0) env[varName] = value
    }
    return env
  }
}

let cachedInstance: CredentialBroker | null = null
export function credentialBroker(): CredentialBroker {
  if (!cachedInstance) cachedInstance = new EnvCredentialBroker()
  return cachedInstance
}

export function setCredentialBrokerForTest(broker: CredentialBroker | null): void {
  cachedInstance = broker
}

export interface IntentContext {
  taskId: string
  payload: unknown
  signal?: AbortSignal
  /** Phase 8: when set, the dispatch layer uses team-scoped egress. */
  teamSlug?: string | null
}

export interface IntentResult {
  ok: true
  output: unknown
}

export interface IntentFailure {
  ok: false
  cause: string
  detail?: string
}

export type IntentOutcome = IntentResult | IntentFailure

export type IntentHandler = (ctx: IntentContext) => Promise<IntentOutcome>

export class IntentRegistry {
  private handlers = new Map<string, IntentHandler>()

  register(name: string, handler: IntentHandler): void {
    if (!name || typeof name !== 'string') {
      throw new Error('intent name must be a non-empty string')
    }
    if (this.handlers.has(name)) {
      throw new Error(`intent "${name}" is already registered`)
    }
    this.handlers.set(name, handler)
  }

  has(name: string): boolean {
    return this.handlers.has(name)
  }

  list(): string[] {
    return Array.from(this.handlers.keys()).sort()
  }

  get(name: string): IntentHandler | undefined {
    return this.handlers.get(name)
  }

  clear(): void {
    this.handlers.clear()
  }
}

let cachedInstance: IntentRegistry | null = null
export function intentRegistry(): IntentRegistry {
  if (!cachedInstance) cachedInstance = new IntentRegistry()
  return cachedInstance
}

/**
 * For tests: swap the registry without leaking state.
 */
export function setIntentRegistry(registry: IntentRegistry | null): void {
  cachedInstance = registry
}

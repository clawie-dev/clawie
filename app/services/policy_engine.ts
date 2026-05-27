import Policy, { type PolicyDecision } from '#models/policy'

/**
 * Phase 4 policy engine. Decides whether a task may proceed, must
 * wait for approval, or must be denied. Default-deny: when no policy
 * matches the (intent, payload) tuple, the engine returns
 * `requires_approval`.
 *
 * Matching algorithm
 *   1. Load policies where `intent_pattern in ('*', intent)`.
 *   2. Sort by priority DESC, then id ASC.
 *   3. Walk the list; first rule whose predicates all match wins.
 *      Predicate match: for every entry in `predicates`, the matching
 *      key on the payload deep-equals the expected value
 *      (`payload.foo === expected` or `payload.foo.bar === expected`
 *      via dot-paths).
 *   4. If two rules tie on priority, the more restrictive decision
 *      wins (`deny` > `requires_approval` > `allow`).
 *   5. If nothing matches, return `requires_approval`.
 *
 * Phase 4 deliberately keeps predicate matching to exact equality on
 * primitives. Regex, ranges, and array membership land with spec 003
 * hardening.
 */

export interface PolicyContext {
  intent: string
  payload: unknown
  actor: string
}

export interface PolicyMatch {
  decision: PolicyDecision
  ruleId: number | null
  ruleName: string | null
  reason: string
}

const RESTRICTIVENESS: Record<PolicyDecision, number> = {
  allow: 0,
  requires_approval: 1,
  deny: 2,
}

export class PolicyEngine {
  async decide(ctx: PolicyContext): Promise<PolicyMatch> {
    const candidates = await Policy.query()
      .whereIn('intent_pattern', ['*', ctx.intent])
      .orderBy('priority', 'desc')
      .orderBy('id', 'asc')

    let winner: { policy: Policy; restrictiveness: number } | null = null

    for (const policy of candidates) {
      if (!matches(policy.parsedPredicates, ctx.payload)) continue

      const restrictiveness = RESTRICTIVENESS[policy.decision]

      if (!winner) {
        winner = { policy, restrictiveness }
        continue
      }
      // Same priority bucket → keep the most restrictive.
      if (winner.policy.priority === policy.priority && restrictiveness > winner.restrictiveness) {
        winner = { policy, restrictiveness }
      }
      // Lower priority can't beat the current winner; we already sorted.
    }

    if (winner) {
      return {
        decision: winner.policy.decision,
        ruleId: winner.policy.id,
        ruleName: winner.policy.name,
        reason: `matched policy "${winner.policy.name}" (priority ${winner.policy.priority})`,
      }
    }

    return {
      decision: 'requires_approval',
      ruleId: null,
      ruleName: null,
      reason: 'default-deny: no matching policy',
    }
  }
}

function matches(predicates: Record<string, unknown>, payload: unknown): boolean {
  for (const [path, expected] of Object.entries(predicates)) {
    const actual = readPath(payload, path)
    if (!deepEqualPrimitive(actual, expected)) return false
  }
  return true
}

function readPath(value: unknown, path: string): unknown {
  const segments = path.split('.')
  let current: unknown = value
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function deepEqualPrimitive(a: unknown, b: unknown): boolean {
  // Phase 4: predicate matching is exact equality on primitives. Object
  // or array operands never compare equal here — two distinct objects are
  // never `===`, and predicate/payload values are parsed independently —
  // so strict equality is the whole contract. Structural deep-equality
  // with stable JSON canonicalization is deferred to spec 003.
  return a === b
}

let cachedInstance: PolicyEngine | null = null
export function policyEngine(): PolicyEngine {
  if (!cachedInstance) cachedInstance = new PolicyEngine()
  return cachedInstance
}

export function setPolicyEngineForTest(engine: PolicyEngine | null): void {
  cachedInstance = engine
}

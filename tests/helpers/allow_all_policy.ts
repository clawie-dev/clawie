import { PolicyEngine, setPolicyEngineForTest } from '#services/policy_engine'

/**
 * Test helper that swaps in a policy engine which approves everything.
 * Used by tests that aren't exercising policy behavior themselves —
 * Phase 1/2/3 lifecycle tests assume the default-deny gate isn't in
 * the way. Phase 4 tests that DO test the policy engine use the real
 * one (the cached singleton is reset via setPolicyEngineForTest(null)).
 */
class AllowAllPolicyEngine extends PolicyEngine {
  async decide() {
    return {
      decision: 'allow' as const,
      ruleId: null,
      ruleName: null,
      reason: 'test: allow-all policy',
    }
  }
}

export function installAllowAllPolicy(): void {
  setPolicyEngineForTest(new AllowAllPolicyEngine())
}

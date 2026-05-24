# Outcall under Clawie scheduler load — perf notes (Phase 9a)

**Status:** desk-bound. Real measurement requires a Linux host + a running `outcalld` daemon. The harness sketched here lands in a follow-up; this doc is the *brief*, not the report.

## Why this exists

Phase 9 introduces `scheduler:tick` running every minute. In a deployment with many cron jobs scoped to many teams, every tick can produce dozens of agent spawns — each of which:

1. Hits `POST /api/v1/network/create` (idempotent; just touched if it exists).
2. Joins the team's `outcall-clawie-team-<slug>` network.
3. Routes through Outcall's L7 proxy + DNS filter for every outbound HTTPS call.

The Phase 5a audit established Outcall's correctness baseline; Phase 9a's question is **does Outcall stay correct at scheduler-driven scale**.

## Harness shape (when implemented)

1. Boot `outcalld` on a Linux host with the default config.
2. Pre-create N teams (`teams:create team-001` … `team-N`).
3. Pre-load M cron jobs per team (`cron:create job-001 --schedule '* * * * *' --intent chat --team ...`).
4. Run `scheduler:tick` once. Observe:
   - **Task-create latency** (Clawie metric) — should stay <50 ms p95.
   - **Network-create latency** (Outcall metric, via `GET /api/v1/proxy`) — should stay <100 ms p95.
   - **Dynamic rule table size** — `GET /api/v1/rules/active`; growth shouldn't track N × M.
   - **Proxy active connections** — should drain between ticks.
5. Repeat for 1 hour; compare p50 / p95 / p99 over time.

## Concerns to validate

| # | Concern | Why it matters |
|---|---|---|
| P-1 | Per-rule dynamic nftables table growth at high agent count | Per CHANGELOG 2026-05-20: "dynamic direct-IP nftables rules are capped per container to limit DNS-driven rule-table growth". The cap exists; the question is whether N teams × M agents stays inside it. |
| P-2 | Memory growth in `dns_cache` under churn | DNS filter caps cache size; verify the cap is respected when 100s of agents resolve the same `api.anthropic.com` repeatedly. |
| P-3 | Proxy `total_blocked` correctness vs L3 drops | When rules tighten mid-run, are L3 (nftables) drops counted in `proxy.total_blocked` (no — they're not L7) or only in nftables counters? Document the distinction so Clawie's dashboard doesn't mislead. |
| P-4 | Rule reload duration at large `rules.d/` | When Phase 8a writes N team rule packs, each `outcall:sync` triggers a reload. Reload should stay <500 ms even with N=100 files. |
| P-5 | Approval sweep + cron tick co-located | Phase 9's tick runs both. If approval sweep takes a long time (e.g., 100 pending approvals to expire), cron firings get delayed. Currently sweep runs *after* cron fires; if order matters, document it. |

## Likely outcomes (informed guesses, not measurements)

- **P-1 / P-2 are probably fine** at sane operator scale (≤50 teams, ≤10 agents per team, ≤10 cron jobs). Outcall's hardening wave of 2026-05-19/20 specifically addressed table growth and DNS cache caps.
- **P-3 is a documentation gap, not a perf gap.** The split between L3 drops and L7 blocks needs to be reflected in the Clawie dashboard so operators don't think "L7 only blocked X" means "X is total blocks".
- **P-4 needs measurement.** Outcall's reload is atomic (old set stays until the new one validates), so there's no correctness risk; the question is just latency.

## When upstream PRs would be filed

| Trigger | PR target | Justification beyond Clawie |
|---|---|---|
| `nftables` rule table approaches its cap under realistic load | `outcall-dev/outcall` — increase cap or add per-rule eviction | Benefits any multi-agent operator |
| Reload latency >1s with 100 rule files | `outcall-dev/outcall` — incremental reload | Benefits any operator managing many rule packs |
| Missing observability: no way to count L3 drops | `outcall-dev/outcall` — add a `nftables_drops` counter to `/api/v1/bridge` | Benefits any UI consumer |
| Dashboard misreads block counts | `clawie/clawie` (in-tree) — fix the Egress tab to distinguish L3 vs L7 drops | Clawie-side only |

## Phase 9a exit

- [x] Harness brief committed.
- [ ] Linux measurement run (deferred — needs a Linux test host).
- [ ] Upstream PRs filed for any concrete regression (deferred — gated on the measurement).

The phase is **research-only** (no Clawie tag). Phase 10 starts with this list as the perf baseline; if 10a's joint v1 alignment surfaces something Phase 9a missed, that's where it shakes out.

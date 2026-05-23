# Changelog

All notable changes to Clawie are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and Clawie follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.5.1] — Phase 5: Pluggable Egress (walk-back)

Walks back the v0.5.0 sidecar fork. v0.5.0 shipped a parallel Node.js
implementation under `clawie/outcall:*` that re-built what the real
Outcall project (`Outcall-dev/root`) already does — a Rust host
daemon governing Docker container egress via nftables + DNS filter +
L7 proxy. Clawie is a consumer of Outcall, not a re-implementer.

This release introduces the `EgressProvider` abstraction with a null
default (no isolation, Phase 3 behavior preserved) and removes the
v0.5.0 sidecar machinery. The real `OutcallEgressProvider` lands in
v0.5.2 per the remapped `specs/PHASES.md`.

### Added

- **`EgressProvider` interface** — `app/services/egress/provider.ts`. Single method `wrap(req, ctx) → req` decorates a `SpawnRequest` before it reaches `ContainerSpawner`. Default provider is `NullEgressProvider` (passes the request through). Phase 5b will register an `OutcallEgressProvider` when `CLAWIE_EGRESS=outcall`.
- **Dispatch** calls `egressProvider().wrap(...)` between building the spawn request and invoking the spawner. This is the only seam needed for any future provider to inject Docker flags, env vars, or networking.
- Tests for the null provider + test-seam.

### Changed

- `ContainerSpawner` reverted: `SidecarSpec` type removed; `NetworkMode` is back to `'none' | 'bridge'`; sidecar lifecycle code (`stopSidecar`, `randomSidecarName`, networkFlagFor + sidecar branch) deleted. The spawner is once again network-agnostic: a single `docker run` per call. Failure cause `spawn_failed` is the only path; `sidecar_missing` / `sidecar_start_failed` are gone.
- `chat` intent reverted to `network: 'bridge'` + `credentialProviders: ['anthropic', 'openai']`. Credentials live in the agent container's env (Phase 3 model), where they have always lived for chat. Network isolation, when desired, is layered on by the operator opting into the Outcall provider in Phase 5b.
- `AGENT_RUNTIME_IMAGE` pinned to `clawie/agent-runtime:0.4.1` (which reverted its OUTCALL_URL routing).
- `fake_spawner` test helper: dropped the `docker run -d` / `docker stop` branches it added in v0.5.0.

### Removed

- `SidecarSpec` interface (`app/services/container_spawner.ts`).
- `network: 'sidecar'`, the 4 sidecar lifecycle tests in `container_spawner.test.ts`, the sidecar test in `dispatch.test.ts`, and the `OUTCALL_IMAGE` / `OUTCALL_URL_IN_AGENT` constants from `dispatch.ts`.
- No `clawie/outcall:*` reference exists in clawie's runtime anymore.

### Companion releases

- [clawie/agent-runtime v0.4.1](https://github.com/clawie-dev/agent-runtime/releases/tag/v0.4.1) — reverts the OUTCALL_URL mount-path routing in the chat handler.

### Why this exists

v0.5.0 was incorrect, not unsafe — it shipped a working sidecar that just wasn't Outcall. Tagging it cleanly as v0.5.1 (walk-back) instead of force-deleting v0.5.0 preserves the history of the design dead end. Future readers see why `EgressProvider` exists as an abstraction rather than as a hardcoded Outcall path.

## [0.5.0] — Phase 5: Outcall sidecar (superseded)

**Status: superseded by v0.5.1.** This release shipped a parallel Node.js
re-implementation of Outcall instead of consuming the real Outcall project.
The container spawner gained a `network: 'sidecar'` mode that ran a
custom `clawie/outcall:0.1.0` image alongside the agent. v0.5.1 reverts
that work and introduces a proper `EgressProvider` abstraction instead.

Provider credentials no longer enter the agent container. The `chat`
intent now spawns an `Outcall` sidecar first, attaches the agent to
its network namespace, and lets the sidecar inject auth headers on
the way out. The agent sees `OUTCALL_URL=http://localhost:8080` and
talks to mount paths (`/anthropic/...`, `/openai/...`) instead of
provider hostnames. Unknown mounts return `403` at the sidecar — true
default-deny at the network boundary.

### Added

- **`network: 'sidecar'`** in `ContainerSpawner`. Lifecycle: `docker run -d` the sidecar with the credential env, then `docker run --network=container:<name>` the agent, then `docker stop` the sidecar in a `finally` block (so it dies even if the agent throws). New cause codes: `sidecar_missing`, `sidecar_start_failed`.
- **Dispatch options** `sidecarImage` and the `OUTCALL_IMAGE` constant. `chat` now registers with `network: 'sidecar'` instead of `'bridge'`. Built-in `echo` stays on `'none'`.
- **Tests** — 4 new spawner tests (sidecar lifecycle, missing-spec, start failure, teardown after agent crash) + 1 dispatch test asserting credentials route to the sidecar's env and not the agent's. 104 tests total (+5 vs v0.4.0).
- **fake_spawner.ts** — handles `docker run -d` and `docker stop` calls so lifecycle tests can drive sidecar mode without real Docker.

### Changed

- `AGENT_RUNTIME_IMAGE` pinned to `clawie/agent-runtime:0.4.0` (which honors `OUTCALL_URL`).
- `chat` intent: previously sent `--network=bridge` + `ANTHROPIC_API_KEY` into the agent; now sends `--network=container:outcall-<id>` + `OUTCALL_URL` only. The key lives in the sidecar.
- `NetworkMode` union: `'none' | 'bridge' | 'sidecar'`. `'bridge'` is now transitional — kept for backward compatibility, removable once nothing uses it.

### Security posture (Phase 5 vs v0.4.0)

- Credentials are no longer visible via `docker inspect` on the agent container.
- The agent's network namespace allows **only** the sidecar's allowlisted upstreams. No DNS to arbitrary hosts; no SSRF surface from inside the agent.
- The sidecar runs read-only with no shell. Its only ingress is `localhost:8080`; only the agent (sharing its netns) can reach it.

### Spec alignment

- Spec 002 (container runtime + outcall) — sidecar wiring; default-deny at egress.
- Spec 012 (credential broker) — credentials now move through a network boundary, not an env-var copy. Real broker (per-team rotation, per-call audit) still pending.

### Companion releases

- [clawie/outcall v0.1.0](https://github.com/clawie-dev/outcall/releases/tag/v0.1.0) — sidecar image + default rules (anthropic, openai).
- [clawie/agent-runtime v0.4.0](https://github.com/clawie-dev/agent-runtime/releases/tag/v0.4.0) — chat handler honors `OUTCALL_URL`.

## [0.4.0] — Phase 4: Policy + Approval

Default-deny semantics. Every task now passes through the policy
engine on creation; an empty policy table means every task lands in
`approval_pending` waiting for a human. Operators decide via CLI or
REST; the matching approval row keeps a deadline and is swept on
expiry.

### Added

- **PolicyEngine** — `app/services/policy_engine.ts`. Loads policies matching the task's intent (exact match or `*`), sorts by priority desc + id asc, takes the first whose predicates match. Ties on priority resolve to the most restrictive decision (`deny > requires_approval > allow`). No matching rule → `requires_approval` (default-deny). Predicate matching is exact equality on dot-path payload fields; regex / ranges land later with spec 003.
- **Approval lifecycle in the state machine** — `approval_pending` joins the pre-execution states. `create()` now consults the engine and emits `policy.decided` audit, then either: lands the task in `queued` (allow), creates a pending approval row + emits `approval.requested` (requires_approval), or marks the task `failed` with cause `policy_denied`. New transitions: `approve()` → `queued`, `denyApproval()` → `failed (approval_denied)`, `expirePastDeadlines()` → `failed (approval_expired)`.
- **Models + migrations** — `policies` (name, intent_pattern, predicates JSON, decision, priority, created_by) and `approvals` (task_id unique, status, requested_at, deadline_at, decided_by, decided_at, reason).
- **REST** — `GET /v1/approvals?status=pending` lists pending approvals; `POST /v1/tasks/:id/approval {decision, reason?}` approves or denies and (on approve) runs the task synchronously.
- **CLI** — `node ace task:approve --id <id> --decision approve|deny --reason '...'`, `node ace task:queue [--status pending]`, `node ace approvals:sweep` (one-shot deadline sweep; scheduler integration lands in Phase 9).
- **Audit actions** — `policy.decided` (actor=`policy_engine`), `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`.
- **Tests** — 8 policy engine tests (default-deny, `*` matching, exact intent priority, predicate match, ties, priority ordering, nested dot-paths, miss), 3 policy model tests, 2 approval model tests, 5 integration tests covering the full approval lifecycle (no policy → approve, explicit allow, explicit deny, approval denial, deadline expiry). 99 tests total (+18 vs v0.3.0).

### Changed

- `TaskStatus` gains `approval_pending`. Existing transitions are unchanged.
- `tasks_controller.store()` no longer auto-executes when the task is held for approval — it returns the task in its current state so the API client can poll/decide.
- `task:run` CLI prints the approval hint instead of executing when the task is held.

### Test helpers

- `tests/helpers/allow_all_policy.ts` — Phase 1/2/3 lifecycle tests inject this to bypass the default-deny gate (they're not testing policy behavior). Phase 4 tests use the real engine with seeded policies.

### Spec alignment

- Spec 003 (policy engine) — rule shape, default-deny, audit trail.
- Spec 005 (approvals HITL) — approval table, decision windows, deadline expiry.
- Spec 006 (observability) — five new audit actions chained through the existing hash-chained logger.

## [0.3.0] — Phase 3: Real LLM

First built-in intent that calls a real LLM. `node ace task:run --intent
chat --payload '{"provider":"anthropic","model":"claude-sonnet-4-6","messages":[{"role":"user","content":"hi"}]}'`
spawns `clawie/agent-runtime:0.3.0` with `--network=bridge`, injects
`ANTHROPIC_API_KEY` from the control plane env, runs the call inside
the container, and writes a `cost_ledger` row plus a `cost.recorded`
audit event when the envelope includes a `cost` field. Phase 5 will
narrow the network from bridge to an Outcall sidecar.

### Added

- **Credential broker stub** — `app/services/credential_broker.ts`. Reads provider API keys from process env. Returns only the env vars whose keys are non-empty. Real broker (spec 012) lands later; this is the interim shape. Test seam via `setCredentialBrokerForTest()`.
- **ContainerSpawner env + network knobs** — per-spawn `env: Record<string,string>` (rendered as `-e KEY=VAL`) and `network: 'none' | 'bridge'` (default `'none'`, preserving Phase 2 sandboxing for everything except chat).
- **Dispatch layer** — gains `network` and `credentialProviders` per intent. `chat` registered with `network:'bridge'`, `credentialProviders:['anthropic','openai']`, `timeoutMs:120_000`.
- **Cost ledger** — `cost_ledger` table + `app/models/cost_ledger_entry.ts`. Currency stored as integer tenths-of-a-cent (`usd_tenths_of_cent`) to avoid float drift; getters give `usdCents` and `usdDollars`. Dispatch writes a row when envelope output has `{provider, model, usage:{input_tokens,output_tokens}, cost?}`.
- **New audit action** — `cost.recorded` (actor=`cost_ledger`, outcome=`success`) emitted alongside `container.spawn_completed`.
- **Tests** — 5 credential broker tests, 3 cost-ledger model tests, 3 dispatch cost-ledger tests, 3 spawner env/network tests, 1 integration test for the full chat lifecycle through the fake spawner. 81 tests total (+15 vs v0.2.1).

### Changed

- `registerBuiltinIntents()` now registers `chat` alongside `echo`.
- `AGENT_RUNTIME_IMAGE` pinned to `clawie/agent-runtime:0.3.0`.

### Spec alignment

- Spec 011 — model router with Anthropic + OpenAI adapters (now living inside the agent-runtime image, called via fetch — no SDKs).
- Spec 012 — credential broker (stub shape; full implementation deferred).
- Spec 007 — cost ledger schema and write path.

### Companion release

- [clawie/agent-runtime v0.3.0](https://github.com/clawie-dev/agent-runtime/releases/tag/v0.3.0) ships the `chat` handler + provider adapters + pricing table.

## [0.2.1] — Phase 2: Container path (spec-aligned)

Replaces the v0.2.0 design (which added a parallel `container.echo`
intent alongside in-process `echo`) with the strict reading of
PHASES.md L64: _"same `task:run` command now executes inside Docker;
audit captures container lifecycle events"_.

- `app/services/intents/dispatch.ts` is now the canonical layer. The factory `containerDispatch(intentName)` returns a handler that delegates to `ContainerSpawner`. Built-in `echo` is wired through it — running `node ace task:run --intent echo --payload '"world"'` now spawns the `clawie/agent-runtime:0.2.1` image.
- The dispatch handler emits three audit actions per task: `container.spawn_started`, then either `container.spawn_completed` (success, with `exitCode` and `durationMs` in details) or `container.spawn_failed` (failure, with cause in `reason`). These chain into the existing `task.*` audit trail.
- Tests use `tests/helpers/fake_spawner.ts` — a fake `ProcessRunner` that dispatches to the in-process intent code and returns the same JSON envelope the real image would. Lifecycle + executor tests run without Docker; the contract is enforced by the helper. 66 tests total.
- Removed `app/services/intents/container_echo.ts` and its tests (now redundant).
- Pinned image bumped to `clawie/agent-runtime:0.2.1` (matching the companion release that fixes the v0.2.0 Dockerfile UID-1000 conflict).

### Spec alignment

- Spec 002 — sandbox flags, stdin/stdout envelope contract, container lifecycle audit events.
- Spec 008 — intents-as-extensible: dispatch is a thin factory over the registry, no special-casing in the executor.

### Companion release

- [clawie/agent-runtime v0.2.1](https://github.com/clawie-dev/agent-runtime/releases/tag/v0.2.1).

## [0.2.0] — Phase 2: Container path (superseded)

Initial Phase 2 release. Superseded by v0.2.1, which routes built-in
`echo` through the container instead of adding a parallel
`container.echo` intent — matching the strict PHASES.md acceptance.

## [0.1.0] — Phase 1: Hello Task

The smallest possible vertical slice through Clawie's architecture: durable tasks, an audit chain, one built-in intent handler, a CLI, and a REST surface. No LLMs, no Docker, no Outcall yet — those land in subsequent phases per `PHASES.md`.

### Added

- **Models** — `Task` (state machine columns, UUID PK, idempotency key, optimistic-lock version) and `AuditEvent` (append-only, hash-chained).
- **State machine** — `app/services/task_state_machine.ts`: atomic transitions via Lucid transactions, optimistic locking on version, RFC2119 transition rules. Statuses: `queued → claimed → running → completing → completed` (+ `failed/aborted/timed_out` terminals).
- **Audit logger** — `app/services/audit_logger.ts`: every state transition emits an audit row with `prev_hash → hash` SHA-256 chain; `verifyChain()` detects tampering.
- **Intents** — pluggable registry (`#services/intents/registry`) + the first built-in: `echo`. Failure-injection via `__fail: true` payload for tests.
- **Executor** — `app/services/task_executor.ts`: drives a queued task through claim → start → handler → complete/fail in-process. Phase 2 will detach this to Docker.
- **CLI** — `node ace task:run --intent <name> --payload <json>` runs the full lifecycle, prints structured output, returns non-zero on failure.
- **REST** — `POST /v1/tasks`, `GET /v1/tasks`, `GET /v1/tasks/:id`. VineJS validation.
- **Test discipline (spec 031)** — mirror-file convention enforced via `scripts/check_mirror_tests.ts`. Japa unit suite + integration suite. Coverage gates land in CI.
- **CI** — `.github/workflows/ci.yml`: lint, typecheck, mirror-check, tests. Node 24.
- **Migrations** — reversible Lucid migrations for `tasks` and `audit_events` tables.

### Spec alignment

- Spec 004 (control plane, durable state) — task table + state machine.
- Spec 006 (observability) — audit chain + structured cause codes.
- Spec 008 (intents-as-extensible) — intent registry pattern.
- Spec 031 (test discipline) — mirror-file convention, per-area coverage targets, FR-traceability annotations land in Phase 2.

### Not yet shipped (intentional)

These are P0 for later phases, not v0.1.0:

- Docker container spawning (Phase 2 / spec 002)
- LLM model router (Phase 3 / spec 011)
- Policy engine + approvals (Phase 4 / specs 003, 005)
- Outcall egress isolation (Phase 5 / spec 002, 012)
- Web dashboard (Phase 6 / spec 022)
- Agent files + self-modification (Phase 7 / specs 008, 009)
- Teams + multi-agent flows (Phase 8 / specs 013, 014)
- Scheduler + crons (Phase 9 / spec 027)
- Backup/DR, upgrades, webhooks, marketplace (Phase 10 / specs 028, 029, 030, 024)

[Unreleased]: https://github.com/clawie-dev/clawie/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.5.1
[0.5.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.5.0
[0.4.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.4.0
[0.3.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.3.0
[0.2.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.2.1
[0.2.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.2.0
[0.1.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.1.0

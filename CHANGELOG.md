# Changelog

All notable changes to Clawie are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and Clawie follows [SemVer](https://semver.org/).

## [Unreleased]

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
PHASES.md L64: *"same `task:run` command now executes inside Docker;
audit captures container lifecycle events"*.

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

[Unreleased]: https://github.com/clawie-dev/clawie/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.3.0
[0.2.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.2.1
[0.2.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.2.0
[0.1.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.1.0

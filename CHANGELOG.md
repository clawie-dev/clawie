# Changelog

All notable changes to Clawie are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and Clawie follows [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/clawie-dev/clawie/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.1.0

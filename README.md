# Clawie — AdonisJS Framework Application

The Clawie autonomous software agency framework. AdonisJS 6 (TypeScript) + Inertia + React + SQLite. Phase 1 ships a durable task lifecycle as the foundation; subsequent phases add Docker isolation, LLM routing, policy enforcement, and the full agency pipeline.

See [`clawie-dev/specs`](https://github.com/clawie-dev/specs) for the end-goal architecture and the phased roadmap.

## Quick start

```bash
npm install
cp .env.example .env
node ace generate:key
node ace migration:run
npm run dev          # → http://localhost:3333
```

## What v0.1.0 ships (Phase 1 — "Hello Task")

The smallest possible vertical slice through the architecture: a durable task, claimed and executed by a built-in intent handler, fully audited, with a CLI command and a REST surface.

**Try it:**

```bash
# 1) Run migrations (creates SQLite db)
node ace migration:run

# 2) Run the built-in 'echo' intent end-to-end
node ace task:run --intent=echo --payload='"world"'
#  task <uuid> → completed
#    result: {"message":"hello: world"}

# 3) Same task via REST
curl -X POST http://localhost:3333/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"intent":"echo","payload":"world"}'

# 4) Inspect history
curl http://localhost:3333/v1/tasks
```

Behind that command: a `tasks` row in SQLite, an audit-event chain with hash-chained tamper-evidence, an idempotency-key check, optimistic-locking on state transitions, and structured `cause` codes on failure.

## Test discipline (spec 031)

- Mirror-file convention: every `app/<path>/<name>.ts` has `tests/unit/<path>/<name>.test.ts`.
- Tests run via Japa: `npm test`.
- The mirror gate runs as `node --experimental-strip-types scripts/check_mirror_tests.ts` in CI.
- Opt-out per source file with `// @no-test: <reason>` in the first 5 lines.

## Project layout

```
clawie/
├── app/
│   ├── controllers/         # HTTP controllers
│   ├── models/              # Lucid models (Task, AuditEvent, User)
│   ├── services/            # Domain services
│   │   ├── task_state_machine.ts
│   │   ├── task_executor.ts
│   │   ├── audit_logger.ts
│   │   └── intents/         # Intent registry + handlers (echo)
│   └── validators/          # VineJS validators
├── commands/                # Ace CLI commands (task:run)
├── config/                  # AdonisJS config
├── database/
│   └── migrations/          # Schema migrations
├── inertia/                 # React + Inertia frontend (placeholder for Phase 6)
├── scripts/
│   └── check_mirror_tests.ts  # CI mirror-test gate
├── start/                   # routes, kernel
├── tests/
│   ├── unit/                # Japa unit tests (mirrored from app/)
│   └── integration/         # Real-DB end-to-end tests
└── ace.js                   # Ace launcher
```

## Tech stack

- AdonisJS 6, TypeScript, Node ≥ 24
- React 19 + Inertia + Vite (dashboard placeholder)
- Lucid ORM, better-sqlite3 (SQLite canonical for v1)
- Japa test runner + dbAssertions
- Edge templates (legacy auth flow scaffold retained for now)

## Roadmap

Implementation phases — see [`clawie-dev/specs/PHASES.md`](https://github.com/clawie-dev/specs/blob/main/PHASES.md).

- ✅ v0.1.0 — "Hello Task" (durable task lifecycle, audit, CLI, REST)
- v0.2.0 — Tasks run inside ephemeral Docker containers
- v0.3.0 — Real LLM via model router
- v0.4.0 — Policy engine + approval queue
- v0.5.0 — Outcall sidecar (egress isolation)
- v0.6.0 — Dashboard MVP
- v0.7.0 — Agent files (SOUL/AGENTS/TOOLS) + self-mod PR review
- v0.8.0 — Teams + multi-agent flows
- v0.9.0 — Scheduler + dual-mode crons
- v1.0.0 — Pipeline, Linear/Jira drivers, backup, upgrades, webhooks, marketplace

## License

MIT — see [LICENSE](LICENSE).

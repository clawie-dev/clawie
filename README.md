# Clawie

The Clawie autonomous-agent framework. AdonisJS 6 (TypeScript) + Inertia + React + SQLite. Designed for operators who want to run AI agents with **durable task lifecycle, default-deny policy, container isolation, network egress control, and a hash-chained audit log** — without rebuilding the substrate every time.

See [`clawie-dev/specs`](https://github.com/clawie-dev/specs) for the architecture, threat model, and phased roadmap.

## Quick start

```bash
npm install
cp .env.example .env
node ace generate:key
node ace migration:run

# Run a task (in-process for dev, Docker container in prod).
node ace task:run --intent echo --payload '"world"'

# Bring up the dashboard.
npm run dev          # → http://localhost:3333/dashboard
```

## What v1.0 ships

Clawie's substrate is built out of ten capability slices. Each slice was added as a discrete phase; each phase ships under one tagged release.

| # | Capability | Tag |
|---|---|---|
| 1 | **Durable task lifecycle** — `Task` model, optimistic-locked state machine, hash-chained `AuditEvent` log, in-process executor, `task:run` CLI, REST `/v1/tasks`. | v0.1.0 |
| 2 | **Container execution** — every intent runs inside `clawie/agent-runtime` via `ContainerSpawner`; `--read-only --network=none` by default; envelope contract on stdin/stdout. | v0.2.1 |
| 3 | **Real LLM intent** — `chat` intent in agent-runtime calls Anthropic / OpenAI; credential broker stub injects keys; cost ledger writes one row per call. | v0.3.0 |
| 4 | **Policy + approval** — default-deny `PolicyEngine`; `approval_pending` state; `task:approve` / `task:queue` CLIs; `POST /v1/tasks/:id/approval`. | v0.4.0 |
| 5 | **Pluggable egress** — `EgressProvider` interface (null default + Outcall provider for Linux deployments). | v0.5.2 |
| 6 | **Dashboard** — React + Inertia at `/dashboard` with Tasks / Approvals / Audit / Egress / Self-Mods tabs. 5s polling. | v0.6.1 |
| 7 | **Agent files + self-mod** — SOUL.md / AGENTS.yaml / TOOLS.yaml on disk; `agents:load` CLI; `agent.self_mod` intent. | v0.7.1 |
| 8 | **Teams + multi-agent** — `Team`/`TeamMember` models; tasks scoped to a team get team-isolated egress. | v0.8.1 |
| 9 | **Scheduler + crons** — `CronJob` model; `scheduler:tick` fires due jobs + sweeps expired approvals. | v0.9.0 |
| 10 | **v1.0 ship-grade** — backup/verify, outbound webhooks (HMAC-signed), comprehensive docs. | v1.0.0 |

## Operator surface

| Command | Purpose | Phase |
|---|---|---|
| `task:run --intent <name> --payload '<json>'` | Create + execute a task. | 1 |
| `task:approve --id <task> --decision approve\|deny` | Decide a pending approval. | 4 |
| `task:queue [--status pending\|approved\|denied]` | List approvals. | 4 |
| `approvals:sweep` | Expire past-deadline approvals (also runs in `scheduler:tick`). | 4 |
| `agents:load <directory>` | Hydrate a SOUL/AGENTS/TOOLS agent. | 7 |
| `teams:create <slug>` | Create a team with a DNS-safe slug. | 8 |
| `outcall:sync --team <slug>` | Generate the team's Outcall rule pack. | 8a |
| `cron:create <name> --schedule '5 * * * *' --intent ...` | Register a recurring job. | 9 |
| `scheduler:tick` | One scheduler iteration (host-cron entry-point). | 9 |
| `backup:create <path>` | Atomic SQLite snapshot via `VACUUM INTO`. | 10 |
| `backup:verify <path>` | Schema check + audit-chain verify of a snapshot. | 10 |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | unset | Credentials for `chat`. Injected into the agent container. |
| `CLAWIE_EGRESS` | `null` | `null` (no network isolation) or `outcall` (Linux + outcalld required). |
| `OUTCALL_HOST_SOCKET` | `/run/outcall/host.sock` | Outcall host API socket. |
| `OUTCALL_NETWORK` | `clawie` | Outcall network suffix (full name: `outcall-<value>`). |
| `OUTCALL_GATEWAY` | `10.200.0.1` | Gateway IP (DNS filter + HTTP proxy). |
| `OUTCALL_MOUNT_AGENT_SOCKET` | unset | Set to `1` to mount the agent shim for permissions checks. |

## Outcall integration

Clawie is a *consumer* of [Outcall](https://github.com/outcall-dev/root). Outcall does NOT depend on Clawie. When `CLAWIE_EGRESS=outcall`:

- Each team gets a dedicated Outcall Docker network.
- Agent containers get `--network`, `--dns`, `HTTP(S)_PROXY` so egress passes through Outcall's L3 + L4 + L7 enforcement.
- Dashboard surfaces live rule + proxy state via `/api/v1/rules` and `/api/v1/proxy`.

Full integration matrix: [`docs/integrations/outcall.md`](docs/integrations/outcall.md).
Scheduler-load perf brief: [`docs/integrations/outcall-perf.md`](docs/integrations/outcall-perf.md).

## What v1.0 deliberately defers

- **Linear / Jira drivers** (spec 026) — v1.x patch.
- **Marketplace registry** (spec 024) — UI surface only in v1.0.
- **In-process ticker** — host cron is the v1.0 entry-point; long-running ticker in v1.1.
- **Webhook retries** — single-attempt with audit in v1.0; backoff/retry in v1.x.

## License

MIT.

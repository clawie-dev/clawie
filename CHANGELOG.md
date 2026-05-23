# Changelog

All notable changes to Clawie are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and Clawie follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.0.0] — Phase 10: v1.0 ship-grade

First stable release. Consolidates Phases 1–9a into one operator-
deployable surface and adds atomic backup, snapshot verification,
and outbound webhooks.

### Added (v1.0 only — prior tags ship the rest of the surface)

- **`backup:create <path>` CLI** — atomic SQLite snapshot via `VACUUM INTO`. Online, no downtime. Destination must not exist.
- **`backup:verify <path>` CLI** — opens a snapshot read-only, checks schema (`tasks`, `audit_events`, `policies`, `approvals`, `teams`, `cron_jobs`), walks the audit hash-chain end-to-end. In v1.0 restore is a manual `cp` + restart; in-place restore is a v1.x patch.
- **`WebhookSubscription` model + migration** — name (unique), url, event_pattern (exact / `prefix.*` / `*`), optional secret, enabled.
- **`WebhookDispatcher`** — `app/services/webhook_dispatcher.ts`. Best-effort POST to each matching subscription; HMAC-signs the body when secret is set (`x-clawie-signature: sha256=...`); audits every attempt. Single attempt v1.0; retry/backoff in v1.x.
- **README** rewritten for v1.0 — phase capability table, operator-surface table, full env-var matrix.
- **Tests** — 4 `WebhookSubscription` tests, 6 `WebhookDispatcher` tests. 169 total (+10 vs v0.9.0).

### What v1.0 promises

- **Substrate stability.** Phase 1–9a APIs (state machine, intents, dispatch, audit, egress provider interface) are under SemVer. Breaking changes require a major bump.
- **Backup discipline.** `backup:create` + `backup:verify` is the operator safety net.
- **Audit chain integrity.** In-process `verifyChain()` + offline `backup:verify` detect tampering at any storage layer.
- **Webhook outbound.** Wire Clawie to existing ops systems without modifying it.

### Spec alignment

- Spec 016 (pipeline state machine) — Phase 1's state machine is canonical.
- Spec 028 (backup/DR) — `backup:create` + `backup:verify`.
- Spec 029 (upgrades) — SemVer + reversible migrations.
- Spec 030 (webhooks) — outbound HMAC-signed delivery.

### Repo summary at v1.0

| Repo | Tag | Role |
|---|---|---|
| `clawie-dev/clawie` | **v1.0.0** | The framework (this repo). |
| `clawie-dev/agent-runtime` | **v0.5.0** | Base Docker image: echo + chat handlers + Outcall agent shim client. |
| `clawie-dev/outcall-presets` | HEAD | `presets/clawie-default.yaml` Outcall rule pack. |
| `clawie-dev/specs` | HEAD | `PHASES.md` + the spec set. |
| `Outcall-dev/root` (independent) | v0.1.7+ | Optional egress filter daemon. |

### v1.0 deliberately defers (to v1.x)

- Linear / Jira drivers (spec 026).
- Marketplace registry (spec 024) — UI hook only.
- In-process scheduler ticker (v1.0 uses host cron).
- Webhook retry / backoff.
- `default-agency` starter pack and `clawie.dev` landing — separate repos, not gated.

## [0.9.0] — Phase 9: Scheduler + Crons

Recurring tasks. `cron_jobs` rows describe (name, cron expression,
intent, payload template, team). `scheduler:tick` fires due jobs and
sweeps expired approvals; operators wire it into a host cron (every
minute). When `nextRunAt <= now` the scheduler creates a task via the
state machine, advances `nextRunAt` to the next cron firing, and
emits a `cron.fired` audit event.

### Added

- **`CronJob` model + migration.** name (unique), cron_expression (5-field), intent, payloadTemplate (JSON), teamSlug, enabled, lastRunAt, nextRunAt, lastTaskId.
- **`parseCron()` + `nextFiring()`** — `app/services/cron.ts`. Zero-dep 5-field parser. Supports `*`, exact, ranges (`a-b`), lists (`a,b,c`), steps (`X/N`). POSIX OR-semantics when both DOM and DOW are restrictive. 366-day forward bound.
- **`Scheduler.tick()`** — `app/services/scheduler.ts`. Per due job: create task, advance nextRunAt, audit. Approvals sweep runs in the same tick.
- **CLIs** — `scheduler:tick`, `cron:create <name> --schedule '5 * * * *' --intent ... --payload ...`.
- **Audit actions** — `cron.fired`, `cron.fire_failed`.
- **Tests** — 8 cron parser, 2 CronJob model, 5 Scheduler. 159 total (+15 vs v0.8.1).

### Operator wiring

```
* * * * * cd /path/to/clawie && node ace scheduler:tick >> /var/log/clawie/tick.log 2>&1
```

### Spec alignment

- Spec 027 (scheduler + crons).
- Spec 006/007 (audit carries cron source dimension).

## [0.8.1] — Phase 8a: Per-team rule scoping ergonomics

Operators move from "edit YAML by hand" to "one command per team".
`node ace outcall:sync --team <slug>` generates a per-team Outcall
rule pack, writes it to `/etc/outcall/rules.d/clawie-team-<slug>.yaml`,
and triggers `POST /api/v1/rules/reload`.

### Added

- **`RulePackWriter`** — `app/services/egress/rule_pack_writer.ts`. Renders a team-scoped YAML rule pack (`agent.name == "clawie-<slug>-chat" && (dns.query == ... || http.host == ...)`), writes it to the configured `rulesDir`, POSTs to the daemon's reload endpoint.
- **`outcall:sync` CLI** — `node ace outcall:sync --team <slug> [--hosts host1.com,host2.com]`. Default host set: `api.anthropic.com`, `api.openai.com`.
- **Tests** — 4 RulePackWriter tests. 144 total (+4 vs v0.8.0).

### No upstream Outcall PR this release

The endpoints we use (`/api/v1/rules/reload`) and rule shape (`agent.name`, `dns.query`, `http.host`) already exist in Outcall v0.1.7+. Future Phase 8a follow-ups (per-team budget caps, rule provenance metadata) may require upstream changes; those PRs would justify themselves to any multi-tenant operator and would not be Clawie-specific.

## [0.8.0] — Phase 8: Teams + Multi-Agent

Agents group into Teams. Each team gets a dedicated Outcall network
(`outcall-clawie-team-<slug>`) when `CLAWIE_EGRESS=outcall`, so cross-
team isolation is *structural* (separate L2 bridges) — not just
policy-enforced. Tasks scoped to a team carry a `teamSlug`; the
dispatch path forwards it through to the egress provider, which uses
it for both the network attachment and the container name (so
Outcall's `agent.name` rule binding resolves to `clawie-<team>-<intent>`).

### Added

- **`Team` model + migration** — slug (unique, DNS-safe), name, description.
- **`TeamMember` model + migration** — agent ↔ team association with `role` (member|lead). `(team_id, agent_name)` is unique.
- **`Task.teamSlug`** column — optional team scoping. `CreateTaskInput.teamSlug` flows through.
- **`IntentContext.teamSlug`** field — the executor pulls it from the task and passes it to the handler.
- **`EgressProviderContext.teamSlug`** field — the `OutcallEgressProvider` reads it and picks the per-team network + container name prefix.
- **`teams:create` CLI** — `node ace teams:create <slug> [--name '...'] [--description '...']`. Slug validated as DNS-safe.
- **Tests** — 2 Team model, 2 TeamMember model, 2 team-aware outcall wrap. 140 total (+6 vs v0.7.1).

### Spec alignment

- Spec 013 (team orchestration) — first iteration.
- Spec 014 (inter-agent comms) — model only; messaging primitive comes in Phase 8a.

### What's deliberately deferred

- **Inter-agent comms / tickets.** Not implemented yet. Phase 8a or follow-up.
- **Per-team budgets.** Cost ledger doesn't filter by team yet. Phase 8a.
- **Outcall rule packs per team.** v0.5.2 `clawie-default.yaml` rule pack is team-agnostic; per-team packs are an operator workflow until Phase 8a builds the ergonomics.

## [0.7.1] — Phase 7a: Outcall agent-shim integration (docs)

Phase 7a center of gravity is in `clawie/agent-runtime` v0.5.0
(`OutcallAgent` permissions client). On the Clawie control-plane
side there's no code change — the `/run/outcall/agent.sock` shim
authenticates via `SO_PEERCRED` on the unix socket, so only the
container (not Clawie's process) can call it. v0.7.1 ships a
docs-only update to `docs/integrations/outcall.md` describing the
contract: when to call it, how `available()` gates graceful
fallback, and how to enable the mount via
`OUTCALL_MOUNT_AGENT_SOCKET=1`.

### Companion releases

- [clawie/agent-runtime v0.5.0](https://github.com/clawie-dev/agent-runtime/releases/tag/v0.5.0) — the `OutcallAgent` client utility.

### What's deliberately deferred

- **First consumer.** No agent-runtime handler currently writes to the host filesystem or execs a shell, so no caller yet needs the permissions check. Lands when the agent tool layer arrives (post-Phase 7).

## [0.7.0] — Phase 7: Agent Files + Self-Mod

Agents are first-class. An agent lives in a directory with three
files (SOUL.md, AGENTS.yaml, TOOLS.yaml); `agents:load <dir>` reads
the directory and upserts an `AgentDefinition` row. Agents propose
changes to their own files via the `agent.self_mod` intent — the
proposal is recorded as an `AgentModification` row in `pending`
state and surfaces in the dashboard's new Self-Mods tab.

### Added

- **`AgentDefinition` model + migration.** Persisted snapshot of an agent: name (unique), raw `SOUL.md` / `AGENTS.yaml` / `TOOLS.yaml`, sourcePath, loadedAt.
- **`AgentModification` model + migration.** One row per self-mod proposal: agentName, taskId (unique), status (pending/applied/rejected), unified diff, structured proposed changes (JSON), decidedBy/At/reason.
- **`AgentLoader`** — `app/services/agent_loader.ts`. Reads the three files from a directory, upserts a definition. Raw text preserved verbatim; parsing into structured fields is deferred so we can rev the YAML schema without re-reading from disk.
- **`agent.self_mod` intent** — `app/services/intents/agent_self_mod.ts`. In-process (no container roundtrip). Validates payload (allowed paths only: SOUL.md / AGENTS.yaml / TOOLS.yaml), builds a minimal diff against the current snapshot, persists. Returns the diff in the envelope output.
- **`agents:load` CLI** — `node ace agents:load <directory>` loads or refreshes an agent.
- **Dashboard Self-Mods tab.** 5th tab, shows pending + recent agent modifications with their diffs.
- **Tests** — 4 loader tests, 2 AgentDefinition model tests, 3 AgentModification model tests, 5 self-mod intent tests. 134 total (+14 vs v0.6.1).

### Spec alignment

- Spec 008 (agent files: SOUL/AGENTS/TOOLS).
- Spec 009 (self-modifications surface for human review) — leans on Phase 4's approval primitives for the human-review pattern.

### What's deliberately deferred

- **Apply step.** Approving a modification currently only changes its status; writing the new content back to disk is Phase 7a or Phase 8 (when git-backed sync lands).
- **YAML parsing.** AGENTS.yaml's cron schedule + TOOLS.yaml's permissions are *stored* but not yet *consumed*. Phase 9 (scheduler) reads schedules; Phase 7a wires permissions into Outcall's shim.

## [0.6.1] — Phase 6a: Outcall dashboard handoff

The dashboard gains an **Egress** tab. When the active `EgressProvider`
is Outcall, the controller calls the daemon's host API and the tab
renders:

- Daemon panel — bridge name, up/down, nftables active, proxy URL.
- Proxy counters — active connections, total requests, total blocked,
  block-rate %.
- Active rules — id, action (allow/block badge), CEL condition
  preview, source file.

When `CLAWIE_EGRESS` is unset / `null` the tab renders an empty state
with a hint to set the env. When the provider is `outcall` but the
daemon is unreachable, the tab shows the error string and the rest of
the dashboard keeps working — one bad downstream doesn't take down the
whole page.

### Added

- **`OutcallApiClient`** — `app/services/egress/api_client.ts`. Read-only wrapper over the host API at `/run/outcall/host.sock`. Three typed methods: `bridgeStatus()`, `rulesList()`, `proxyStatus()`. Reuses the `unixSocketRequest` helper from v0.5.2.
- **`EgressTab` React component** — `inertia/pages/dashboard/index.tsx`. New tab in the dashboard, fed a single discriminated-union prop (`{active: false}` or `{active: true, bridge, rules, proxy}`).
- **`DashboardController.loadEgressData()`** — branches on the active provider's `name`. Outcall path runs three reads in parallel via `Promise.all`. Failures degrade to `{active: false, error}` (logged + UI-surfaced); they don't propagate to the rest of the dashboard.
- **Tests** — 6 new `OutcallApiClient` tests against a fake outcalld served over a temp Unix socket (happy paths for each endpoint, non-200 status, envelope `success: false`, unreachable socket). 120 total.

### Changed

- Polling reload now includes `egress` in the `only:` set so the tab refreshes every 5s along with the others.
- Dashboard prop shape gains the discriminated-union `egress` field.

### Upstream PRs

None this release. The three endpoints Phase 6a needs (`/api/v1/bridge`, `/api/v1/rules`, `/api/v1/proxy`) already exist in Outcall v0.1.7+. A real-time block-event stream (e.g. `GET /api/v1/proxy/events` over server-sent events or WebSocket) would benefit any UI consumer; if/when we add live "agent X just got blocked reaching Y" notifications, that's the candidate for an upstream PR. Out of scope for v0.6.1.

### Spec alignment

- Spec 022 (web dashboard) — second iteration.
- Spec 002 (container runtime + outcall) — consumer-side dashboard.

## [0.6.0] — Phase 6: Dashboard MVP

First UI. `GET /dashboard` renders a React + Inertia page with three
tabs: Approvals (pending queue with countdown deadlines and approve/
deny actions), Tasks (latest 50 with status + intent + outcome), and
Audit (latest 100 events from the hash-chained log).

Mutations don't live in the dashboard — Approve/Deny buttons POST to
the existing `/v1/tasks/:id/approval` REST endpoint, so one path
serves both UI and API and the audit chain captures both equally.

### Added

- **`DashboardController`** — `app/controllers/dashboard_controller.ts`. Three parallel queries (tasks, pending approvals, recent audit), one Inertia render. Read-only; no mutations.
- **`/dashboard` route** — registered in `start/routes.ts` as `dashboard`.
- **`inertia/pages/dashboard/index.tsx`** — React component (typed as `React.FC<DashboardProps>` so Inertia's `ExtractProps` resolves correctly). Tabs, badges, countdown formatting, polling refresh every 5s via `router.reload({ only: [...] })`. No new UI dep; styling is inline `React.CSSProperties` to keep the surface tiny.

### Test posture

- Dashboard controller is `@no-test`'d (per the existing `app/controllers/approvals_controller.ts` pattern). It's thin glue over models that have their own unit-test mirrors (Task, Approval, AuditEvent).
- 114 unit tests still pass; no new tests added in this phase. A real `tests/functional/dashboard.test.ts` lands when we have proper Japa API-client wiring (separate cleanup).

### TypeScript note

The controller's `inertia.render('dashboard/index', props)` carries an `as never` cast with a documented comment. Reason: the inertia tsconfig transitively type-checks backend controllers through the auto-generated `#generated/controllers` chain, but the `InertiaPages` module augmentation in `.adonisjs/server/pages.d.ts` isn't visible from that compilation unit, so the page-name parameter narrows to `never`. Under the app tsconfig the call type-checks cleanly. Revisit when AdonisJS Inertia ships a typed helper that doesn't depend on module augmentation.

### Not in this phase (deferred)

- **Auth.** `/dashboard` is currently unauthenticated, same as `/v1/*`. Putting the dashboard behind `middleware.auth()` lands when we decide on the operator-auth UX (separate from agent-auth).
- **WebSocket push.** The 5s polling is the MVP; WebSocket events come with Phase 6a (which also wires the Outcall block-events feed).
- **Per-task detail page.** Phase 6 ships the lists only. Drill-down lands when the audit-chain-as-narrative view is designed.

### Spec alignment

- Spec 022 (web dashboard) — first iteration.
- Spec 005 (approvals HITL) — UI surface for the queue.
- Spec 006 (observability) — read view of the chained audit log.

## [0.5.2] — Phase 5b: Outcall connector

Real `OutcallEgressProvider`. When the operator sets `CLAWIE_EGRESS=outcall`,
Clawie boot probes the Outcall daemon at `/run/outcall/host.sock`, ensures
the `outcall-clawie` network exists, and attaches every spawned agent
container to it. Outcall enforces egress at L3 (nftables) + L4 (DNS filter)
+ L7 (HTTPS_PROXY-driven HTTP proxy). If the daemon is unreachable, the
provider logs and degrades to null so Clawie still starts.

### Added

- **`OutcallEgressProvider`** — `app/services/egress/outcall_provider.ts`. Implements the Phase 5 `EgressProvider` interface. Constructor takes `hostSocketPath`, `networkName`, `gateway`, and `mountAgentSocket` (defaults match Outcall's quickstart). `bootstrap()` does `GET /api/v1/bridge` → assert up + nftables active → `POST /api/v1/network/create`. `wrap()` decorates the `SpawnRequest` with `customNetworkName=outcall-<networkName>`, `--dns <gateway>`, container name `clawie-<intent>-<8-hex>`, and `HTTP(S)_PROXY=http://<gateway>:8080`.
- **`unixSocketRequest`** — `app/services/egress/unix_socket_client.ts`. Minimal HTTP-over-Unix-socket client over `node:http` (no extra dep). Outcall's host API uses Unix sockets; Node 24's `fetch` doesn't expose `socketPath`, so we go through `http.request` directly.
- **`selectEgressProviderFromEnv()`** — `app/services/egress/index.ts`. Boot-time provider selection from `CLAWIE_EGRESS`. Defaults to null. `outcall` instantiates the Outcall provider and bootstraps; degrades on failure.
- **`EgressProvider` AdonisJS provider** — `providers/egress_provider.ts`. Registers in `adonisrc.ts` after `api_provider`. Runs `selectEgressProviderFromEnv()` on `ready()` and installs the result into the singleton.
- **`customNetworkName`** field on `SpawnRequest` — when set, overrides the `network`-mode-derived flag (`--network=<name>` instead of `--network=none` / `--network=bridge`). This is the seam any custom-network egress provider needs.
- **Companion preset** — `clawie-dev/outcall-presets/presets/clawie-default.yaml`. Allow rules for `chat` intent (Anthropic + OpenAI) keyed on `agent.name == "clawie-chat"`. Operator drops it in `/etc/outcall/rules.d/` and runs `outcall rules reload`.
- **Tests** — 6 OutcallEgressProvider tests (real Unix-socket server on a temp socket), 4 provider-selection tests, 1 spawner customNetworkName test. 114 total (+11 vs v0.5.1).

### Changed

- `ContainerSpawner.spawn()` honors `customNetworkName` if present, otherwise falls back to `networkFlag(network)`. No change to existing callers.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CLAWIE_EGRESS` | `null` | `null` (default, no isolation) or `outcall` (consume the daemon). |
| `OUTCALL_HOST_SOCKET` | `/run/outcall/host.sock` | Path to outcalld's host API socket. |
| `OUTCALL_NETWORK` | `clawie` | Network suffix; full Docker network name is `outcall-<value>`. |
| `OUTCALL_GATEWAY` | `10.200.0.1` | Gateway IP (runs DNS filter on 53, HTTP proxy on 8080). |
| `OUTCALL_MOUNT_AGENT_SOCKET` | unset | Set to `1` to mount `/run/outcall/agent.sock` into agents (prep for Phase 7a). |

### What this does NOT do (yet)

- **Linux-only.** Outcall needs nftables. On macOS/Windows, `CLAWIE_EGRESS=outcall` will fail the daemon probe and degrade to null. This is intentional; Clawie's dev experience on macOS is the null provider.
- **No dynamic rule writing.** v0.5.2 doesn't write rules from Clawie to Outcall — it assumes the operator pre-installed a preset (e.g. `clawie-default.yaml`). Dynamic rule management is deferred to Phase 8a.
- **No real-daemon integration test.** Unit tests use a fake outcalld over a Unix socket in a tmp dir. A live-daemon integration test gated on `OUTCALL_INTEGRATION=1` lands in a follow-up.

### Spec alignment

- Spec 002 (container runtime + outcall) — the consumer side. Outcall enforces; Clawie wires.
- Spec 012 (credential broker) — unchanged. Credentials still come from `credentialBroker().envFor()` and live in the agent's env. Outcall does not inject credentials.

### Companion releases / artifacts

- `clawie-dev/outcall-presets` ships `presets/clawie-default.yaml` (a generic Outcall rule pack, no Clawie-private fields).

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

[Unreleased]: https://github.com/clawie-dev/clawie/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/clawie-dev/clawie/releases/tag/v1.0.0
[0.9.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.9.0
[0.8.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.8.1
[0.8.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.8.0
[0.7.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.7.1
[0.7.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.7.0
[0.6.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.6.1
[0.6.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.6.0
[0.5.2]: https://github.com/clawie-dev/clawie/releases/tag/v0.5.2
[0.5.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.5.1
[0.5.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.5.0
[0.4.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.4.0
[0.3.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.3.0
[0.2.1]: https://github.com/clawie-dev/clawie/releases/tag/v0.2.1
[0.2.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.2.0
[0.1.0]: https://github.com/clawie-dev/clawie/releases/tag/v0.1.0

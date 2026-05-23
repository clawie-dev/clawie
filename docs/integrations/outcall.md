# Outcall integration — audit & gap matrix (Phase 5a)

**Date:** 2026-05-23
**Outcall version surveyed:** v0.1.7 → v0.1.8 unreleased (beta, post hardening wave of 2026-05-19/20)
**Clawie version:** v0.5.1
**Status of this document:** Phase 5a deliverable. Drives Phase 5b implementation.

## What this audit answers

1. Is Outcall a reasonable network-isolation layer for Clawie agent containers? (Yes — with documented caveats.)
2. Where do Clawie's needs map cleanly onto Outcall's surface? (Most of them.)
3. Where are the gaps, and how do we close them? (Almost entirely in the Clawie adapter; very few upstream PRs needed for v0.5.2.)

## Dependency posture

**Outcall does not depend on Clawie.** Clawie consumes Outcall via:
- Docker (`--network outcall-X`, `--dns`, `HTTP(S)_PROXY` env, optional `/run/outcall/agent.sock` mount)
- Outcall host API at `/run/outcall/host.sock` (Unix socket)
- Rule files in `/etc/outcall/rules.d/*.yaml`
- The `outcall-agent` shim binary, optionally mounted into Clawie agent containers

Any upstream PRs Clawie sends to Outcall must justify themselves to a non-Clawie operator. Clawie-specific shape lives in Clawie's `OutcallEgressProvider` adapter, not in Outcall itself.

## Capability matrix

| Clawie need (from `specs/PHASES.md`) | Outcall coverage | Gap? | Resolution |
|---|---|---|---|
| Per-intent egress allowlist (e.g. `chat` may reach `api.anthropic.com`) | YAML rules in `/etc/outcall/rules.d/`, CEL condition `http.host == "api.anthropic.com"`, `action: allow`, `egress: {mode: proxy}` | None | **Adapter:** write `/etc/outcall/rules.d/clawie-<intent>.yaml`, then `POST /api/v1/rules/reload`. |
| Agent identity scoping in rules | `agent.name` field, derived from container name with trailing `-N` replica suffix stripped, populated via `managed-by=outcalld` label + `SO_PEERCRED` | None — clean fit | **Adapter:** name spawn containers `clawie-<intent>-<short-uuid>`. `agent.name` resolves to `clawie-<intent>`. Rules then condition on `agent.name`. |
| Default-deny posture | nftables `policy drop`, DNS filter NXDOMAIN on no-match, L7 proxy 403 on no-match, rule engine `Decision::Block` default | None — exactly what we want | Use as-is. |
| Network attachment | `outcall network create --name X` → Docker network `outcall-X` with gateway `.1` running DNS + L7 proxy | None | **Adapter:** on boot, ensure `outcall-clawie` network exists; spawn containers with `--network outcall-clawie`. |
| Proxy env injection | Operator supplies `HTTPS_PROXY`/`HTTP_PROXY` to the agent; Outcall's proxy is at gateway:8080 | None | **Adapter:** spawn args include `-e HTTPS_PROXY=http://10.200.0.1:8080 -e HTTP_PROXY=http://10.200.0.1:8080`. |
| DNS rebinding protection | BYPASS-03a/b resolved (2026-05-19): private/loopback/link-local/ULA/multicast/v4-mapped IPs stripped from upstream A/AAAA answers unless `egress.allow_private_ips: true` | None | Use as-is. |
| Container-to-container isolation | T-2 (forward chain drops bridge-to-bridge); BYPASS-08 (ARP cache disclosure) is an accepted limitation — informational only | Partially accepted | **Adapter:** for stronger isolation, use one Outcall network per team (Phase 8). |
| HTTPS method/path filtering | **Out of scope (N-6).** Outcall doesn't terminate TLS; rule scope on HTTPS is `http.host` (SNI). | Accepted limitation | **Documented as a Clawie limitation.** Clawie cannot enforce method/path on HTTPS via Outcall. |
| File / tool / shell permissions inside the agent | `outcall-agent` shim's `permissions check` API exposes `run.tool`, `run.args`, `run.cwd` to the rule engine | None | **Phase 7a:** wire Clawie's self-mod handler to invoke the shim before executing tool/file actions. |
| Container lifecycle helpers | `outcall container create --image ... --network ...` wires DNS, proxy, shim, labels in one call | Optional convenience | **Adapter chooses:** raw `docker run` for control + visibility, OR `outcall container create`. v0.5.2 uses raw `docker run` (we already have `ContainerSpawner`). |
| Rule reload | `outcall rules reload` CLI; `POST /api/v1/rules/reload` API; atomic — failure leaves old set active | None | **Adapter** calls the API endpoint. Response includes `files_loaded`, `rules_loaded`, validation warnings. |
| Operator approval for agent-submitted rules | Agent-API rule requests are queued for operator approval (`outcall agent rules` flow) | None — already there | Clawie's existing Phase 4 approval queue can surface these via a separate intent type, if/when needed. Not on Phase 5b's critical path. |
| Rate limits / abuse protection | Agent API rate-limited; semaphore-bounded proxy accepts; 50ms rule-eval timeout warning | None | Use as-is. |
| Dashboard data (rules, recent blocks, per-agent traffic) | `GET /api/v1/rules` confirmed; per-block + per-agent endpoints unverified | **Likely gap** | **Phase 6a:** audit `outcall-api` for read endpoints; PR upstream what's missing (justified for any UI consumer). |
| Per-team rule scoping at scale | `agent.name` scoping works; per-team CLI ergonomics unverified | **Likely gap** | **Phase 8a:** evaluate then PR upstream (`outcall rules list --agent foo`?). |
| Cost / usage / quota enforcement | **Out of scope (N-1, N-8).** Outcall enforces *where*, not *what* | Accepted | Clawie's cost ledger + budget governance live in Clawie. |
| Linux-only | `outcalld` needs `NET_ADMIN` + nftables + Docker | **Real gap** for macOS dev / CI | **Adapter:** probe `outcall bridge status` on boot; degrade to `NullEgressProvider` with a warning if the daemon is unreachable. Document that on macOS the null provider is the only option. |
| Daemon liveness check | `outcall bridge status` returns daemon state | None | Use as-is. |

## Threat model alignment

Outcall's threat model (`docs/security/threat-model.md`) addresses 10 in-scope threats (T-1…T-10) and 10 explicitly out-of-scope (N-1…N-10).

The Outcall threats most relevant to Clawie:

- **T-1** (arbitrary public host) — exactly what we want blocked for chat-class intents.
- **T-3** (private RFC1918 reach) — relevant because Clawie's control plane sits on the host's private network. Outcall blocks this by default; we keep `allow_private_ips: false`.
- **T-4** (agent claims to be a different agent) — relevant for Clawie team isolation. Identity is kernel-derived (`SO_PEERCRED` / label), so safe.
- **T-7** (Host-header smuggling) — relevant for chat intents. SNI mismatch closes the tunnel on HTTPS.
- **T-9** (agent loads its own DoH/DoT) — relevant because LLM clients sometimes use cross-channel DNS. Outcall blocks it at L3 unless an explicit allow exists.

The out-of-scope items Clawie inherits:

- **N-1, N-8** — Outcall doesn't protect against an agent leaking secrets through an *allowed* destination. Clawie's policy + audit + cost-ledger layer is where this surfaces, not Outcall.
- **N-2** — kernel-escape attacks. Clawie does not change this story; deploy on a hardened host or move to gVisor/Kata.
- **N-6** — no HTTPS method/path filtering. Clawie *cannot* promise "agent may POST but not DELETE on api.github.com". Documented.

## Test posture (what Outcall already validates)

- **496 Rust tests** across the workspace.
- **38 Rust integration tests** in `application/outcalld/tests/*` covering proxy HTTP/HTTPS/DNS, bridge, dynamic rules, CLI, agent API.
- **19 numbered E2E scripts** in `scripts/e2e/tests/01-…-18-…` covering TCP/DNS/ICMP block, host reach, allow-then-reblock, DNS allow IPv4/IPv6, HTTP/HTTPS allow, proxy egress, direct-IP egress, private-IP block, port-scan block, security-boundary, trusted-repos, hostname-IP allowlist, host-CLI restrictions, IPv6 block.
- **34 adversarial bypass tests** in `scripts/test-bypass.sh` covering CONNECT-to-SSH/SMTP/Redis, DoH/DoT, IPv6 routing, ARP/broadcast, container-to-container, Host-header smuggling.
- **Payload tests** in `scripts/test-payloads.sh` covering specific bypass vectors.
- **Two recent security audits** (2026-05-14, 2026-05-20).

The bypass + payload suites only became reliable on 2026-05-19 — prior to that, `|| true` was swallowing failures. Statistical confidence is young but real.

## Known accepted limitations (Outcall's docs)

| # | Limitation | Clawie response |
|---|---|---|
| N-6 | HTTPS no method/path filtering | Document; don't promise this in Clawie's policy DSL. |
| BYPASS-08 | ARP cache readable inside agents (informational only) | Mitigate via per-team networks (Phase 8). |
| BYPASS-11 residual | Link-local IPv6 multicast at L2 (scope-confined to bridge) | Mitigate via per-team networks (Phase 8). |
| — | Release artifacts unsigned (planned v0.2) | Operator advisory; defer to Phase 10a. |
| — | Tighter `outcall-agent` seccomp profile (planned) | Defer to Phase 10a. |

## Decisions per gap

### In Clawie adapter (Phase 5b, no Outcall PR)

1. **`OutcallEgressProvider`** at `app/services/egress/outcall_provider.ts`.
2. **Daemon probe** on Clawie boot: `GET /api/v1/bridge/status` via Unix socket. If unreachable, log a warning and degrade to `NullEgressProvider`.
3. **Network bootstrap**: ensure `outcall-clawie` network exists (`POST /api/v1/networks` or shell out to `outcall network create --name clawie`).
4. **Per-intent rule provisioning**: on `registerBuiltinIntents()`, write `/etc/outcall/rules.d/clawie-<intent>.yaml`, then `POST /api/v1/rules/reload`. Idempotent.
5. **`wrap(req, ctx)` decorates** the spawn request with:
   - extraArgs: `--network outcall-clawie`, `--dns 10.200.0.1`, container name `clawie-<intent>-<8-char-uuid>`
   - env merge: `HTTPS_PROXY=http://10.200.0.1:8080`, `HTTP_PROXY=http://10.200.0.1:8080`
   - (optional) volume mount: `/run/outcall/agent.sock:/run/outcall/agent.sock` for Phase 7a permissions checks
6. **Config env vars** (with sane defaults):
   - `CLAWIE_EGRESS=outcall|null` (default `null` — opt-in)
   - `OUTCALL_NETWORK=clawie`
   - `OUTCALL_GATEWAY=10.200.0.1`
   - `OUTCALL_HOST_SOCKET=/run/outcall/host.sock`

### Upstream PRs deferred to lettered phases

| Phase | Likely PR | Justification beyond Clawie |
|---|---|---|
| 6a | Read endpoints on `outcall-api`: recent block events, per-agent traffic counters | Any UI consumer (Outcall's own dashboard) benefits |
| 7a | Any `permissions check` field Clawie's self-mod flow needs that doesn't exist yet | Any agent shim consumer benefits |
| 8a | Per-team query/list ergonomics (e.g. `outcall rules list --agent-prefix foo-`) | Any multi-tenant operator benefits |
| 9a | Perf regressions hit under Clawie's scheduler load | Any operator running many agents benefits |
| 10a | Outcall v0.2 signed-artifact alignment | Outcall's own GA |

### Accepted limitations (documented, no fix)

- HTTPS method/path filtering — N-6.
- Linux-only — null provider on macOS.
- HTTPS body-content matching — same as N-6.
- L2 ARP/multicast disclosure between containers on the same bridge — mitigate via per-team networks, accept otherwise.

## Recommendations for Phase 5b

1. **Implement `OutcallEgressProvider` against the host API** (Unix socket), not by shelling out to `outcall` CLI. The API is the stable contract; the CLI ergonomics are a moving target.
2. **Keep all Outcall-specific code in `app/services/egress/outcall_provider.ts`.** The `EgressProvider` interface stays neutral.
3. **Gate integration tests on `OUTCALL_INTEGRATION=1`**. CI runs unit tests with a mocked Unix-socket server. A separate Linux job (or local-only step) runs the real-daemon integration test.
4. **Ship `outcall-presets/presets/clawie-default.yaml`** as the default rule pack Clawie's adapter writes. Generic (no Clawie-private fields), reviewable as a PR.
5. **Document the threat-model inheritance** in Clawie's own threat model: Outcall handles network egress; everything else (filesystem, kernel, cost, data exfil through allowed channels) stays Clawie's or the operator's responsibility.

## Open questions for Phase 5b

- **Do we write rules per-intent or one consolidated file?** Per-intent makes diffs easier and aligns with the `chat → providers` mental model. One file scales better at 100 intents. Recommend per-intent for v0.5.2, revisit at Phase 8.
- **Should Clawie write to `/etc/outcall/rules.d/` directly, or always via `POST /api/v1/rules/reload`?** Direct write requires Clawie's process to have file access on the host — likely a no-go in containerized deployments. Always-via-API is the right default.
- **Where does the network name come from?** Default `outcall-clawie`. Per-team in Phase 8 makes it `outcall-clawie-team-<slug>`. Configurable via `OUTCALL_NETWORK`.

---

## Phase 5a exit status

- [x] Outcall's surface mapped against Clawie's needs.
- [x] Gaps categorised as: adapter / upstream PR / accepted.
- [x] Phase 5b implementation plan written.
- [x] No upstream PRs required for Phase 5b core flow.
- [ ] Linux integration audit *(deferred — separate Linux-host session; Outcall's own CI already runs the bypass + payload + E2E suites)*.

The phase is **research-only** (no Clawie tag). Phase 5b can begin.

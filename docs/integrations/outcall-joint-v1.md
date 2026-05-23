# Joint v1 alignment — Clawie + Outcall

**Status:** Phase 10a, research-only. No Clawie tag.

## What Clawie v1.0 says about Outcall

Clawie v1.0.0 is shippable **without** Outcall. The default
`EgressProvider` is `null` (no network isolation); operators opt into
the `outcall` provider via `CLAWIE_EGRESS=outcall`. The pinned
minimum is **Outcall v0.1.7** (the version surveyed in
[`outcall.md`](outcall.md)).

When `CLAWIE_EGRESS=outcall` and the daemon is unreachable, Clawie
logs a warning and falls back to the null provider so Clawie still
starts. The operator's monitoring catches the degradation; Clawie's
job is to be useful even when its optional dependencies are absent.

## What Outcall v0.2 brings

Per Outcall's own roadmap (the `Still deferred` section of
`docs/security/audit-2026-05-20.md`):

| Item | Effect on Clawie |
|---|---|
| **Signed release artifacts** (Sigstore / SBOM) | Clawie operators can verify the daemon binary against the signed release. We pin the *signed* v0.2 version once it lands. |
| **Tighter `outcall-agent` seccomp profile** | Clawie's agent containers (when run with `OUTCALL_MOUNT_AGENT_SOCKET=1`) get a smaller syscall attack surface for free. |
| **Real-time block-event stream** (potential, per Phase 6a notes) | Clawie's dashboard upgrades from polling to WebSocket. We don't gate on this for v1.0. |

Outcall's v0.2 timeline is set by Outcall maintainers, not Clawie.
Per [`outcall-clawie-dependency-direction`](../../../.claude/projects/-Users-mark-Projects-Clawie/memory/outcall-clawie-dependency-direction.md):
**Outcall does not depend on Clawie. Clawie may optionally depend on
Outcall.**

## When Clawie pins Outcall ≥ v0.2

Once Outcall v0.2 ships:

1. Clawie patches `OUTCALL_MIN_VERSION` in the `OutcallEgressProvider`
   bootstrap probe (currently informational; the provider doesn't
   refuse to start on older daemons).
2. Documentation in `docs/integrations/outcall.md` updates the
   "Outcall version surveyed" line.
3. A joint release-notes paragraph goes on `clawie.dev` (when that
   lands) describing the recommended stack: Clawie v1.x + Outcall
   v0.2.x.

None of this requires a Clawie version bump. v1.0's substrate
contract is stable across Outcall version updates.

## What this phase does NOT do

- **Force-bump Outcall pin.** Clawie continues to work with Outcall
  v0.1.7+. Operators on older Outcall versions are not broken by
  Clawie v1.x patches.
- **Block Clawie v1.0 on Outcall v0.2.** Clawie v1.0 ships today.
  Outcall v0.2 ships when it ships.
- **Build joint marketing.** The two projects coordinate technically
  but message separately.

## Closing the roadmap

This is the last phase on the remapped `specs/PHASES.md`. The numbered
Clawie phases (1–10) are all shipped; the lettered Outcall integration
phases (5a, 5b, 6a, 7a, 8a, 9a, 10a) are all addressed. Future work
goes through:

- **v1.x Clawie patches** for the deferred items (Linear/Jira drivers,
  in-process ticker, webhook retries, marketplace registry, agent file
  apply-on-approve).
- **Independent Outcall releases** for v0.2 hardening and beyond.
- **Cross-cutting docs updates** as `docs/integrations/outcall.md`'s
  capability matrix evolves.

The substrate is stable. Future capability slices land as additive
phases without breaking what's already shipped.

import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import type { SpawnRequest } from '#services/container_spawner'
import type { EgressProvider, EgressProviderContext } from '#services/egress/provider'
import { unixSocketRequest } from '#services/egress/unix_socket_client'

/**
 * Phase 5b: real connector to a running Outcall daemon.
 *
 * Outcall (Outcall-dev/root) is a Linux-only host daemon that governs
 * Docker container egress at L3 (nftables) + L4 (DNS filter) + L7
 * (HTTP proxy). This provider attaches Clawie's spawned containers to
 * Outcall's managed network and lets the daemon enforce.
 *
 * The agent container itself doesn't change: it still calls provider
 * URLs directly with its own auth header. Outcall's HTTP proxy
 * intercepts via the `HTTPS_PROXY` env we inject; the agent never
 * learns it's being proxied.
 *
 * Dependency posture: Clawie depends on Outcall (optionally). Outcall
 * does NOT depend on Clawie. This adapter wraps Outcall-specific
 * details (socket path, network naming convention, container naming)
 * so the rest of Clawie remains Outcall-agnostic.
 */

export interface OutcallProviderConfig {
  /** Path to the host API socket. Default `/run/outcall/host.sock`. */
  hostSocketPath?: string
  /** Outcall network suffix (without the `outcall-` prefix). Default `clawie`. */
  networkName?: string
  /** Gateway IP — runs the DNS filter (port 53) + HTTP proxy (port 8080). Default `10.200.0.1`. */
  gateway?: string
  /** Mount the outcall-agent socket so the container can do permissions checks (Phase 7a). */
  mountAgentSocket?: boolean
}

interface BridgeStatus {
  name: string
  up: boolean
  index: number | null
  nftables_active: boolean
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

export class OutcallEgressProvider implements EgressProvider {
  readonly name = 'outcall'

  constructor(private readonly config: OutcallProviderConfig = {}) {}

  /**
   * Probe the daemon and ensure the Clawie network exists. Called once
   * on Clawie boot. Returns true on success. On failure, the caller is
   * expected to log + fall back to the null provider.
   */
  async bootstrap(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const socketPath = this.config.hostSocketPath ?? '/run/outcall/host.sock'
    const networkName = this.config.networkName ?? 'clawie'

    let bridge: BridgeStatus
    try {
      const res = await unixSocketRequest(socketPath, '/api/v1/bridge', { method: 'GET' })
      if (res.status !== 200) {
        return { ok: false, reason: `bridge status returned HTTP ${res.status}` }
      }
      const env = JSON.parse(res.body) as ApiEnvelope<BridgeStatus>
      if (!env.success || !env.data) {
        return { ok: false, reason: env.error ?? 'bridge status envelope.success=false' }
      }
      bridge = env.data
    } catch (err) {
      return {
        ok: false,
        reason: `cannot reach outcalld at ${socketPath}: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    if (!bridge.up || !bridge.nftables_active) {
      return {
        ok: false,
        reason: `outcalld bridge not ready (up=${bridge.up}, nftables=${bridge.nftables_active})`,
      }
    }

    try {
      const res = await unixSocketRequest(socketPath, '/api/v1/network/create', {
        method: 'POST',
        json: { name: networkName },
      })
      if (res.status !== 200) {
        return {
          ok: false,
          reason: `network/create returned HTTP ${res.status}: ${res.body.slice(0, 200)}`,
        }
      }
      const env = JSON.parse(res.body) as ApiEnvelope<{ network_id: string; created: boolean }>
      if (!env.success) {
        return { ok: false, reason: env.error ?? 'network/create envelope.success=false' }
      }
      logger.info(
        { network: `outcall-${networkName}`, created: env.data?.created },
        'outcall: network ready'
      )
    } catch (err) {
      return {
        ok: false,
        reason: `network/create failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    return { ok: true }
  }

  /**
   * Decorate the spawn request:
   *   - customNetworkName -> `outcall-<networkName>` so the agent joins
   *     Outcall's managed network
   *   - extraArgs gains `--dns <gateway>` and `--name clawie-<intent>-<id>`
   *     (the name lets Outcall's `agent.name` rule binding resolve)
   *   - env gains HTTP_PROXY + HTTPS_PROXY pointing at the gateway
   *
   * Provider credentials still live in the agent's env (Phase 3 model).
   * Outcall is purely a network filter -- it does NOT inject creds.
   */
  async wrap(req: SpawnRequest, ctx: EgressProviderContext): Promise<SpawnRequest> {
    const networkName = this.config.networkName ?? 'clawie'
    const gateway = this.config.gateway ?? '10.200.0.1'
    const proxyUrl = `http://${gateway}:8080`
    const containerName = `clawie-${ctx.intentName}-${randomBytes(4).toString('hex')}`

    const extraArgs = [...(req.extraArgs ?? []), '--dns', gateway, '--name', containerName]

    if (this.config.mountAgentSocket) {
      extraArgs.push('-v', '/run/outcall/agent.sock:/run/outcall/agent.sock')
    }

    return {
      ...req,
      customNetworkName: `outcall-${networkName}`,
      env: {
        ...(req.env ?? {}),
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
      },
      extraArgs,
    }
  }
}

import { unixSocketRequest } from '#services/egress/unix_socket_client'

/**
 * Read-only wrapper over Outcall's host API. Used by the dashboard
 * (Phase 6a) to surface bridge + rule + proxy state. The mutating
 * side of the integration lives in `OutcallEgressProvider`; this
 * client never POSTs.
 *
 * Wire shapes mirror `outcall-dev/outcall/application/outcall-api/
 * src/lib.rs` -- if Outcall changes its types, the typed unwrap below
 * is the canary.
 */

export interface BridgeStatus {
  name: string
  up: boolean
  index: number | null
  nftables_active: boolean
}

export interface RuleSummary {
  id: string
  file: string
  action: 'allow' | 'block' | 'enrich'
  condition_preview: string
  description: string | null
}

export interface ProxyStatus {
  running: boolean
  listen_address: string
  proxy_url: string
  active_connections: number
  total_requests: number
  total_blocked: number
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

export class OutcallApiClient {
  constructor(private readonly socketPath: string = '/run/outcall/host.sock') {}

  bridgeStatus(): Promise<BridgeStatus> {
    return this.get<BridgeStatus>('/api/v1/bridge')
  }

  rulesList(): Promise<RuleSummary[]> {
    return this.get<RuleSummary[]>('/api/v1/rules')
  }

  proxyStatus(): Promise<ProxyStatus> {
    return this.get<ProxyStatus>('/api/v1/proxy')
  }

  private async get<T>(path: string): Promise<T> {
    const res = await unixSocketRequest(this.socketPath, path, { method: 'GET', timeoutMs: 3_000 })
    if (res.status !== 200) {
      throw new Error(`outcall ${path}: HTTP ${res.status}: ${res.body.slice(0, 200)}`)
    }
    const env = JSON.parse(res.body) as ApiEnvelope<T>
    if (!env.success || env.data === undefined) {
      throw new Error(`outcall ${path}: ${env.error ?? 'envelope.success=false'}`)
    }
    return env.data
  }
}

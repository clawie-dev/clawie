import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Boot-time selection of the EgressProvider based on `CLAWIE_EGRESS`.
 * Defaults to the null provider (no egress isolation) so Clawie starts
 * cleanly without operator setup. Set `CLAWIE_EGRESS=outcall` to opt
 * into the OutcallEgressProvider, which probes the daemon at
 * `OUTCALL_HOST_SOCKET` (default `/run/outcall/host.sock`) and attaches
 * spawned containers to the managed network.
 *
 * If the outcall provider can't reach the daemon at boot, it logs a
 * warning and falls back to null. Clawie still starts; the operator's
 * monitoring is responsible for alerting on the degradation.
 */
export default class EgressProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    const { selectEgressProviderFromEnv } = await import('#services/egress/index')
    const { setEgressProviderForTest } = await import('#services/egress/provider')
    const provider = await selectEgressProviderFromEnv()
    setEgressProviderForTest(provider)
  }
}

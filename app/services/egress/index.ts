import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import {
  NullEgressProvider,
  setEgressProviderForTest,
  type EgressProvider,
} from '#services/egress/provider'
import { OutcallEgressProvider } from '#services/egress/outcall_provider'

/**
 * Boot-time provider selection. Driven by `CLAWIE_EGRESS`:
 *
 *   unset | 'null' -> NullEgressProvider (no isolation; Phase 3 model)
 *   'outcall'      -> OutcallEgressProvider (talks to outcalld)
 *
 * The outcall provider attempts a daemon probe + network bootstrap on
 * boot. If unreachable, it falls back to null with a warning so Clawie
 * still starts. The operator's monitoring -- not Clawie -- should
 * notice and alert when outcall was requested but degraded.
 *
 * Phase 5b ships this seam; future phases add more providers (e.g. a
 * 'k3s-netpol' provider for Kubernetes Network Policy deployments).
 */
export async function selectEgressProviderFromEnv(): Promise<EgressProvider> {
  const choice = (env.get('CLAWIE_EGRESS') ?? 'null').toLowerCase()

  if (choice === 'null' || choice === '') {
    return new NullEgressProvider()
  }

  if (choice !== 'outcall') {
    logger.warn(
      { CLAWIE_EGRESS: choice },
      'unknown CLAWIE_EGRESS value; falling back to null provider'
    )
    return new NullEgressProvider()
  }

  const provider = new OutcallEgressProvider({
    hostSocketPath: env.get('OUTCALL_HOST_SOCKET'),
    networkName: env.get('OUTCALL_NETWORK'),
    gateway: env.get('OUTCALL_GATEWAY'),
    mountAgentSocket: env.get('OUTCALL_MOUNT_AGENT_SOCKET') === '1',
  })

  const result = await provider.bootstrap()
  if (!result.ok) {
    logger.warn(
      { reason: result.reason },
      'CLAWIE_EGRESS=outcall but outcalld is unreachable; degrading to null provider'
    )
    return new NullEgressProvider()
  }

  logger.info('CLAWIE_EGRESS=outcall: provider active')
  return provider
}

/**
 * For tests that want to force a specific provider regardless of env.
 * Re-exported from #services/egress/provider for ergonomics.
 */
export { setEgressProviderForTest }

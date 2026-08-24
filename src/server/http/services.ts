import 'server-only'

import type { AuthSource } from '@/server/auth'

import { serviceUnavailable } from './errors'
import type { WebChessApiServices } from './ports'

let apiServicesPromise: Promise<WebChessApiServices> | null = null
let apiServicesLocalMode: boolean | null = null

async function loadApiServices(
  localMode: boolean,
): Promise<WebChessApiServices> {
  if (localMode) {
    const { getOpenClawApiServices } = await import('../openclaw/services')
    return getOpenClawApiServices()
  }
  const { createApiServices } = await import('./service-adapter')
  return createApiServices()
}

export async function getApiServices(
  principalSource: AuthSource,
): Promise<WebChessApiServices> {
  const { isOpenClawLocalModeEnabled } = await import('../openclaw/config')
  const localMode = isOpenClawLocalModeEnabled()
  if (localMode !== (principalSource === 'local-openclaw')) {
    throw serviceUnavailable(
      'The authenticated principal is not bound to this WebChess runtime.',
    )
  }

  if (
    apiServicesPromise !== null &&
    apiServicesLocalMode !== localMode
  ) {
    throw serviceUnavailable(
      'The WebChess runtime mode changed after service initialization.',
    )
  }
  if (apiServicesPromise === null) {
    apiServicesLocalMode = localMode
    apiServicesPromise = loadApiServices(localMode)
  }

  try {
    return await apiServicesPromise
  } catch (error) {
    // A missing environment variable can be fixed between local requests and a
    // transient initialization failure must not poison a warm instance forever.
    apiServicesPromise = null
    apiServicesLocalMode = null
    throw error
  }
}

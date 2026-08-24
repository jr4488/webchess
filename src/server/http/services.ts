import 'server-only'

import type { AuthSource } from '@/server/auth'

import { serviceUnavailable } from './errors'
import type {
  WebChessApiServices,
  WebChessDataControlServices,
} from './ports'

let apiServicesPromise: Promise<WebChessApiServices> | null = null
let dataControlServicesPromise: Promise<WebChessDataControlServices> | null = null

async function loadOpenClawApiServices(): Promise<WebChessApiServices> {
  const { getOpenClawApiServices } = await import('../openclaw/services')
  return getOpenClawApiServices()
}

async function loadDataControlServices(): Promise<WebChessDataControlServices> {
  const { createDataControlServices } = await import(
    './data-control-service-adapter'
  )
  return createDataControlServices()
}

/**
 * Retain only Clerk account status/export/deletion. This is intentionally a
 * separate graph from gameplay so it cannot select a provider, invoke a model,
 * conduct research, or export an individual lifecycle case.
 */
export async function getDataControlServices(
  principalSource: AuthSource,
): Promise<WebChessDataControlServices> {
  if (principalSource !== 'clerk') {
    throw serviceUnavailable(
      'Clerk account data controls require an authenticated Clerk principal.',
    )
  }

  if (dataControlServicesPromise === null) {
    dataControlServicesPromise = loadDataControlServices()
  }

  try {
    return await dataControlServicesPromise
  } catch (error) {
    dataControlServicesPromise = null
    throw error
  }
}

export async function getApiServices(
  principalSource: AuthSource,
): Promise<WebChessApiServices> {
  // WebChess 2.2 is deliberately account-authenticated through OpenClaw only.
  // Reject every other principal before loading any provider/runtime adapter so
  // a Clerk, test, or retired local-hosted session can never select a key-backed
  // service graph by accident.
  if (principalSource !== 'local-openclaw') {
    throw serviceUnavailable(
      'WebChess model and research services require the local OpenClaw account-authenticated runtime.',
    )
  }

  const { isOpenClawLocalModeEnabled } = await import('../openclaw/config')
  if (!isOpenClawLocalModeEnabled()) {
    throw serviceUnavailable(
      'The local OpenClaw account-authenticated runtime is disabled.',
    )
  }

  if (apiServicesPromise === null) {
    apiServicesPromise = loadOpenClawApiServices()
  }

  try {
    return await apiServicesPromise
  } catch (error) {
    // A missing environment variable can be fixed between local requests and a
    // transient initialization failure must not poison a warm instance forever.
    apiServicesPromise = null
    throw error
  }
}

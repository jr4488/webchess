import 'server-only'

import type { WebChessApiServices } from './ports'

let apiServicesPromise: Promise<WebChessApiServices> | null = null

async function loadApiServices(): Promise<WebChessApiServices> {
  const { createApiServices } = await import('./service-adapter')
  return createApiServices()
}

export async function getApiServices(): Promise<WebChessApiServices> {
  apiServicesPromise ??= loadApiServices()

  try {
    return await apiServicesPromise
  } catch (error) {
    // A missing environment variable can be fixed between local requests and a
    // transient initialization failure must not poison a warm instance forever.
    apiServicesPromise = null
    throw error
  }
}

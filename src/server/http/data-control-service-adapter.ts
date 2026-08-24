import 'server-only'

import { getDatabase } from '../db/sql'
import { loadUsageConfig } from '../usage/config'
import { createUsageController } from '../usage/service'
import {
  createDataControlServicesWithDependencies,
  normalizeAccountExportMaxBytes,
} from './data-control-service-core'
import type { WebChessDataControlServices } from './ports'

/**
 * Compose the retained Clerk data-control graph without a game repository,
 * research broker, provider selection, or model generator dependency.
 */
export async function createDataControlServices(): Promise<WebChessDataControlServices> {
  const database = getDatabase()
  const usageConfig = loadUsageConfig()

  return createDataControlServicesWithDependencies({
    accountExportMaxBytes: normalizeAccountExportMaxBytes(
      process.env.WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES,
    ),
    database,
    hmacSecret: usageConfig.hmacSecret,
    usage: createUsageController({
      db: database,
      config: usageConfig,
    }),
  })
}

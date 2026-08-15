import 'server-only'

import {
  createPostgresSqlAdapter,
} from '@/server/db'
import {
  assertDedicatedLocalSchema,
  loadCanonicalFilesystemMigrations,
} from '@/server/db/local-postgres'
import { runMigrations } from '@/server/db/migrations'
import { DurableGameRepository } from '@/server/games'
import {
  createApiServicesWithDependencies,
} from '@/server/http/service-adapter'
import type { WebChessApiServices } from '@/server/http/ports'
import { DurableLifecycleRepository } from '@/server/lifecycle'
import {
  DurableResearchBroker,
  DurableResearchRepository,
} from '@/server/research'
import { createUsageController, loadUsageConfig } from '@/server/usage'
import { WEBCHESS_SOFTWARE_VERSION } from '@/lib/lifecycle/versions'

import { isLoopbackHostname } from './request-guard'
import {
  generateOpenClawAnswerV2,
  generateOpenClawCharlotteV2,
  generateOpenClawDivisionV2,
  generateOpenClawPortiaV2,
} from './v2-generation'

let servicesPromise: Promise<WebChessApiServices> | null = null

function databaseUrl(): string {
  if (
    process.env.VERCEL !== undefined ||
    process.env.VERCEL_ENV !== undefined ||
    process.env.VERCEL_TARGET_ENV !== undefined ||
    process.env.VERCEL_URL !== undefined ||
    process.env.WEBCHESS_OPENCLAW_ENABLED !== 'true'
  ) {
    throw new Error('The local OpenClaw database is disabled in this environment.')
  }
  const value = process.env.WEBCHESS_OPENCLAW_DATABASE_URL?.trim()
  if (!value) {
    throw new Error(
      'WEBCHESS_OPENCLAW_DATABASE_URL must point to the dedicated local PostgreSQL database.',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('WEBCHESS_OPENCLAW_DATABASE_URL is not a valid URL.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !isLoopbackHostname(parsed.hostname)
  ) {
    throw new Error(
      'The OpenClaw database URL must use PostgreSQL on a loopback host.',
    )
  }
  return value
}

async function createServices(): Promise<WebChessApiServices> {
  const usageConfig = loadUsageConfig()
  const migrations = await loadCanonicalFilesystemMigrations()
  const database = createPostgresSqlAdapter(databaseUrl(), {
    applicationName: 'webchess-openclaw-v2',
  })
  try {
    await assertDedicatedLocalSchema(database)
    await runMigrations(database, migrations)
    const researchRepository = new DurableResearchRepository(database)
    return createApiServicesWithDependencies({
      accountExportMaxBytes: 3_000_000,
      answerGenerator: generateOpenClawAnswerV2,
      charlotteGenerator: generateOpenClawCharlotteV2,
      database,
      divisionGenerator: generateOpenClawDivisionV2,
      hmacSecret: usageConfig.hmacSecret,
      lifecycleRepository: new DurableLifecycleRepository(database),
      modelName: 'configured-default',
      modelProvider: 'openclaw',
      portiaGenerator: generateOpenClawPortiaV2,
      researchBroker: new DurableResearchBroker(researchRepository),
      repository: new DurableGameRepository(database),
      requiresModelApiKey: false,
      softwareVersion: `webchess@${WEBCHESS_SOFTWARE_VERSION}-openclaw`,
      usage: createUsageController({ db: database, config: usageConfig }),
      wilburStorageRowLimit: 500,
      wilburStorageTextBytesLimit: 250_000,
    })
  } catch (error) {
    await database.close()
    throw error
  }
}

export async function getOpenClawApiServices(): Promise<WebChessApiServices> {
  servicesPromise ??= createServices()
  try {
    return await servicesPromise
  } catch (error) {
    servicesPromise = null
    throw error
  }
}

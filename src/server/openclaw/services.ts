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
import type { SqlAdapter } from '@/server/db'
import {
  configuredCaseRuntimeArtifactSha256,
  configuredCaseSourceCommit,
} from '@/server/case-bundle'

import { isLoopbackHostname } from './request-guard'
import {
  generateOpenClawAnswerV2,
  generateOpenClawCharlotteV2,
  generateOpenClawDivisionV2,
  generateOpenClawPortiaV2,
} from './v2-generation'

export interface OpenClawDatabaseStatus {
  available: true
  engine: 'PostgreSQL'
  majorVersion: 17
  scope: 'dedicated-local'
  serverVersion: string
}

export class OpenClawDatabaseReadinessError extends Error {
  readonly detectedMajorVersion?: number
  readonly detectedServerVersion?: string
  readonly reason: 'unavailable' | 'unsupported-version'

  constructor(
    reason: 'unavailable' | 'unsupported-version',
    message: string,
    options: {
      cause?: unknown
      detectedMajorVersion?: number
      detectedServerVersion?: string
    } = {},
  ) {
    super(message)
    this.name = 'OpenClawDatabaseReadinessError'
    this.reason = reason
    if (options.cause !== undefined) this.cause = options.cause
    this.detectedMajorVersion = options.detectedMajorVersion
    this.detectedServerVersion = options.detectedServerVersion
  }
}

interface OpenClawServiceState {
  database: OpenClawDatabaseStatus
  services: WebChessApiServices
}

let servicesPromise: Promise<OpenClawServiceState> | null = null

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

async function inspectPostgres17(
  database: SqlAdapter,
): Promise<OpenClawDatabaseStatus> {
  let result
  try {
    result = await database.query({
      text: `
        SELECT
          current_setting('server_version')::text AS server_version,
          current_setting('server_version_num')::text AS server_version_num
      `,
    })
  } catch (error) {
    throw new OpenClawDatabaseReadinessError(
      'unavailable',
      'The local PostgreSQL version could not be inspected.',
      { cause: error },
    )
  }

  const row = result.rows[0]
  const serverVersion = row?.server_version
  const versionNumber = row?.server_version_num
  if (
    typeof serverVersion !== 'string' ||
    serverVersion.length < 1 ||
    serverVersion.length > 120 ||
    /[\p{C}]/gu.test(serverVersion) ||
    typeof versionNumber !== 'string' ||
    !/^\d{6}$/u.test(versionNumber)
  ) {
    throw new OpenClawDatabaseReadinessError(
      'unavailable',
      'The local PostgreSQL version response was invalid.',
    )
  }

  const majorVersion = Number(versionNumber.slice(0, 2))
  if (majorVersion !== 17) {
    throw new OpenClawDatabaseReadinessError(
      'unsupported-version',
      'The dedicated local database must run PostgreSQL 17.',
      {
        detectedMajorVersion: majorVersion,
        detectedServerVersion: serverVersion,
      },
    )
  }

  return {
    available: true,
    engine: 'PostgreSQL',
    majorVersion: 17,
    scope: 'dedicated-local',
    serverVersion,
  }
}

async function createServices(): Promise<OpenClawServiceState> {
  const usageConfig = loadUsageConfig()
  const migrations = await loadCanonicalFilesystemMigrations()
  const database = createPostgresSqlAdapter(databaseUrl(), {
    applicationName: 'webchess-openclaw-v2',
  })
  try {
    const databaseStatus = await inspectPostgres17(database)
    await assertDedicatedLocalSchema(database)
    await runMigrations(database, migrations)
    const researchRepository = new DurableResearchRepository(database)
    const services = createApiServicesWithDependencies({
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
      softwareVersion: `webchess@${WEBCHESS_SOFTWARE_VERSION}-openclaw`,
      sourceCommit: configuredCaseSourceCommit(),
      runtimeArtifactSha256: configuredCaseRuntimeArtifactSha256(),
      usage: createUsageController({ db: database, config: usageConfig }),
      wilburStorageRowLimit: 500,
      wilburStorageTextBytesLimit: 250_000,
    })
    return {
      database: databaseStatus,
      services,
    }
  } catch (error) {
    await database.close()
    throw error
  }
}

export async function getOpenClawApiServices(): Promise<WebChessApiServices> {
  servicesPromise ??= createServices()
  try {
    return (await servicesPromise).services
  } catch (error) {
    servicesPromise = null
    throw error
  }
}

export async function getOpenClawDatabaseStatus(): Promise<OpenClawDatabaseStatus> {
  servicesPromise ??= createServices()
  try {
    return (await servicesPromise).database
  } catch (error) {
    servicesPromise = null
    throw error
  }
}

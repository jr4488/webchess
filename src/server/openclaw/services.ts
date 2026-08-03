import 'server-only'

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createPostgresSqlAdapter,
} from '@/server/db'
import { runMigrations } from '@/server/db/migrations'
import type { Migration, SqlAdapter } from '@/server/db'
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

const MIGRATION_FILENAME = /^(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/u
let servicesPromise: Promise<WebChessApiServices> | null = null

function databaseUrl(): string {
  if (
    process.env.VERCEL !== undefined ||
    process.env.VERCEL_ENV !== undefined ||
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

async function loadMigrations(): Promise<readonly Migration[]> {
  const directory = join(process.cwd(), 'db', 'migrations')
  const entries = await readdir(directory, { withFileTypes: true })
  const filenames = entries.map((entry) => {
    if (!entry.isFile() || !MIGRATION_FILENAME.test(entry.name)) {
      throw new Error('The local migration directory contains an unexpected entry.')
    }
    return entry.name
  }).sort()
  if (filenames.length === 0) {
    throw new Error('The local WebChess runtime has no database migrations.')
  }
  return Promise.all(filenames.map(async (filename) => ({
    id: MIGRATION_FILENAME.exec(filename)?.[1] ?? '',
    sql: await readFile(join(directory, filename), 'utf8'),
  })))
}

async function assertDedicatedLocalSchema(database: SqlAdapter): Promise<void> {
  const inspection = await database.query({
    text: `
      SELECT
        to_regclass('webchess_schema_migrations')::text AS migration_ledger,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          INNER JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = current_schema()
            AND relation.relname IN (
              'deleted_user_tombstones',
              'user_controls',
              'games',
              'game_events',
              'model_requests',
              'game_start_requests',
              'usage_buckets',
              'rate_buckets',
              'model_concurrency_slots',
              'lifecycle_runs',
              'portia_reviews',
              'gate_decisions',
              'charlotte_results',
              'wilbur_actions',
              'wilbur_observations',
              'lifecycle_events',
              'research_requests',
              'research_sources'
            )
        ) AS has_webchess_objects
    `,
  })
  const row = inspection.rows[0]
  if (
    !row ||
    !(
      row.migration_ledger === null ||
      typeof row.migration_ledger === 'string'
    ) ||
    typeof row.has_webchess_objects !== 'boolean'
  ) {
    throw new Error('The dedicated local database could not be inspected safely.')
  }
  if (row.migration_ledger === null && row.has_webchess_objects) {
    throw new Error(
      'The dedicated local database has WebChess objects without a migration ledger; automatic adoption is forbidden.',
    )
  }
}

async function createServices(): Promise<WebChessApiServices> {
  const usageConfig = loadUsageConfig()
  const migrations = await loadMigrations()
  const database = createPostgresSqlAdapter(databaseUrl())
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

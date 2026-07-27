import { pathToFileURL } from 'node:url'

import { Client } from 'pg'

import {
  DeploymentMigrationError,
  applyCanonicalMigrations,
  loadCanonicalMigrations,
} from './deployment-database.mjs'
import {
  ReleaseSourceError,
  verifyReleaseSource,
} from './deployment-source-check.mjs'

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function migrationOwnerDatabaseUrl(environment = process.env) {
  const connectionString = environment.MIGRATION_DATABASE_URL
  if (!nonBlank(connectionString)) {
    throw new Error(
      'MIGRATION_DATABASE_URL is required for the migration-owner command.',
    )
  }
  if (connectionString !== connectionString.trim()) {
    throw new Error(
      'MIGRATION_DATABASE_URL must not contain surrounding whitespace.',
    )
  }
  return connectionString
}

async function connectMigrationOwner(connectionString) {
  const client = new Client({
    application_name: 'webchess-migration-owner',
    connectionString,
  })
  await client.connect()
  return client
}

export async function runMigrationOwner({
  environment = process.env,
  connect = connectMigrationOwner,
  loadMigrations = loadCanonicalMigrations,
  logger = console,
  verifySource = verifyReleaseSource,
} = {}) {
  const sourceBeforeLoad = await verifySource()
  const migrations = await loadMigrations()
  const sourceAfterLoad = await verifySource()
  if (
    sourceBeforeLoad.branch !== sourceAfterLoad.branch ||
    sourceBeforeLoad.commit !== sourceAfterLoad.commit
  ) {
    throw new ReleaseSourceError(
      'Release source changed while canonical migrations were loaded.',
    )
  }

  const connectionString = migrationOwnerDatabaseUrl(environment)
  const client = await connect(connectionString)

  try {
    const result = await applyCanonicalMigrations(client, migrations)
    logger.log(
      `Database migrations complete: ${result.applied.length} applied, ${result.alreadyApplied.length} already present.`,
    )
    return result
  } finally {
    await client.end()
  }
}

export function migrationFailureMessage(error) {
  if (error instanceof ReleaseSourceError) {
    return error.message
  }
  if (error instanceof DeploymentMigrationError) {
    return `WebChess database migration failed: ${error.message}`
  }
  if (
    error instanceof Error &&
    (
      error.message.startsWith('MIGRATION_DATABASE_URL is required') ||
      error.message.startsWith(
        'MIGRATION_DATABASE_URL must not contain',
      )
    )
  ) {
    return error.message
  }
  return 'WebChess database migration failed. Review the protected database logs without sharing credentials.'
}

async function run() {
  try {
    await runMigrationOwner()
  } catch (error) {
    console.error(migrationFailureMessage(error))
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await run()
}

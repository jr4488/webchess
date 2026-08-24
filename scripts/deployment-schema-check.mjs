import { pathToFileURL } from 'node:url'

import {
  DeploymentMigrationError,
  checkCanonicalMigrationsReadOnly,
  loadCanonicalMigrations,
} from './deployment-database.mjs'
import {
  DeploymentDatabaseConfigurationError,
  hasEffectiveVercelMarker,
  reviewedDatabaseClientConfig,
} from './deployment-preflight.mjs'

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function requiredRuntimeDatabaseUrl(environment) {
  const connectionString = environment.DATABASE_URL
  if (!nonBlank(connectionString)) {
    throw new Error(
      'DATABASE_URL is required for the Vercel schema compatibility check.',
    )
  }
  if (connectionString !== connectionString.trim()) {
    throw new Error(
      'DATABASE_URL must not contain surrounding whitespace.',
    )
  }
  return connectionString
}

export function runtimeDatabaseClientConfig(environment = process.env) {
  return reviewedDatabaseClientConfig(
    requiredRuntimeDatabaseUrl(environment),
    {
      allowLoopbackPlaintext: !hasEffectiveVercelMarker(environment),
      applicationName: 'webchess-schema-check',
      environment,
      variableName: 'DATABASE_URL',
    },
  )
}

export function runtimeDatabaseUrl(environment = process.env) {
  const connectionString = requiredRuntimeDatabaseUrl(environment)
  reviewedDatabaseClientConfig(connectionString, {
    allowLoopbackPlaintext: !hasEffectiveVercelMarker(environment),
    applicationName: 'webchess-schema-check',
    environment,
    variableName: 'DATABASE_URL',
  })
  return connectionString
}

export function schemaCheckMode(arguments_ = []) {
  if (arguments_.length === 0) {
    return 'always'
  }
  if (
    arguments_.length === 1 &&
    arguments_[0] === '--vercel-only'
  ) {
    return 'vercel-only'
  }
  throw new Error(
    'The schema compatibility command accepts only --vercel-only.',
  )
}

async function connectRuntimeDatabase(config) {
  const { Client } = await import('pg')
  const client = new Client(config)
  await client.connect()
  return client
}

export async function runSchemaCompatibilityCheck({
  environment = process.env,
  mode = 'always',
  connect = connectRuntimeDatabase,
  loadMigrations = loadCanonicalMigrations,
  logger = console,
} = {}) {
  if (mode !== 'always' && mode !== 'vercel-only') {
    throw new Error('The schema compatibility mode is invalid.')
  }
  if (
    mode === 'vercel-only' &&
    !hasEffectiveVercelMarker(environment)
  ) {
    return { checked: false }
  }

  const clientConfig = runtimeDatabaseClientConfig(environment)
  const migrations = await loadMigrations()
  const client = await connect(clientConfig)

  try {
    await checkCanonicalMigrationsReadOnly(client, migrations)
    logger.log('Vercel database schema compatibility check passed.')
    return { checked: true }
  } finally {
    await client.end()
  }
}

export function schemaCheckFailureMessage(error) {
  if (error instanceof DeploymentMigrationError) {
    return `Vercel database schema compatibility check failed: ${error.message}`
  }
  if (error instanceof DeploymentDatabaseConfigurationError) {
    return error.message
  }
  if (
    error instanceof Error &&
    (
      error.message.startsWith(
        'DATABASE_URL is required for the Vercel schema',
      ) ||
      error.message.startsWith(
        'DATABASE_URL must not contain surrounding',
      )
    )
  ) {
    return error.message
  }
  return 'Vercel database schema compatibility check failed. No database connection details were logged.'
}

async function run() {
  try {
    await runSchemaCompatibilityCheck({
      mode: schemaCheckMode(process.argv.slice(2)),
    })
  } catch (error) {
    console.error(schemaCheckFailureMessage(error))
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await run()
}

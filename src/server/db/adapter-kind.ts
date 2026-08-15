import 'server-only'

type DatabaseEnvironment = Readonly<Record<string, string | undefined>>

export type DatabaseAdapterKind = 'postgres-wire' | 'neon-http'

const LOCAL_HOSTED_AUTH_FLAG = 'WEBCHESS_LOCAL_HOSTED_AUTH'
const LOCAL_SESSION_SECRET_NAME = 'WEBCHESS_LOCAL_SESSION_SECRET'
const MINIMUM_LOCAL_SECRET_BYTES = 32

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/gu, '')
}

export function isVercelRuntime(
  environment: DatabaseEnvironment = process.env,
): boolean {
  return (
    environment.VERCEL !== undefined ||
    environment.VERCEL_ENV !== undefined ||
    environment.VERCEL_TARGET_ENV !== undefined ||
    environment.VERCEL_URL !== undefined
  )
}

export function isLoopbackHostname(value: string): boolean {
  const hostname = normalizedHostname(value)
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

export function parseLoopbackPostgresUrl(
  value: string,
  variableName: string,
): URL {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed !== value) {
    throw new Error(`${variableName} must be a PostgreSQL URL on a loopback host.`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${variableName} is not a valid URL.`)
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !isLoopbackHostname(parsed.hostname)
  ) {
    throw new Error(
      `${variableName} must use PostgreSQL on a loopback host.`,
    )
  }

  return parsed
}

function nonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isExactLoopbackOrigin(value: string | undefined): boolean {
  if (!nonBlank(value) || value !== value.trim()) return false

  try {
    const origin = new URL(value)
    return (
      ['http:', 'https:'].includes(origin.protocol) &&
      isLoopbackHostname(origin.hostname) &&
      origin.username === '' &&
      origin.password === '' &&
      origin.pathname === '/' &&
      origin.search === '' &&
      origin.hash === ''
    )
  } catch {
    return false
  }
}

/**
 * Authorizes the local launcher's one automatic schema-migration boundary.
 *
 * The wire-protocol choice alone is deliberately insufficient: a developer
 * may have an unrelated loopback DATABASE_URL in their shell. The launcher
 * supplies the activation flag, an exact loopback site origin, a dedicated
 * session secret, and either no Clerk keys or paired Clerk development keys.
 */
export function isLocalHostedPostgresMigrationAuthorized(
  connectionString: string | undefined,
  environment: DatabaseEnvironment = process.env,
): boolean {
  if (
    environment[LOCAL_HOSTED_AUTH_FLAG] !== 'true' ||
    isVercelRuntime(environment) ||
    environment.WEBCHESS_OPENCLAW_ENABLED === 'true' ||
    !nonBlank(connectionString) ||
    !isExactLoopbackOrigin(environment.NEXT_PUBLIC_SITE_URL)
  ) {
    return false
  }

  try {
    parseLoopbackPostgresUrl(connectionString, 'DATABASE_URL')
  } catch {
    return false
  }

  const sessionSecret = environment[LOCAL_SESSION_SECRET_NAME]
  if (
    !nonBlank(sessionSecret) ||
    Buffer.byteLength(sessionSecret, 'utf8') < MINIMUM_LOCAL_SECRET_BYTES
  ) {
    return false
  }

  const publishableKey = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const secretKey = environment.CLERK_SECRET_KEY
  const hasPublishableKey = nonBlank(publishableKey)
  const hasSecretKey = nonBlank(secretKey)
  if (!hasPublishableKey && !hasSecretKey) return true
  if (!hasPublishableKey || !hasSecretKey) return false

  return (
    publishableKey.startsWith('pk_test_') &&
    secretKey.startsWith('sk_test_')
  )
}

/**
 * A loopback PostgreSQL URL needs the wire protocol even when the caller is
 * not authorized to initialize it. Authorization is checked separately so a
 * bare loopback URL fails closed before any schema query. Vercel and OpenClaw
 * keep their own adapters: Neon HTTP and the dedicated OpenClaw pool.
 */
export function shouldUseLocalPostgresWireProtocol(
  connectionString: string | undefined,
  environment: DatabaseEnvironment = process.env,
): boolean {
  if (
    isVercelRuntime(environment) ||
    environment.WEBCHESS_OPENCLAW_ENABLED === 'true' ||
    connectionString === undefined ||
    connectionString.trim().length === 0
  ) {
    return false
  }

  try {
    parseLoopbackPostgresUrl(connectionString, 'DATABASE_URL')
    return true
  } catch {
    return false
  }
}

export function resolveDatabaseAdapterKind(
  connectionString: string | undefined,
  environment: DatabaseEnvironment = process.env,
): DatabaseAdapterKind {
  return shouldUseLocalPostgresWireProtocol(connectionString, environment)
    ? 'postgres-wire'
    : 'neon-http'
}

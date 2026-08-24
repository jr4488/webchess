import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'

const PRODUCTION_SITE_ORIGIN = 'https://webchess.anansiportia.com'

const REQUIRED_VALUES = [
  'DATABASE_URL',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'WEBCHESS_HMAC_SECRET',
  'WEBCHESS_DELETION_HMAC_SECRET',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
]

const EXACT_PROVIDER_CREDENTIAL_NAMES = new Set([
  'ANTHROPIC_ADMIN_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_CONFIG_FILE',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_PROFILE',
  'AWS_SECURITY_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_SESSION_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AZURE_CLIENT_SECRET',
  'AZURE_SPEECH_KEY',
  'CODEX_TOKEN',
  'COPILOT_GITHUB_TOKEN',
  'FAL_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'HF_TOKEN',
  'HUGGINGFACE_HUB_TOKEN',
  'MINIMAX_CODE_PLAN_KEY',
  'OPENAI_ADMIN_KEY',
  'OPENAI_TOKEN',
  'OPENAI_WEBHOOK_SECRET',
  'RUNWAYML_API_SECRET',
  'SPEECH_KEY',
  'VOLCENGINE_TTS_TOKEN',
])

const PROVIDER_CREDENTIAL_PATTERNS = [
  /(?:^|_)(?:API_(?:KEY|TOKEN)|ACCESS_TOKEN|AUTH_TOKEN|OAUTH_TOKEN)$/u,
  /(?:^|_)API_KEYS$/u,
  /(?:^|_)API_KEY_.*$/u,
  /^OPENCLAW_LIVE_.+_KEYS?$/u,
]

const EXACT_UNSAFE_PROVIDER_TRANSPORT_NAMES = new Set([
  'ALL_PROXY',
  'BUN_OPTIONS',
  'CODEX_CA_CERTIFICATE',
  'DYLD_INSERT_LIBRARIES',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LD_PRELOAD',
  'NODE_EXTRA_CA_CERTS',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_OPTIONS',
  'NODE_PATH',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'OPENAI_CUSTOM_HEADERS',
  'OPENAI_LOG',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'OPENCLAW_BUILD_PRIVATE_QA',
  'OPENCLAW_DEBUG_PROXY_BLOB_DIR',
  'OPENCLAW_DEBUG_PROXY_DB_PATH',
  'OPENCLAW_DEBUG_PROXY_ENABLED',
  'OPENCLAW_DEBUG_PROXY_REQUIRE',
  'OPENCLAW_DEBUG_PROXY_URL',
  'OPENCLAW_NODE_EXTRA_CA_CERTS_READY',
  'OPENCLAW_QA_FORCE_RUNTIME',
  'OPENSSL_CONF',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SSLKEYLOGFILE',
])

const LOOPBACK_DATABASE_HOSTS = new Set([
  '127.0.0.1',
  '::1',
])

const POSTGRES_TRANSPORT_ENVIRONMENT_NAMES = new Set([
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NODE_PG_FORCE_NATIVE',
  'NODE_USE_SYSTEM_CA',
  'OPENSSL_CONF',
  'PGAPPNAME',
  'PGBINARY',
  'PGCLIENT_ENCODING',
  'PGCLIENTENCODING',
  'PGCONNECT_TIMEOUT',
  'PGDATABASE',
  'PGHOST',
  'PGHOSTADDR',
  'PGOPTIONS',
  'PGPASSFILE',
  'PGPASSWORD',
  'PGPORT',
  'PGREQUIRESSL',
  'PGREPLICATION',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSSLMODE',
  'PGSSLNEGOTIATION',
  'PGSYSCONFDIR',
  'PGTARGETSESSIONATTRS',
  'PGUSER',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
])

const EXPECTED_VERCEL_PROJECT_ID_VARIABLE =
  'WEBCHESS_EXPECTED_VERCEL_PROJECT_ID'

const REQUIRED_CLERK_ROUTES = {
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/account',
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/account',
}

const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/i

const nonBlank = (value) =>
  typeof value === 'string' && value.trim().length > 0

const hasRawEnvironmentValue = (value) =>
  typeof value === 'string' && value.length > 0

function containsAsciiControl(value, { includeSpace = false } = {}) {
  const upperBound = includeSpace ? 0x20 : 0x1f
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= upperBound || codePoint === 0x7f
  })
}

export class DeploymentDatabaseConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DeploymentDatabaseConfigurationError'
  }
}

function databaseConfigurationError(message) {
  return new DeploymentDatabaseConfigurationError(message)
}

function providerCredentialEnvironmentNames(environment) {
  return [...new Set(Object.entries(environment)
    .filter(([, value]) => hasRawEnvironmentValue(value))
    .map(([rawName]) => rawName.trim().toUpperCase())
    .filter((name) =>
      PROVIDER_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name)) ||
      EXACT_PROVIDER_CREDENTIAL_NAMES.has(name),
    ))]
    .sort()
}

function unsafeProviderTransportEnvironmentNames(environment) {
  return [...new Set(Object.entries(environment)
    .filter(([, value]) => hasRawEnvironmentValue(value))
    .filter(([rawName, rawValue]) => {
      const name = rawName.trim().toUpperCase()
      return EXACT_UNSAFE_PROVIDER_TRANSPORT_NAMES.has(name) ||
        (
          name === 'NODE_TLS_REJECT_UNAUTHORIZED' &&
          rawValue.trim() === '0'
        )
    })
    .map(([rawName]) => rawName.trim().toUpperCase()))]
    .sort()
}

function postgresTransportEnvironmentNames(environment) {
  return [...new Set(Object.entries(environment)
    .filter(([rawName, value]) => {
      if (!hasRawEnvironmentValue(value)) return false
      const name = rawName.trim().toUpperCase()
      return POSTGRES_TRANSPORT_ENVIRONMENT_NAMES.has(name) ||
        name.startsWith('PGSSL') ||
        (
          name === 'NODE_TLS_REJECT_UNAUTHORIZED' &&
          value.trim() === '0'
        )
    })
    .map(([rawName]) => rawName.trim().toUpperCase()))]
    .sort()
}

function assertNoPostgresTransportEnvironment(environment, variableName) {
  const names = postgresTransportEnvironmentNames(environment)
  if (names.length > 0) {
    throw databaseConfigurationError(
      `${names.join(', ')} must not be configured; ${variableName} is the only approved PostgreSQL connection source.`,
    )
  }
}

function controlledDatabaseUrl(connectionString, variableName) {
  if (!nonBlank(connectionString)) {
    throw databaseConfigurationError(`${variableName} is required.`)
  }
  if (
    connectionString !== connectionString.trim() ||
    containsAsciiControl(connectionString, { includeSpace: true })
  ) {
    throw databaseConfigurationError(
      `${variableName} must be an exact PostgreSQL URL without whitespace.`,
    )
  }

  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw databaseConfigurationError(
      `${variableName} must be a valid PostgreSQL URL.`,
    )
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.hash
  ) {
    throw databaseConfigurationError(
      `${variableName} must be a valid PostgreSQL URL.`,
    )
  }

  let user
  let password
  let database
  try {
    user = decodeURIComponent(parsed.username)
    password = decodeURIComponent(parsed.password)
    database = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    throw databaseConfigurationError(
      `${variableName} contains invalid percent-encoded connection fields.`,
    )
  }
  if (
    !parsed.hostname ||
    !user ||
    !password ||
    !database
  ) {
    throw databaseConfigurationError(
      `${variableName} must include explicit host, database, username, and password components.`,
    )
  }
  if ([user, password, database].some((value) =>
    containsAsciiControl(value),
  )) {
    throw databaseConfigurationError(
      `${variableName} contains invalid control characters in connection fields.`,
    )
  }

  const port = parsed.port ? Number(parsed.port) : 5432
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw databaseConfigurationError(
      `${variableName} contains an invalid PostgreSQL port.`,
    )
  }

  const query = [...parsed.searchParams.entries()]
  const queryNames = query.map(([name]) => name.toLowerCase())
  if (
    queryNames.some((name) =>
      [
        'database',
        'dbname',
        'host',
        'password',
        'port',
        'user',
      ].includes(name),
    )
  ) {
    throw databaseConfigurationError(
      `${variableName} must not override authority, credentials, or database through query parameters.`,
    )
  }
  if (queryNames.includes('uselibpqcompat')) {
    throw databaseConfigurationError(
      `${variableName} must not enable alternate libpq TLS semantics.`,
    )
  }
  if (
    query.length > 1 ||
    (query.length === 1 && query[0][0] !== 'sslmode')
  ) {
    throw databaseConfigurationError(
      `${variableName} contains unsupported PostgreSQL query parameters.`,
    )
  }

  const sslMode = query.length === 1 ? query[0][1] : null
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  const loopback = LOOPBACK_DATABASE_HOSTS.has(hostname)
  const verifyTls = !loopback || sslMode === 'verify-full'
  if (verifyTls && isIP(hostname) !== 0) {
    throw databaseConfigurationError(
      `${variableName} must use a DNS hostname for verified TLS.`,
    )
  }
  if (sslMode === 'disable' && !loopback) {
    throw databaseConfigurationError(
      `${variableName} contains an unapproved sslmode; non-loopback databases require verified TLS.`,
    )
  }
  if (
    sslMode !== null &&
    sslMode !== 'verify-full' &&
    !(loopback && sslMode === 'disable')
  ) {
    throw databaseConfigurationError(
      `${variableName} contains an unapproved sslmode; non-loopback databases require verified TLS.`,
    )
  }

  return {
    database,
    host: hostname,
    loopback,
    password,
    port,
    user,
    verifyTls,
  }
}

export function reviewedDatabaseClientConfig(
  connectionString,
  {
    applicationName,
    allowLoopbackPlaintext = false,
    environment = process.env,
    variableName = 'DATABASE_URL',
  } = {},
) {
  if (!nonBlank(applicationName)) {
    throw databaseConfigurationError(
      'A reviewed PostgreSQL application name is required.',
    )
  }
  assertNoPostgresTransportEnvironment(environment, variableName)
  if (environment !== process.env) {
    assertNoPostgresTransportEnvironment(process.env, variableName)
  }
  const reviewed = controlledDatabaseUrl(connectionString, variableName)
  if (
    !allowLoopbackPlaintext &&
    reviewed.loopback &&
    !reviewed.verifyTls
  ) {
    throw databaseConfigurationError(
      `${variableName} must use verified TLS in a hosted deployment.`,
    )
  }
  const config = {
    application_name: applicationName,
    database: reviewed.database,
    host: reviewed.host,
    port: reviewed.port,
    ssl: reviewed.verifyTls
      ? { rejectUnauthorized: true }
      : false,
    sslnegotiation: 'postgres',
    user: reviewed.user,
  }
  Object.defineProperty(config, 'password', {
    configurable: false,
    enumerable: false,
    value: reviewed.password,
    writable: false,
  })
  return config
}

export function assertSafeDatabaseTlsMode(
  connectionString,
  variableName = 'DATABASE_URL',
  environment = {},
  options = {},
) {
  if (!nonBlank(connectionString)) return
  reviewedDatabaseClientConfig(connectionString, {
    applicationName: 'webchess-deployment-preflight',
    allowLoopbackPlaintext:
      options.allowLoopbackPlaintext ?? false,
    environment,
    variableName,
  })
}

export const hasVercelMarker = (environment) =>
  [
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_TARGET_ENV',
    'VERCEL_URL',
    'VERCEL_PROJECT_ID',
  ].some((variableName) => environment[variableName] !== undefined)

export const hasEffectiveVercelMarker = (environment) =>
  hasVercelMarker(environment) ||
  (
    environment !== process.env &&
    hasVercelMarker(process.env)
  )

function deploymentTarget(environment) {
  const standardTarget = environment.VERCEL_ENV?.trim()
  const explicitTarget = environment.VERCEL_TARGET_ENV?.trim()
  if (
    nonBlank(standardTarget) &&
    nonBlank(explicitTarget) &&
    standardTarget !== explicitTarget
  ) {
    throw new Error(
      'VERCEL_ENV and VERCEL_TARGET_ENV must identify the same target',
    )
  }

  const target = nonBlank(standardTarget)
    ? standardTarget
    : explicitTarget
  if (!nonBlank(target)) {
    throw new Error('VERCEL_ENV or VERCEL_TARGET_ENV is required')
  }
  if (target !== 'preview' && target !== 'production') {
    throw new Error(
      'The Vercel deployment target must be preview or production',
    )
  }
  return target
}

function exactHttpsOrigin(value, variableName) {
  if (!nonBlank(value)) {
    throw new Error(`${variableName} is required`)
  }

  try {
    const candidate = new URL(value.trim())
    if (
      candidate.protocol !== 'https:' ||
      candidate.username !== '' ||
      candidate.password !== '' ||
      candidate.origin !== value.trim()
    ) {
      throw new Error('not an exact HTTPS origin')
    }
    return candidate.origin
  } catch {
    throw new Error(`${variableName} must be an exact HTTPS origin`)
  }
}

function previewOrigin(environment) {
  if (nonBlank(environment.NEXT_PUBLIC_SITE_URL)) {
    return exactHttpsOrigin(
      environment.NEXT_PUBLIC_SITE_URL,
      'NEXT_PUBLIC_SITE_URL',
    )
  }

  if (!nonBlank(environment.VERCEL_URL)) {
    throw new Error(
      'Preview requires NEXT_PUBLIC_SITE_URL or VERCEL_URL',
    )
  }

  const deploymentHost = environment.VERCEL_URL.trim()
  if (
    deploymentHost.includes('/') ||
    deploymentHost.includes('@') ||
    deploymentHost.includes('?') ||
    deploymentHost.includes('#')
  ) {
    throw new Error('VERCEL_URL must contain only a deployment hostname')
  }

  return exactHttpsOrigin(`https://${deploymentHost}`, 'VERCEL_URL')
}

function deploymentSiteOrigin(environment, target) {
  if (target === 'production') {
    const origin = exactHttpsOrigin(
      environment.NEXT_PUBLIC_SITE_URL,
      'NEXT_PUBLIC_SITE_URL',
    )
    if (origin !== PRODUCTION_SITE_ORIGIN) {
      throw new Error(
        `Production NEXT_PUBLIC_SITE_URL must be ${PRODUCTION_SITE_ORIGIN}`,
      )
    }
    return origin
  }

  return previewOrigin(environment)
}

function validateCredentialPrefix(
  errors,
  environment,
  variableName,
  expectedPrefix,
  target,
) {
  const value = environment[variableName]
  if (
    nonBlank(value) &&
    (
      value !== value.trim() ||
      !value.startsWith(expectedPrefix)
    )
  ) {
    errors.push(
      `${variableName} must use a ${expectedPrefix} credential for ${target}`,
    )
  }
}

export function validateDeploymentEnvironment(environment = process.env) {
  if (!hasVercelMarker(environment)) {
    return { target: 'local', siteOrigin: null }
  }

  const errors = []
  if (nonBlank(environment.MIGRATION_DATABASE_URL)) {
    errors.push(
      'MIGRATION_DATABASE_URL must not be configured in a Vercel deployment',
    )
  }
  for (const variableName of providerCredentialEnvironmentNames(environment)) {
    errors.push(
      `${variableName} must not be configured; WebChess accepts only OpenAI account OAuth through OpenClaw`,
    )
  }
  for (
    const variableName of
      unsafeProviderTransportEnvironmentNames(environment)
  ) {
    errors.push(
      `${variableName} must not be configured; custom provider endpoints, proxies, TLS bypasses, and custom CA settings are forbidden`,
    )
  }
  for (const variableName of REQUIRED_VALUES) {
    if (!nonBlank(environment[variableName])) {
      errors.push(`${variableName} is required`)
    }
  }
  try {
    assertSafeDatabaseTlsMode(
      environment.DATABASE_URL,
      'DATABASE_URL',
      environment,
      { allowLoopbackPlaintext: false },
    )
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : 'DATABASE_URL uses an unsafe TLS mode',
    )
  }

  let target = null
  try {
    target = deploymentTarget(environment)
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : 'The Vercel deployment target is invalid',
    )
  }

  if (target) {
    validateCredentialPrefix(
      errors,
      environment,
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      target === 'production' ? 'pk_live_' : 'pk_test_',
      target,
    )
    validateCredentialPrefix(
      errors,
      environment,
      'CLERK_SECRET_KEY',
      target === 'production' ? 'sk_live_' : 'sk_test_',
      target,
    )
    validateCredentialPrefix(
      errors,
      environment,
      'CLERK_WEBHOOK_SIGNING_SECRET',
      'whsec_',
      target,
    )
  }

  const vercelProjectId = environment.VERCEL_PROJECT_ID
  const expectedVercelProjectId =
    environment[EXPECTED_VERCEL_PROJECT_ID_VARIABLE]
  if (!nonBlank(vercelProjectId)) {
    errors.push('VERCEL_PROJECT_ID is required')
  }
  if (!nonBlank(expectedVercelProjectId)) {
    errors.push(
      `${EXPECTED_VERCEL_PROJECT_ID_VARIABLE} is required`,
    )
  }
  if (
    nonBlank(vercelProjectId) &&
    nonBlank(expectedVercelProjectId) &&
    (
      vercelProjectId !== vercelProjectId.trim() ||
      expectedVercelProjectId !== expectedVercelProjectId.trim() ||
      vercelProjectId !== expectedVercelProjectId
    )
  ) {
    errors.push(
      `VERCEL_PROJECT_ID must exactly match ${EXPECTED_VERCEL_PROJECT_ID_VARIABLE}`,
    )
  }

  for (const [variableName, expectedValue] of Object.entries(
    REQUIRED_CLERK_ROUTES,
  )) {
    if (environment[variableName]?.trim() !== expectedValue) {
      errors.push(`${variableName} must be ${expectedValue}`)
    }
  }

  const normalHmac = environment.WEBCHESS_HMAC_SECRET
  const deletionHmac = environment.WEBCHESS_DELETION_HMAC_SECRET
  if (nonBlank(normalHmac) && Buffer.byteLength(normalHmac, 'utf8') < 32) {
    errors.push('WEBCHESS_HMAC_SECRET must be at least 32 bytes')
  }
  if (nonBlank(deletionHmac) && Buffer.byteLength(deletionHmac, 'utf8') < 32) {
    errors.push(
      'WEBCHESS_DELETION_HMAC_SECRET must be at least 32 bytes',
    )
  }
  if (
    nonBlank(normalHmac) &&
    nonBlank(deletionHmac) &&
    normalHmac === deletionHmac
  ) {
    errors.push('The two WebChess HMAC secrets must be independent')
  }

  const explicitReleaseSha = environment.WEBCHESS_RELEASE_SHA?.trim()
  const vercelReleaseSha = environment.VERCEL_GIT_COMMIT_SHA?.trim()
  const suppliedReleaseShas = [
    explicitReleaseSha,
    vercelReleaseSha,
  ].filter(nonBlank)
  if (
    suppliedReleaseShas.length === 0 ||
    suppliedReleaseShas.some(
      (releaseSha) => !GIT_COMMIT_PATTERN.test(releaseSha),
    )
  ) {
    errors.push(
      'WEBCHESS_RELEASE_SHA or VERCEL_GIT_COMMIT_SHA must identify the exact 40-character release commit',
    )
  }
  if (
    nonBlank(explicitReleaseSha) &&
    nonBlank(vercelReleaseSha) &&
    explicitReleaseSha !== vercelReleaseSha
  ) {
    errors.push(
      'WEBCHESS_RELEASE_SHA must match VERCEL_GIT_COMMIT_SHA when both are configured',
    )
  }

  let siteOrigin = null
  if (target) {
    try {
      siteOrigin = deploymentSiteOrigin(environment, target)
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : 'The deployment site origin is invalid',
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Vercel deployment preflight failed:\n${errors
        .map((error) => `- ${error}`)
        .join('\n')}`,
    )
  }

  return {
    target,
    siteOrigin,
  }
}

function run() {
  try {
    const result = validateDeploymentEnvironment()
    if (result.target !== 'local') {
      console.log(
        `Vercel deployment preflight passed for ${result.target} at ${result.siteOrigin}.`,
      )
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Vercel deployment preflight failed.',
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run()
}

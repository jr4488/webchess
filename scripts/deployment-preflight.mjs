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
  'DYLD_INSERT_LIBRARIES',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LD_PRELOAD',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
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
  'localhost',
  '127.0.0.1',
  '::1',
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

function providerCredentialEnvironmentNames(environment) {
  return [...new Set(Object.entries(environment)
    .filter(([, value]) => nonBlank(value))
    .map(([rawName]) => rawName.trim().toUpperCase())
    .filter((name) =>
      PROVIDER_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name)) ||
      EXACT_PROVIDER_CREDENTIAL_NAMES.has(name),
    ))]
    .sort()
}

function unsafeProviderTransportEnvironmentNames(environment) {
  return [...new Set(Object.entries(environment)
    .filter(([, value]) => nonBlank(value))
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

export function assertSafeDatabaseTlsMode(
  connectionString,
  variableName = 'DATABASE_URL',
) {
  if (!nonBlank(connectionString)) return

  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    return
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return

  const disablesTls = [...parsed.searchParams.entries()].some(
    ([rawName, rawValue]) =>
      rawName.toLowerCase() === 'sslmode' &&
      rawValue.trim().toLowerCase() === 'disable',
  )
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (disablesTls && !LOOPBACK_DATABASE_HOSTS.has(hostname)) {
    throw new Error(
      `${variableName} must not set sslmode=disable for a non-loopback database.`,
    )
  }
}

export const hasVercelMarker = (environment) =>
  [
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_TARGET_ENV',
    'VERCEL_URL',
    'VERCEL_PROJECT_ID',
  ].some((variableName) => environment[variableName] !== undefined)

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
    assertSafeDatabaseTlsMode(environment.DATABASE_URL)
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

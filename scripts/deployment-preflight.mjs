import { pathToFileURL } from 'node:url'

const PRODUCTION_SITE_ORIGIN = 'https://webchess.anansiportia.com'

const REQUIRED_VALUES = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'WEBCHESS_HMAC_SECRET',
  'WEBCHESS_DELETION_HMAC_SECRET',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
]

const EXPECTED_VERCEL_PROJECT_ID_VARIABLE =
  'WEBCHESS_EXPECTED_VERCEL_PROJECT_ID'

const REQUIRED_CLERK_ROUTES = {
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/play',
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/play',
}

const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/i

const nonBlank = (value) =>
  typeof value === 'string' && value.trim().length > 0

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
  for (const variableName of REQUIRED_VALUES) {
    if (!nonBlank(environment[variableName])) {
      errors.push(`${variableName} is required`)
    }
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

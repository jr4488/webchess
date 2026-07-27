import 'server-only'

export const PRODUCTION_SITE_ORIGIN =
  'https://webchess.anansiportia.com'
export const LOCAL_SITE_ORIGIN = 'http://localhost:3000'

type SiteOriginEnvironment = Readonly<
  Record<string, string | undefined>
>

const nonBlank = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

function exactOrigin(
  value: string,
  requireHttps: boolean,
  variableName: string,
): string {
  try {
    const candidate = new URL(value.trim())
    if (
      (requireHttps && candidate.protocol !== 'https:') ||
      (!requireHttps &&
        candidate.protocol !== 'https:' &&
        candidate.protocol !== 'http:') ||
      candidate.username !== '' ||
      candidate.password !== '' ||
      candidate.origin !== value.trim()
    ) {
      throw new Error('not an exact origin')
    }
    return candidate.origin
  } catch {
    throw new Error(
      `${variableName} must be an exact ${
        requireHttps ? 'HTTPS' : 'HTTP(S)'
      } origin`,
    )
  }
}

function derivedVercelOrigin(vercelUrl: string | undefined): string {
  if (!nonBlank(vercelUrl)) {
    throw new Error(
      'A Vercel deployment requires NEXT_PUBLIC_SITE_URL or VERCEL_URL',
    )
  }

  const deploymentHost = vercelUrl.trim()
  if (
    deploymentHost.includes('/') ||
    deploymentHost.includes('@') ||
    deploymentHost.includes('?') ||
    deploymentHost.includes('#')
  ) {
    throw new Error('VERCEL_URL must contain only a deployment hostname')
  }

  return exactOrigin(
    `https://${deploymentHost}`,
    true,
    'VERCEL_URL',
  )
}

/**
 * Resolves the one public origin used by metadata and authentication.
 *
 * Local development may use HTTP and defaults to localhost. Vercel Preview
 * may derive its HTTPS origin from VERCEL_URL. Production fails closed unless
 * it is configured for the approved WebChess hostname.
 */
export function resolveSiteOrigin(
  environment: SiteOriginEnvironment = process.env,
): string {
  const standardTarget = environment.VERCEL_ENV?.trim()
  const explicitTarget = environment.VERCEL_TARGET_ENV?.trim()
  const onVercel = [
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_TARGET_ENV',
    'VERCEL_URL',
  ].some((variableName) => environment[variableName] !== undefined)
  const configuredSiteUrl = environment.NEXT_PUBLIC_SITE_URL

  if (onVercel) {
    if (
      nonBlank(standardTarget) &&
      nonBlank(explicitTarget) &&
      standardTarget !== explicitTarget
    ) {
      throw new Error(
        'VERCEL_ENV and VERCEL_TARGET_ENV must identify the same target',
      )
    }
    const deploymentTarget = nonBlank(standardTarget)
      ? standardTarget
      : explicitTarget

    if (deploymentTarget === 'production') {
      if (!nonBlank(configuredSiteUrl)) {
        throw new Error(
          `Production NEXT_PUBLIC_SITE_URL must be ${PRODUCTION_SITE_ORIGIN}`,
        )
      }
      const origin = exactOrigin(
        configuredSiteUrl,
        true,
        'NEXT_PUBLIC_SITE_URL',
      )
      if (origin !== PRODUCTION_SITE_ORIGIN) {
        throw new Error(
          `Production NEXT_PUBLIC_SITE_URL must be ${PRODUCTION_SITE_ORIGIN}`,
        )
      }
      return origin
    }

    if (deploymentTarget !== 'preview') {
      throw new Error(
        'A Vercel deployment must identify VERCEL_ENV or VERCEL_TARGET_ENV as preview or production',
      )
    }

    return nonBlank(configuredSiteUrl)
      ? exactOrigin(configuredSiteUrl, true, 'NEXT_PUBLIC_SITE_URL')
      : derivedVercelOrigin(environment.VERCEL_URL)
  }

  return nonBlank(configuredSiteUrl)
    ? exactOrigin(configuredSiteUrl, false, 'NEXT_PUBLIC_SITE_URL')
    : LOCAL_SITE_ORIGIN
}

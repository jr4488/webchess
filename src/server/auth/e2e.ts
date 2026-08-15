import 'server-only'

import type { AuthenticatedUser } from './types'

export const LOCAL_E2E_AUTH_HEADER = 'x-webchess-e2e-auth'
const E2E_USER_ID_PATTERN = /^e2e_[A-Za-z0-9_-]{1,80}$/u
type AuthEnvironment = Readonly<Record<string, string | undefined>>

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  )
}

const isVercelEnvironment = (environment: AuthEnvironment): boolean =>
  environment.VERCEL !== undefined ||
  environment.VERCEL_ENV !== undefined ||
  environment.VERCEL_TARGET_ENV !== undefined ||
  environment.VERCEL_URL !== undefined

/**
 * Supplies a fixed test principal only to an explicitly opted-in loopback
 * request. The browser can activate the fixture, but it can never choose the
 * user ID. Any Vercel marker disables this path, including an empty marker.
 */
export function resolveLocalE2EUser(
  request: Request,
  environment: AuthEnvironment = process.env,
): AuthenticatedUser | null {
  if (isVercelEnvironment(environment)) {
    return null
  }

  const activation = environment.WEBCHESS_E2E_AUTH
  const userId = environment.WEBCHESS_E2E_USER_ID
  if (
    !activation ||
    request.headers.get(LOCAL_E2E_AUTH_HEADER) !== activation ||
    !userId ||
    !E2E_USER_ID_PATTERN.test(userId)
  ) {
    return null
  }

  let requestUrl: URL
  try {
    requestUrl = new URL(request.url)
  } catch {
    return null
  }

  if (!isLoopbackHostname(requestUrl.hostname)) {
    return null
  }

  return {
    userId,
    source: 'local-e2e',
  }
}

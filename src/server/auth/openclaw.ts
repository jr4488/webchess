import 'server-only'

import type { AuthenticatedUser } from './types'

export const LOCAL_OPENCLAW_AUTH_HEADER = 'x-webchess-openclaw-runtime'
export const LOCAL_OPENCLAW_AUTH_VALUE = 'webchess-2'
const LOCAL_OWNER_PATTERN = /^openclaw_[a-z0-9_-]{8,80}$/u

type AuthEnvironment = Readonly<Record<string, string | undefined>>

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/**
 * The marker is an exclusive routing decision, not an authentication hint.
 * Once a request identifies itself as OpenClaw, it must never fall through to
 * Clerk or either local development principal when the marker is malformed or
 * local mode is unavailable.
 */
export function isLocalOpenClawMarkedRequest(request: Request): boolean {
  return request.headers.has(LOCAL_OPENCLAW_AUTH_HEADER)
}

/**
 * Establishes one machine-local owner only inside the explicitly enabled,
 * loopback-bound OpenClaw runtime. Hosted and Vercel requests can never enter
 * this path.
 */
export function resolveLocalOpenClawUser(
  request: Request,
  environment: AuthEnvironment = process.env,
): AuthenticatedUser | null {
  if (
    environment.VERCEL !== undefined ||
    environment.VERCEL_ENV !== undefined ||
    environment.VERCEL_TARGET_ENV !== undefined ||
    environment.VERCEL_URL !== undefined ||
    environment.WEBCHESS_OPENCLAW_ENABLED !== 'true' ||
    request.headers.get(LOCAL_OPENCLAW_AUTH_HEADER) !== LOCAL_OPENCLAW_AUTH_VALUE
  ) {
    return null
  }

  try {
    const requestUrl = new URL(request.url)
    const ownerId = environment.WEBCHESS_OPENCLAW_OWNER_ID?.trim()
    const host = request.headers.get('host')
    if (
      !host ||
      !ownerId ||
      !LOCAL_OWNER_PATTERN.test(ownerId) ||
      !(
        requestUrl.pathname === '/api/divide' ||
        requestUrl.pathname === '/api/openclaw/case-verify' ||
        requestUrl.pathname === '/api/web-memory' ||
        requestUrl.pathname.startsWith('/api/division-intents/') ||
        requestUrl.pathname.startsWith('/api/games/')
      )
    ) {
      return null
    }
    const hostUrl = new URL(`http://${host}`)
    if (
      !isLoopbackHostname(requestUrl.hostname) ||
      !isLoopbackHostname(hostUrl.hostname) ||
      requestUrl.port !== hostUrl.port
    ) {
      return null
    }

    return {
      userId: ownerId,
      source: 'local-openclaw',
    }
  } catch {
    return null
  }
}

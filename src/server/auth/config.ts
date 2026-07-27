import 'server-only'

import { resolveSiteOrigin } from '@/server/site-origin'

const nonBlank = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

type AuthEnvironment = Readonly<Record<string, string | undefined>>

export function isClerkConfigured(
  environment: AuthEnvironment = process.env,
): boolean {
  return (
    nonBlank(environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    nonBlank(environment.CLERK_SECRET_KEY)
  )
}

export function isProtectedPagePath(pathname: string): boolean {
  return (
    pathname === '/play' ||
    pathname.startsWith('/play/') ||
    pathname === '/account' ||
    pathname.startsWith('/account/')
  )
}

export function clerkAuthorizedParties(
  environment: AuthEnvironment = process.env,
): string[] {
  return [resolveSiteOrigin(environment)]
}

/**
 * Clerk v7 strict CSP currently includes `unsafe-inline` in script-src for
 * backwards compatibility. A nonce makes that token ineffective in CSP3
 * browsers, but WebChess removes it explicitly so the production policy also
 * fails closed in older implementations.
 */
export function removeUnsafeInlineScriptPolicy(policy: string): string {
  return policy
    .split(';')
    .map((rawDirective) => {
      const directive = rawDirective.trim()
      if (!directive.startsWith('script-src ')) {
        return directive
      }

      return directive
        .split(/\s+/)
        .filter((token) => token !== "'unsafe-inline'")
        .join(' ')
    })
    .filter((directive) => directive.length > 0)
    .join('; ')
}

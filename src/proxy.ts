import { clerkMiddleware } from '@clerk/nextjs/server'
import type { NextFetchEvent, NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  clerkAuthorizedParties,
  isClerkConfigured,
  isProtectedPagePath,
  removeUnsafeInlineScriptPolicy,
} from './server/auth/config'
import { resolveLocalE2EUser } from './server/auth/e2e'
import { resolveLocalHostedUser } from './server/auth/local-session'
import {
  isLocalOpenClawMarkedRequest,
  resolveLocalOpenClawUser,
} from './server/auth/openclaw'
import { buildSignInPath } from './server/auth/return-url'
import { isOpenClawLocalModeEnabled } from './server/openclaw/config'
import { isLoopbackHostname } from './server/openclaw/request-guard'

const configuredClerkProxy = clerkMiddleware(
  async (auth, request) => {
    if (isProtectedPagePath(request.nextUrl.pathname)) {
      await auth.protect()
    }
  },
  () => ({
    authorizedParties: clerkAuthorizedParties(),
    contentSecurityPolicy: {
      strict: true,
      directives: {
        'base-uri': ["'self'"],
        'connect-src': [
          "'self'",
          'https://*.clerk.accounts.dev',
          'https://*.clerk.com',
          'https://*.protect.clerk.com',
        ],
        'font-src': ["'self'", 'data:'],
        'form-action': [
          "'self'",
          'https://*.clerk.accounts.dev',
          'https://*.clerk.com',
        ],
        'frame-ancestors': ["'none'"],
        'frame-src': [
          "'self'",
          'https://*.clerk.accounts.dev',
          'https://*.clerk.com',
          'https://challenges.cloudflare.com',
          'https://*.protect.clerk.com',
        ],
        'img-src': [
          "'self'",
          'data:',
          'blob:',
          'https://img.clerk.com',
        ],
        'object-src': ["'none'"],
        'script-src-attr': ["'none'"],
        'worker-src': ["'self'", 'blob:'],
      },
    },
    frontendApiProxy: {
      enabled: true,
    },
    signInUrl: '/sign-in',
    signUpUrl: '/sign-up',
  }),
)

function hardenStrictContentSecurityPolicy(response: Response): void {
  const headerNames = [
    'content-security-policy',
    'x-middleware-request-content-security-policy',
  ]

  for (const headerName of headerNames) {
    const policy = response.headers.get(headerName)
    if (policy) {
      response.headers.set(
        headerName,
        removeUnsafeInlineScriptPolicy(policy),
      )
    }
  }
}

function isOpenClawPagePath(pathname: string): boolean {
  return pathname === '/openclaw' || pathname.startsWith('/openclaw/')
}

function isLoopbackOpenClawPageRequest(request: NextRequest): boolean {
  const host = request.headers.get('host')
  if (
    !host ||
    host.trim() !== host ||
    host.includes('/') ||
    host.includes('\\') ||
    host.includes('@')
  ) {
    return false
  }

  try {
    const hostUrl = new URL(`http://${host}`)
    return (
      isLoopbackHostname(request.nextUrl.hostname) &&
      isLoopbackHostname(hostUrl.hostname) &&
      request.nextUrl.port === hostUrl.port
    )
  } catch {
    return false
  }
}

function localOpenClawRejection(status: 403 | 404): NextResponse {
  return new NextResponse(status === 404 ? 'Not Found' : 'Forbidden', {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (isOpenClawPagePath(request.nextUrl.pathname)) {
    if (
      !isOpenClawLocalModeEnabled() ||
      !isLoopbackOpenClawPageRequest(request)
    ) {
      return localOpenClawRejection(404)
    }
    return NextResponse.next()
  }

  if (isLocalOpenClawMarkedRequest(request)) {
    return resolveLocalOpenClawUser(request)
      ? NextResponse.next()
      : localOpenClawRejection(403)
  }

  if (
    resolveLocalE2EUser(request) ||
    resolveLocalHostedUser(request)
  ) {
    return NextResponse.next()
  }

  if (!isClerkConfigured()) {
    if (isProtectedPagePath(request.nextUrl.pathname)) {
      const returnUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`
      return NextResponse.redirect(
        new URL(buildSignInPath(returnUrl), request.url),
      )
    }

    return NextResponse.next()
  }

  const response = await configuredClerkProxy(request, event)
  if (response) {
    hardenStrictContentSecurityPolicy(response)
  }
  return response
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|md|pdf|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}

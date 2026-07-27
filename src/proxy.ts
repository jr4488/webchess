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
import { buildSignInPath } from './server/auth/return-url'

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

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (resolveLocalE2EUser(request)) {
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

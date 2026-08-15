import { NextResponse } from 'next/server'

import { verifySameOriginMutation } from '@/server/auth'
import { sanitizeReturnUrl } from '@/server/auth/return-url'
import {
  createLocalHostedSessionCookie,
  isLocalHostedSignInAvailable,
  localHostedRedirectUrl,
} from '@/server/auth/local-session'
import { authenticationUnavailableJson } from '@/server/auth/responses'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isBrowserFormPost(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? ''
  return (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  )
}

function redirectToSignIn(request: Request): Response {
  return NextResponse.redirect(
    localHostedRedirectUrl(request, '/sign-in'),
    303,
  )
}

export async function GET(request: Request): Promise<Response> {
  return redirectToSignIn(request)
}

export async function POST(request: Request): Promise<Response> {
  const originError = verifySameOriginMutation(request)
  if (originError) {
    return isBrowserFormPost(request) ? redirectToSignIn(request) : originError
  }
  if (!isLocalHostedSignInAvailable(request)) {
    return isBrowserFormPost(request)
      ? redirectToSignIn(request)
      : authenticationUnavailableJson()
  }

  const form = await request.formData().catch(() => null)
  const rawReturn = form?.get('return_url')
  const returnUrl = sanitizeReturnUrl(
    typeof rawReturn === 'string' ? rawReturn : null,
  )
  const cookie = createLocalHostedSessionCookie(request)
  if (!cookie) {
    return isBrowserFormPost(request)
      ? redirectToSignIn(request)
      : authenticationUnavailableJson()
  }

  const response = NextResponse.redirect(
    localHostedRedirectUrl(request, returnUrl),
    303,
  )
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    maxAge: cookie.maxAge,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
  })
  return response
}

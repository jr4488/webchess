import { NextResponse } from 'next/server'

import { verifySameOriginMutation } from '@/server/auth'
import {
  clearLocalHostedSessionCookie,
  isLoopbackAuthRequest,
  localHostedRedirectUrl,
} from '@/server/auth/local-session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const originError = verifySameOriginMutation(request)
  if (originError) {
    return originError
  }

  const response = NextResponse.redirect(
    localHostedRedirectUrl(request, '/'),
    303,
  )
  if (isLoopbackAuthRequest(request)) {
    const cookie = clearLocalHostedSessionCookie(request)
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: cookie.httpOnly,
      maxAge: cookie.maxAge,
      path: cookie.path,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
    })
  }
  return response
}

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { isClerkConfigured } from './config'
import { resolveLocalE2EUser } from './e2e'
import {
  isLocalHostedSignInAvailable,
  resolveLocalHostedUser,
} from './local-session'
import { resolveLocalOpenClawUser } from './openclaw'
import {
  authenticationUnavailableJson,
  unauthorizedJson,
} from './responses'
import { buildSignInPath, sanitizeReturnUrl } from './return-url'
import type { AuthenticatedUser, RequestAuth } from './types'

export const requestFromCurrentHeaders = async (): Promise<Request | null> => {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')
  if (!host) {
    return null
  }

  const protocol =
    requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
  try {
    return new Request(`${protocol}://${host}/`, {
      headers: requestHeaders,
    })
  } catch {
    return null
  }
}

export async function getRequestAuth(
  request?: Request,
): Promise<RequestAuth> {
  const resolvedRequest = request ?? (await requestFromCurrentHeaders())
  const localUser = resolvedRequest
    ? resolveLocalOpenClawUser(resolvedRequest) ??
      resolveLocalE2EUser(resolvedRequest) ??
      resolveLocalHostedUser(resolvedRequest)
    : null

  if (localUser) {
    return {
      status: 'authenticated',
      user: localUser,
    }
  }

  if (resolvedRequest && isLocalHostedSignInAvailable(resolvedRequest)) {
    return {
      status: 'signed-out',
    }
  }

  if (!isClerkConfigured()) {
    return {
      status: 'unavailable',
    }
  }

  const { userId } = await auth()
  if (!userId) {
    return {
      status: 'signed-out',
    }
  }

  return {
    status: 'authenticated',
    user: {
      userId,
      source: 'clerk',
    },
  }
}

export async function getAuthenticatedUser(
  request?: Request,
): Promise<AuthenticatedUser | null> {
  const requestAuth = await getRequestAuth(request)
  return requestAuth.status === 'authenticated' ? requestAuth.user : null
}

/**
 * Route Handler boundary. Return the Response directly when this function does
 * not return a principal.
 */
export async function requireApiUser(
  request: Request,
): Promise<AuthenticatedUser | Response> {
  const requestAuth = await getRequestAuth(request)
  if (requestAuth.status === 'authenticated') {
    return requestAuth.user
  }

  return requestAuth.status === 'unavailable'
    ? authenticationUnavailableJson()
    : unauthorizedJson()
}

/**
 * Server Component boundary. This redirect is convenience only; every
 * mutation and Route Handler still re-checks authentication.
 */
export async function requirePageUser(
  returnUrl = '/play',
  request?: Request,
): Promise<AuthenticatedUser> {
  const requestAuth = await getRequestAuth(request)
  if (requestAuth.status === 'authenticated') {
    return requestAuth.user
  }

  redirect(buildSignInPath(sanitizeReturnUrl(returnUrl)))
}

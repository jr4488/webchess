import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { isClerkConfigured } from './config'
import type { AuthenticatedUser } from './types'

export const LOCAL_HOSTED_SESSION_COOKIE = 'webchess_local_session'
export const LOCAL_HOSTED_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
export const LOCAL_HOSTED_AUTH_FLAG = 'WEBCHESS_LOCAL_HOSTED_AUTH'
export const LOCAL_SESSION_SECRET_NAME = 'WEBCHESS_LOCAL_SESSION_SECRET'
const SESSION_PURPOSE = 'webchess-local-session-v1'
const OWNER_PURPOSE = 'webchess-local-owner-v1'
const USER_ID_PATTERN = /^local_[a-f0-9]{32}$/u
const SESSION_PATTERN =
  /^v1\.(local_[a-f0-9]{32})\.(\d{10,16})\.([a-f0-9]{64})$/u

type AuthEnvironment = Readonly<Record<string, string | undefined>>

function isVercelRuntime(environment: AuthEnvironment): boolean {
  return (
    environment.VERCEL !== undefined ||
    environment.VERCEL_ENV !== undefined ||
    environment.VERCEL_TARGET_ENV !== undefined ||
    environment.VERCEL_URL !== undefined
  )
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '')
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

function localSessionSecret(environment: AuthEnvironment): string | null {
  const secret = environment[LOCAL_SESSION_SECRET_NAME]
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    return null
  }
  return secret
}

function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret)
    .update(SESSION_PURPOSE, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex')
}

function equalHex(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, 'hex')
    const b = Buffer.from(right, 'hex')
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function loopbackRequestOrigins(
  request: Request,
): { readonly requestUrl: URL; readonly hostUrl: URL } | null {
  try {
    const requestUrl = new URL(request.url)
    if (!['http:', 'https:'].includes(requestUrl.protocol)) {
      return null
    }
    const host = request.headers.get('host')
    if (!host) {
      return null
    }
    const hostUrl = new URL(`${requestUrl.protocol}//${host}`)
    if (
      isLoopbackHostname(requestUrl.hostname) &&
      isLoopbackHostname(hostUrl.hostname) &&
      requestUrl.port === hostUrl.port
    ) {
      return { hostUrl, requestUrl }
    }
    return null
  } catch {
    return null
  }
}

export function isLoopbackAuthRequest(request: Request): boolean {
  return loopbackRequestOrigins(request) !== null
}

export function localHostedRequestOrigin(request: Request): string | null {
  return loopbackRequestOrigins(request)?.hostUrl.origin ?? null
}

/**
 * Keep the browser on the hostname it used. Next may canonicalize the
 * request URL to localhost while the user is on 127.0.0.1, and those
 * origins do not share cookies.
 */
export function localHostedRedirectUrl(request: Request, path: string): URL {
  const requestUrl = new URL(request.url)
  const origin = localHostedRequestOrigin(request) ?? requestUrl.origin
  return new URL(path, origin)
}

export function isLocalHostedAuthEnabled(
  environment: AuthEnvironment = process.env,
): boolean {
  return (
    !isVercelRuntime(environment) &&
    environment[LOCAL_HOSTED_AUTH_FLAG] === 'true' &&
    environment.WEBCHESS_OPENCLAW_ENABLED !== 'true' &&
    !environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
    !environment.CLERK_SECRET_KEY?.trim() &&
    !isClerkConfigured(environment) &&
    localSessionSecret(environment) !== null
  )
}

export function isLocalHostedSignInAvailable(
  request: Request,
  environment: AuthEnvironment = process.env,
): boolean {
  return isLocalHostedAuthEnabled(environment) && isLoopbackAuthRequest(request)
}

export function localHostedUserId(
  environment: AuthEnvironment = process.env,
): string | null {
  const secret = localSessionSecret(environment)
  if (!secret) {
    return null
  }
  const digest = createHash('sha256')
    .update(OWNER_PURPOSE)
    .update('\0')
    .update(secret)
    .digest('hex')
    .slice(0, 32)
  return `local_${digest}`
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) {
    return null
  }
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      continue
    }
    if (trimmed.slice(0, separator) !== name) {
      continue
    }
    try {
      return decodeURIComponent(trimmed.slice(separator + 1))
    } catch {
      return null
    }
  }
  return null
}

export interface LocalHostedSessionCookie {
  readonly name: string
  readonly value: string
  readonly httpOnly: true
  readonly path: '/'
  readonly sameSite: 'lax'
  readonly maxAge: number
  readonly secure: boolean
}

export function createLocalHostedSessionCookie(
  request: Request,
  environment: AuthEnvironment = process.env,
  now = Date.now(),
): LocalHostedSessionCookie | null {
  if (!isLocalHostedSignInAvailable(request, environment)) {
    return null
  }
  const secret = localSessionSecret(environment)
  const userId = localHostedUserId(environment)
  if (!secret || !userId) {
    return null
  }
  const expiry = Math.floor(now / 1000) + LOCAL_HOSTED_SESSION_MAX_AGE_SECONDS
  const mac = hmacHex(secret, `${userId}\0${expiry}`)
  return {
    name: LOCAL_HOSTED_SESSION_COOKIE,
    value: `v1.${userId}.${expiry}.${mac}`,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: LOCAL_HOSTED_SESSION_MAX_AGE_SECONDS,
    secure: new URL(request.url).protocol === 'https:',
  }
}

export function clearLocalHostedSessionCookie(
  request: Request,
): LocalHostedSessionCookie {
  return {
    name: LOCAL_HOSTED_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: 0,
    secure: (() => {
      try {
        return new URL(request.url).protocol === 'https:'
      } catch {
        return false
      }
    })(),
  }
}

/**
 * Accepts a signed machine session only on loopback, only when Clerk and
 * OpenClaw are both off, and never on Vercel.
 */
export function resolveLocalHostedUser(
  request: Request,
  environment: AuthEnvironment = process.env,
  now = Date.now(),
): AuthenticatedUser | null {
  if (!isLocalHostedSignInAvailable(request, environment)) {
    return null
  }
  const secret = localSessionSecret(environment)
  const expectedUserId = localHostedUserId(environment)
  const value = readCookie(request, LOCAL_HOSTED_SESSION_COOKIE)
  if (!secret || !expectedUserId || !value) {
    return null
  }
  const match = SESSION_PATTERN.exec(value)
  if (!match) {
    return null
  }
  const userId = match[1]
  const expiry = Number(match[2])
  const mac = match[3]
  if (
    userId !== expectedUserId ||
    !USER_ID_PATTERN.test(userId) ||
    !Number.isSafeInteger(expiry)
  ) {
    return null
  }
  const nowSeconds = Math.floor(now / 1000)
  if (expiry <= nowSeconds || expiry > nowSeconds + LOCAL_HOSTED_SESSION_MAX_AGE_SECONDS + 60) {
    return null
  }
  if (!equalHex(mac, hmacHex(secret, `${userId}\0${expiry}`))) {
    return null
  }
  return {
    userId,
    source: 'local-hosted',
  }
}

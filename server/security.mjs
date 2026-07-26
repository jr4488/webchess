import {
  createHash,
  createHmac,
  randomBytes as secureRandomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { isIP } from 'node:net'

export const SESSION_COOKIE_NAME = 'webchess_session'
export const CSRF_HEADER_NAME = 'x-webchess-csrf'
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === false) {
    return { trustProxy: false }
  }
  if (typeof value !== 'string') {
    return {
      trustProxy: false,
      problem: 'WEBCHESS_TRUST_PROXY must be false or a comma-separated IP/CIDR allowlist.',
    }
  }

  const normalized = value.trim()
  if (!normalized || normalized.toLowerCase() === 'false') {
    return { trustProxy: false }
  }

  const entries = normalized.split(',').map((entry) => entry.trim())
  for (const entry of entries) {
    if (!entry) {
      return {
        trustProxy: false,
        problem: 'WEBCHESS_TRUST_PROXY contains an empty proxy address.',
      }
    }

    const slash = entry.lastIndexOf('/')
    const address = slash === -1 ? entry : entry.slice(0, slash)
    const prefix = slash === -1 ? undefined : entry.slice(slash + 1)
    const addressFamily = isIP(address)
    const maximumPrefix = addressFamily === 4 ? 32 : 128
    const numericPrefix = prefix === undefined ? undefined : Number(prefix)
    if (
      addressFamily === 0 ||
      (prefix !== undefined && (
        !/^(?:0|[1-9]\d*)$/u.test(prefix) ||
        numericPrefix === 0 ||
        numericPrefix > maximumPrefix
      ))
    ) {
      return {
        trustProxy: false,
        problem: `WEBCHESS_TRUST_PROXY contains an invalid IP or CIDR: ${entry}`,
      }
    }
  }

  return { trustProxy: entries }
}

export function resolveSecurityConfig(options = {}) {
  const accessCode = cleanString(options.accessCode ?? process.env.WEBCHESS_ACCESS_CODE)
  const sessionSecret = cleanString(
    options.sessionSecret ?? process.env.WEBCHESS_SESSION_SECRET,
  )
  const trustProxyResult = parseTrustProxy(
    options.trustProxy ?? process.env.WEBCHESS_TRUST_PROXY,
  )
  const configuredOrigins = options.allowedOrigins ??
    cleanString(process.env.WEBCHESS_ALLOWED_ORIGINS)
  const originEntries = Array.isArray(configuredOrigins)
    ? configuredOrigins
    : String(configuredOrigins).split(',')
  const originsExplicitlyConfigured = Array.isArray(configuredOrigins)
    ? configuredOrigins.length > 0
    : cleanString(configuredOrigins).length > 0
  const hasEmptyConfiguredOrigin =
    originsExplicitlyConfigured &&
    originEntries.some((origin) => cleanString(origin).length === 0)
  const allowedOrigins = originEntries
    .map((origin) => cleanString(origin).replace(/\/+$/, ''))
    .filter(Boolean)

  const problems = []
  if (accessCode.length < 12) {
    problems.push('WEBCHESS_ACCESS_CODE must contain at least 12 characters.')
  }
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    problems.push('WEBCHESS_SESSION_SECRET must contain at least 32 bytes.')
  }
  if (
    accessCode &&
    sessionSecret &&
    constantTimeStringEqual(accessCode, sessionSecret)
  ) {
    problems.push('WEBCHESS_ACCESS_CODE and WEBCHESS_SESSION_SECRET must be different.')
  }
  if (trustProxyResult.problem) {
    problems.push(trustProxyResult.problem)
  }
  if (hasEmptyConfiguredOrigin) {
    problems.push('WEBCHESS_ALLOWED_ORIGINS contains an empty origin.')
  }
  for (const origin of allowedOrigins) {
    try {
      const parsedOrigin = new URL(origin)
      if (
        !['http:', 'https:'].includes(parsedOrigin.protocol) ||
        parsedOrigin.origin !== origin
      ) {
        problems.push(`WEBCHESS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`)
      }
    } catch {
      problems.push(`WEBCHESS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`)
    }
  }

  return {
    accessCode,
    sessionSecret,
    allowedOrigins,
    trustProxy: trustProxyResult.trustProxy,
    configured: problems.length === 0,
    problems,
  }
}

export function constantTimeStringEqual(left, right) {
  const leftDigest = createHash('sha256').update(String(left)).digest()
  const rightDigest = createHash('sha256').update(String(right)).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

function parseCookies(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return new Map()
  }

  return new Map(
    cookieHeader.split(';').flatMap((part) => {
      const separator = part.indexOf('=')
      if (separator <= 0) {
        return []
      }
      const name = part.slice(0, separator).trim()
      const value = part.slice(separator + 1).trim()
      try {
        return [[name, decodeURIComponent(value)]]
      } catch {
        return []
      }
    }),
  )
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function parseBase64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function validSessionShape(value, providerId, sessionEpoch) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.v === 3 &&
    value.provider === providerId &&
    value.epoch === sessionEpoch &&
    typeof value.sid === 'string' &&
    value.sid.length >= 24 &&
    typeof value.csrf === 'string' &&
    value.csrf.length >= 24 &&
    Number.isSafeInteger(value.iat) &&
    Number.isSafeInteger(value.exp) &&
    value.exp > value.iat,
  )
}

export function createSessionManager(options) {
  const secret = options.secret
  const providerId = cleanString(options.providerId)
  if (!providerId) {
    throw new TypeError('A model provider ID is required for WebChess sessions.')
  }
  const now = options.now ?? Date.now
  const randomBytes = options.randomBytes ?? secureRandomBytes
  const sessionEpoch = options.sessionEpoch ??
    randomBytes(16).toString('base64url')
  if (typeof sessionEpoch !== 'string' || sessionEpoch.length < 16) {
    throw new TypeError('A strong session epoch is required.')
  }
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS
  const revokedSessions = new Map()

  function pruneRevocations(timestamp) {
    for (const [sessionId, expiresAt] of revokedSessions) {
      if (expiresAt <= timestamp) {
        revokedSessions.delete(sessionId)
      }
    }
  }

  function issue() {
    const issuedAt = now()
    const payload = {
      v: 3,
      provider: providerId,
      epoch: sessionEpoch,
      sid: randomBytes(24).toString('base64url'),
      csrf: randomBytes(24).toString('base64url'),
      iat: issuedAt,
      exp: issuedAt + ttlMs,
    }
    const encoded = base64UrlJson(payload)
    return {
      token: `${encoded}.${sign(encoded, secret)}`,
      session: payload,
    }
  }

  function verify(token) {
    if (typeof token !== 'string') {
      return null
    }
    const separator = token.indexOf('.')
    if (separator <= 0 || separator !== token.lastIndexOf('.')) {
      return null
    }

    const encoded = token.slice(0, separator)
    const signature = token.slice(separator + 1)
    const expected = sign(encoded, secret)
    if (!constantTimeStringEqual(signature, expected)) {
      return null
    }

    const session = parseBase64UrlJson(encoded)
    const timestamp = now()
    pruneRevocations(timestamp)
    if (
      !validSessionShape(session, providerId, sessionEpoch) ||
      session.iat > timestamp + 60_000 ||
      session.exp <= timestamp ||
      revokedSessions.has(session.sid)
    ) {
      return null
    }
    return session
  }

  function fromRequest(request) {
    return verify(parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME))
  }

  function revoke(session) {
    if (validSessionShape(session, providerId, sessionEpoch)) {
      revokedSessions.set(session.sid, session.exp)
    }
  }

  return { issue, verify, fromRequest, revoke }
}

export function sessionCookie(token, options = {}) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (options.secure) {
    attributes.push('Secure')
  }
  if (Number.isFinite(options.maxAgeSeconds)) {
    attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`)
  }
  return attributes.join('; ')
}

export function clearedSessionCookie(options = {}) {
  return sessionCookie('', { ...options, maxAgeSeconds: 0 })
}

export function requestOriginAllowed(request, allowedOrigins = []) {
  const supplied = cleanString(request.get('origin'))
  if (!supplied) {
    return false
  }

  let parsed
  try {
    parsed = new URL(supplied)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/') {
    return false
  }

  const normalized = parsed.origin.replace(/\/+$/, '')
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(normalized)
  }

  const host = cleanString(request.get('host')).toLowerCase()
  return Boolean(host) && parsed.host.toLowerCase() === host
}

export class FixedWindowRateLimiter {
  constructor(options = {}) {
    this.limit = options.limit ?? 10
    this.windowMs = options.windowMs ?? 60_000
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? 10_000
    this.entries = new Map()
  }

  consume(key) {
    const timestamp = this.now()
    for (const [existingKey, existingEntry] of this.entries) {
      if (existingEntry.resetAt <= timestamp) {
        this.entries.delete(existingKey)
      }
    }

    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= this.maxEntries) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil(this.windowMs / 1_000)),
        }
      }
      entry = { count: 0, resetAt: timestamp + this.windowMs }
      this.entries.set(key, entry)
    }

    if (entry.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1_000)),
      }
    }

    entry.count += 1
    return {
      allowed: true,
      remaining: this.limit - entry.count,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1_000)),
    }
  }
}

export class ConcurrencyGate {
  constructor(limit = 4) {
    this.limit = limit
    this.active = 0
  }

  tryAcquire() {
    if (this.active >= this.limit) {
      return null
    }
    this.active += 1
    let released = false
    return () => {
      if (!released) {
        released = true
        this.active -= 1
      }
    }
  }
}

export function clientAddress(request) {
  return request.ip || request.socket?.remoteAddress || 'unknown'
}

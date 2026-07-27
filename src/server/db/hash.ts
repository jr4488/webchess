import { createHash, createHmac } from 'node:crypto'

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson }

function serializeCanonical(value: unknown, path: string): string {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Canonical JSON cannot encode ${path}: non-finite number.`)
    }

    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item, index) => serializeCanonical(item, `${path}[${index}]`))
      .join(',')}]`
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Canonical JSON cannot encode ${path}: only plain objects are supported.`,
      )
    }

    const object = value as Record<string, unknown>
    const entries = Object.keys(object)
      .sort()
      .map((key) => {
        const encodedKey = JSON.stringify(key)
        const encodedValue = serializeCanonical(object[key], `${path}.${key}`)
        return `${encodedKey}:${encodedValue}`
      })

    return `{${entries.join(',')}}`
  }

  throw new TypeError(
    `Canonical JSON cannot encode ${path}: unsupported ${typeof value} value.`,
  )
}

/**
 * Produces deterministic JSON for hashes and idempotency records.
 *
 * Object keys are sorted while array order is retained. Unsupported JSON
 * values are rejected instead of being silently dropped.
 */
export function canonicalJson(value: CanonicalJson): string {
  return serializeCanonical(value, '$')
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashCanonicalJson(value: CanonicalJson): string {
  return sha256Hex(canonicalJson(value))
}

/**
 * Domain-separated HMAC for pseudonymous database keys.
 *
 * In particular, use this before placing an address in rate_buckets. The
 * returned digest is safe to persist; the raw address is not.
 */
export function hmacSha256Hex(
  secret: string | Uint8Array,
  purpose: string,
  value: string | Uint8Array,
): string {
  if (purpose.length === 0 || purpose.includes('\0')) {
    throw new TypeError('HMAC purpose must be non-empty and contain no NUL bytes.')
  }

  return createHmac('sha256', secret)
    .update(purpose, 'utf8')
    .update('\0', 'utf8')
    .update(value)
    .digest('hex')
}

export function hashRateLimitKey(
  secret: string | Uint8Array,
  keyType: 'user' | 'ip',
  value: string,
): string {
  return hmacSha256Hex(secret, `webchess-rate-${keyType}-v1`, value)
}

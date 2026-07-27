// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  canonicalJson,
  hashCanonicalJson,
  hashRateLimitKey,
  hmacSha256Hex,
  sha256Hex,
} from './hash'

describe('canonical database hashes', () => {
  it('sorts object keys while preserving array order', () => {
    const left = {
      z: [3, 2, 1],
      a: { beta: true, alpha: 'value' },
    }
    const right = {
      a: { alpha: 'value', beta: true },
      z: [3, 2, 1],
    }

    expect(canonicalJson(left)).toBe(
      '{"a":{"alpha":"value","beta":true},"z":[3,2,1]}',
    )
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right))
    expect(hashCanonicalJson({ z: [1, 2, 3], a: right.a })).not.toBe(
      hashCanonicalJson(left),
    )
  })

  it('rejects values that JSON would silently discard', () => {
    expect(() =>
      canonicalJson({ invalid: undefined } as never),
    ).toThrow(/unsupported undefined/)
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow(
      /non-finite number/,
    )
    expect(() => canonicalJson(new Date() as never)).toThrow(
      /only plain objects/,
    )
  })

  it('produces standard SHA-256 hex digests', () => {
    expect(sha256Hex('webchess')).toBe(
      '51c92f4ad2907114a11f445db65b8d1cc3309f57e1bfae3f337065bbd6e02408',
    )
  })

  it('domain-separates pseudonymous rate-limit keys', () => {
    const rawAddress = '203.0.113.7'
    const secret = 'test-only-secret'
    const addressDigest = hashRateLimitKey(secret, 'ip', rawAddress)
    const userDigest = hashRateLimitKey(secret, 'user', rawAddress)

    expect(addressDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(addressDigest).not.toContain(rawAddress)
    expect(addressDigest).not.toBe(userDigest)
    expect(addressDigest).toBe(hashRateLimitKey(secret, 'ip', rawAddress))
    expect(hmacSha256Hex(secret, 'another-purpose', rawAddress)).not.toBe(
      addressDigest,
    )
  })
})

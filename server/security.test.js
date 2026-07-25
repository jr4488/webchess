// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  ConcurrencyGate,
  createSessionManager,
  FixedWindowRateLimiter,
  resolveSecurityConfig,
} from './security.mjs'

describe('server security primitives', () => {
  it('rejects weak access configuration instead of supplying insecure defaults', () => {
    expect(resolveSecurityConfig({
      accessCode: 'too-short',
      sessionSecret: 'also-too-short',
    })).toMatchObject({
      configured: false,
      problems: [
        expect.stringMatching(/ACCESS_CODE/),
        expect.stringMatching(/SESSION_SECRET/),
      ],
    })

    expect(resolveSecurityConfig({
      accessCode: 'a sufficiently long access code',
      sessionSecret: 'a sufficiently long secret with more than 32 bytes',
    })).toMatchObject({
      configured: true,
      problems: [],
    })
  })

  it('signs, expires, and revokes sessions', () => {
    let timestamp = 10_000
    let randomValue = 0
    const manager = createSessionManager({
      secret: 'a sufficiently long test secret with more than 32 bytes',
      ttlMs: 1_000,
      now: () => timestamp,
      randomBytes: (size) => Buffer.alloc(size, randomValue += 1),
    })
    const { token, session } = manager.issue()

    expect(manager.verify(token)).toEqual(session)
    expect(manager.verify(`${token.slice(0, -1)}x`)).toBeNull()

    manager.revoke(session)
    expect(manager.verify(token)).toBeNull()

    const second = manager.issue()
    timestamp += 1_001
    expect(manager.verify(second.token)).toBeNull()
  })

  it('rejects a validly signed session issued too far in the future', () => {
    let timestamp = 120_000
    const manager = createSessionManager({
      secret: 'a sufficiently long test secret with more than 32 bytes',
      ttlMs: 1_000,
      now: () => timestamp,
      randomBytes: (size) => Buffer.alloc(size, 7),
    })
    const futureSession = manager.issue()

    timestamp = 0
    expect(manager.verify(futureSession.token)).toBeNull()
  })

  it('bounds limiter storage and prunes expired keys before admitting new ones', () => {
    let timestamp = 0
    const limiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
      maxEntries: 2,
      now: () => timestamp,
    })

    expect(limiter.consume('first').allowed).toBe(true)
    expect(limiter.consume('second').allowed).toBe(true)
    expect(limiter.entries.size).toBe(2)
    expect(limiter.consume('third')).toMatchObject({
      allowed: false,
      remaining: 0,
    })
    expect(limiter.entries.size).toBe(2)

    timestamp = 1_001
    expect(limiter.consume('third').allowed).toBe(true)
    expect([...limiter.entries.keys()]).toEqual(['third'])
  })

  it('uses an idempotent release for the global concurrency slot', () => {
    const gate = new ConcurrencyGate(1)
    const release = gate.tryAcquire()
    expect(release).toEqual(expect.any(Function))
    expect(gate.tryAcquire()).toBeNull()

    release()
    release()
    expect(gate.active).toBe(0)
    expect(gate.tryAcquire()).toEqual(expect.any(Function))
  })
})

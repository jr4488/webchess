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

  it('rejects reusable session secrets and origins the request checker cannot accept', () => {
    const sharedSecret = 'one long value must not serve both security roles'
    expect(resolveSecurityConfig({
      accessCode: sharedSecret,
      sessionSecret: sharedSecret,
    })).toMatchObject({
      configured: false,
      problems: [expect.stringMatching(/must be different/i)],
    })

    for (const allowedOrigins of [
      ['ftp://example.com'],
      ['file://'],
      ['javascript:alert(1)'],
      [''],
      ['https://example.com', ''],
      ',',
    ]) {
      expect(resolveSecurityConfig({
        accessCode: 'a sufficiently long access code',
        sessionSecret: 'a sufficiently long secret with more than 32 bytes',
        allowedOrigins,
      })).toMatchObject({
        configured: false,
        problems: [expect.stringMatching(/ALLOWED_ORIGINS/)],
      })
    }
  })

  it('signs, expires, and revokes sessions', () => {
    let timestamp = 10_000
    let randomValue = 0
    const manager = createSessionManager({
      secret: 'a sufficiently long test secret with more than 32 bytes',
      providerId: 'openai-api',
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
      providerId: 'openai-api',
      ttlMs: 1_000,
      now: () => timestamp,
      randomBytes: (size) => Buffer.alloc(size, 7),
    })
    const futureSession = manager.issue()

    timestamp = 0
    expect(manager.verify(futureSession.token)).toBeNull()
  })

  it('binds each signed session to one model provider', () => {
    const options = {
      secret: 'a sufficiently long test secret with more than 32 bytes',
      now: () => 10_000,
      randomBytes: (size) => Buffer.alloc(size, 9),
    }
    const apiManager = createSessionManager({
      ...options,
      providerId: 'openai-api',
    })
    const codexManager = createSessionManager({
      ...options,
      providerId: 'codex-chatgpt',
    })
    const apiSession = apiManager.issue()

    expect(apiManager.verify(apiSession.token)).toEqual(apiSession.session)
    expect(apiSession.session).toMatchObject({
      v: 3,
      provider: 'openai-api',
      epoch: expect.any(String),
    })
    expect(codexManager.verify(apiSession.token)).toBeNull()
  })

  it('invalidates every prior session when the server process epoch changes', () => {
    const common = {
      secret: 'a sufficiently long test secret with more than 32 bytes',
      providerId: 'openai-api',
      now: () => 10_000,
      randomBytes: (size) => Buffer.alloc(size, 3),
    }
    const firstProcess = createSessionManager({
      ...common,
      sessionEpoch: 'first-process-epoch-value',
    })
    const restartedProcess = createSessionManager({
      ...common,
      sessionEpoch: 'second-process-epoch-value',
    })
    const session = firstProcess.issue()

    firstProcess.revoke(session.session)
    expect(firstProcess.verify(session.token)).toBeNull()
    expect(restartedProcess.verify(session.token)).toBeNull()
  })

  it('defaults proxy trust off and accepts only explicit IP/CIDR allowlists', () => {
    const required = {
      accessCode: 'a sufficiently long access code',
      sessionSecret: 'a sufficiently long secret with more than 32 bytes',
    }

    expect(resolveSecurityConfig(required)).toMatchObject({
      configured: true,
      trustProxy: false,
    })
    expect(resolveSecurityConfig({
      ...required,
      trustProxy: '127.0.0.1/32, ::1/128',
    })).toMatchObject({
      configured: true,
      trustProxy: ['127.0.0.1/32', '::1/128'],
    })

    for (const trustProxy of [
      true,
      'true',
      '1',
      '*',
      'loopback',
      '10.0.0.1/33',
      '0.0.0.0/0',
      '127.0.0.1,',
    ]) {
      expect(resolveSecurityConfig({ ...required, trustProxy })).toMatchObject({
        configured: false,
        trustProxy: false,
        problems: [expect.stringMatching(/TRUST_PROXY/)],
      })
    }
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

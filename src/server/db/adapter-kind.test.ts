// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'

import {
  isLocalHostedPostgresMigrationAuthorized,
  parseLoopbackPostgresUrl,
  resolveDatabaseAdapterKind,
  shouldUseLocalPostgresWireProtocol,
} from './adapter-kind'

const LOOPBACK =
  'postgresql://webchess:secret@127.0.0.1:55433/webchess'
const NEON =
  'postgresql://webchess:secret@ep-example.us-east-2.aws.neon.tech/webchess?sslmode=require'
const LOCAL_SESSION_SECRET = 'local-session-secret-material-that-is-stable-32b'

function localLauncherEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3005',
    WEBCHESS_LOCAL_HOSTED_AUTH: 'true',
    WEBCHESS_LOCAL_SESSION_SECRET: LOCAL_SESSION_SECRET,
    WEBCHESS_OPENCLAW_ENABLED: 'false',
    ...overrides,
  }
}

describe('local database adapter selection', () => {
  afterEach(() => {
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_TARGET_ENV
    delete process.env.VERCEL_URL
    delete process.env.WEBCHESS_OPENCLAW_ENABLED
  })

  it('uses the PostgreSQL wire protocol for loopback Clerk development', () => {
    expect(shouldUseLocalPostgresWireProtocol(LOOPBACK, {})).toBe(true)
    expect(resolveDatabaseAdapterKind(LOOPBACK, {})).toBe('postgres-wire')
    expect(parseLoopbackPostgresUrl(LOOPBACK, 'DATABASE_URL').port).toBe('55433')
  })

  it('requires explicit valid launcher state before authorizing migrations', () => {
    expect(isLocalHostedPostgresMigrationAuthorized(LOOPBACK, {})).toBe(false)
    expect(
      isLocalHostedPostgresMigrationAuthorized(
        LOOPBACK,
        localLauncherEnvironment(),
      ),
    ).toBe(true)
    expect(
      isLocalHostedPostgresMigrationAuthorized(LOOPBACK, {
        ...localLauncherEnvironment(),
        CLERK_SECRET_KEY: 'sk_test_example',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      }),
    ).toBe(true)
  })

  it('rejects invalid local origins, secrets, and Clerk modes', () => {
    for (const environment of [
      localLauncherEnvironment({ NEXT_PUBLIC_SITE_URL: 'https://example.com' }),
      localLauncherEnvironment({ WEBCHESS_LOCAL_SESSION_SECRET: 'too-short' }),
      localLauncherEnvironment({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_partial',
      }),
      localLauncherEnvironment({
        CLERK_SECRET_KEY: 'sk_live_example',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_example',
      }),
      localLauncherEnvironment({ VERCEL: '1' }),
      localLauncherEnvironment({ VERCEL_ENV: 'preview' }),
      localLauncherEnvironment({ VERCEL_TARGET_ENV: 'staging' }),
      localLauncherEnvironment({ VERCEL_URL: 'webchess-preview.vercel.app' }),
      localLauncherEnvironment({ WEBCHESS_OPENCLAW_ENABLED: 'true' }),
    ]) {
      expect(
        isLocalHostedPostgresMigrationAuthorized(LOOPBACK, environment),
      ).toBe(false)
    }
  })

  it('keeps Neon HTTP for hosted and OpenClaw environments', () => {
    expect(shouldUseLocalPostgresWireProtocol(NEON, {})).toBe(false)
    expect(resolveDatabaseAdapterKind(NEON, {})).toBe('neon-http')
    expect(
      shouldUseLocalPostgresWireProtocol(LOOPBACK, { VERCEL: '1' }),
    ).toBe(false)
    expect(
      shouldUseLocalPostgresWireProtocol(LOOPBACK, {
        VERCEL_ENV: 'preview',
      }),
    ).toBe(false)
    expect(
      shouldUseLocalPostgresWireProtocol(LOOPBACK, {
        VERCEL_TARGET_ENV: 'staging',
      }),
    ).toBe(false)
    expect(
      shouldUseLocalPostgresWireProtocol(LOOPBACK, {
        VERCEL_URL: 'webchess-preview.vercel.app',
      }),
    ).toBe(false)
    expect(
      shouldUseLocalPostgresWireProtocol(LOOPBACK, {
        WEBCHESS_OPENCLAW_ENABLED: 'true',
      }),
    ).toBe(false)
    expect(shouldUseLocalPostgresWireProtocol(undefined, {})).toBe(false)
  })

  it('rejects non-PostgreSQL and non-loopback URLs', () => {
    expect(() => parseLoopbackPostgresUrl('not a url', 'DATABASE_URL')).toThrow(
      /not a valid URL/u,
    )
    expect(() =>
      parseLoopbackPostgresUrl('https://127.0.0.1/webchess', 'DATABASE_URL'),
    ).toThrow(/must use PostgreSQL/u)
    expect(() => parseLoopbackPostgresUrl(NEON, 'DATABASE_URL')).toThrow(
      /loopback host/u,
    )
  })

  it.each([
    ['host override', `${LOOPBACK}?host=database.example.invalid`],
    ['SSL disable override', `${LOOPBACK}?ssl=0`],
    ['libpq SSL override', `${LOOPBACK}?sslmode=disable`],
    ['libpq compatibility override', `${LOOPBACK}?uselibpqcompat=true`],
    ['fragment', `${LOOPBACK}#database.example.invalid`],
    ['empty query marker', `${LOOPBACK}?`],
    ['empty fragment marker', `${LOOPBACK}#`],
  ])('rejects a local PostgreSQL URL with %s', (_label, value) => {
    expect(() => parseLoopbackPostgresUrl(value, 'DATABASE_URL')).toThrow(
      /must not contain a query or fragment/u,
    )
    expect(() => shouldUseLocalPostgresWireProtocol(value, {})).toThrow(
      /must not contain a query or fragment/u,
    )
  })

  it.each([
    ['DNS loopback', 'postgresql://webchess:secret@localhost:55433/webchess'],
    ['username', 'postgresql://:secret@127.0.0.1:55433/webchess'],
    ['password', 'postgresql://webchess@127.0.0.1:55433/webchess'],
    ['port', 'postgresql://webchess:secret@127.0.0.1/webchess'],
    ['database', 'postgresql://webchess:secret@127.0.0.1:55433/'],
    ['one database name', 'postgresql://webchess:secret@127.0.0.1:55433/one/two'],
    ['decoded database slash', 'postgresql://webchess:secret@127.0.0.1:55433/one%2Ftwo'],
    ['decoded control', 'postgresql://webchess:sec%00ret@127.0.0.1:55433/webchess'],
    ['raw control', 'postgresql://webchess:sec\nret@127.0.0.1:55433/webchess'],
    ['surrounding whitespace', ` ${LOOPBACK}`],
  ])('requires a complete numeric-loopback URL: %s', (_label, value) => {
    expect(() => parseLoopbackPostgresUrl(value, 'DATABASE_URL')).toThrow()
  })

  it('preserves hosted adapter selection for a complete remote URL', () => {
    expect(shouldUseLocalPostgresWireProtocol(NEON, {})).toBe(false)
    expect(resolveDatabaseAdapterKind(NEON, {})).toBe('neon-http')
  })
})

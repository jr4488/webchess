// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  ensureLocalHostedSchema: vi.fn(),
  getDatabase: vi.fn(),
}))

vi.mock('../db/local-postgres', () => ({
  ensureLocalHostedSchema: harness.ensureLocalHostedSchema,
}))

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return {
    ...actual,
    getDatabase: harness.getDatabase,
  }
})

const HMAC = 'local-hosted-hmac-secret-material-32b'
const originalEnv = {
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  WEBCHESS_DELETION_HMAC_SECRET: process.env.WEBCHESS_DELETION_HMAC_SECRET,
  WEBCHESS_HMAC_SECRET: process.env.WEBCHESS_HMAC_SECRET,
  WEBCHESS_LOCAL_HOSTED_AUTH: process.env.WEBCHESS_LOCAL_HOSTED_AUTH,
  WEBCHESS_LOCAL_SESSION_SECRET: process.env.WEBCHESS_LOCAL_SESSION_SECRET,
  WEBCHESS_OPENCLAW_ENABLED: process.env.WEBCHESS_OPENCLAW_ENABLED,
}

describe('Clerk local hosted service bootstrap', () => {
  const database = { kind: 'local-postgres' }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.DATABASE_URL =
      'postgresql://webchess:secret@127.0.0.1:55433/webchess'
    process.env.WEBCHESS_HMAC_SECRET = HMAC
    process.env.WEBCHESS_DELETION_HMAC_SECRET = HMAC
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3005'
    process.env.WEBCHESS_LOCAL_SESSION_SECRET =
      'local-session-secret-material-that-is-stable-32b'
    delete process.env.CLERK_SECRET_KEY
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.WEBCHESS_LOCAL_HOSTED_AUTH
    delete process.env.WEBCHESS_OPENCLAW_ENABLED
    harness.getDatabase.mockReturnValue(database)
    harness.ensureLocalHostedSchema.mockResolvedValue(undefined)
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('does not auto-migrate Neon or other hosted databases', async () => {
    process.env.DATABASE_URL =
      'postgresql://webchess:secret@ep-example.us-east-2.aws.neon.tech/webchess?sslmode=require'
    const { createApiServices } = await import('./service-adapter')
    const services = await createApiServices()

    expect(services.divide).toBeTypeOf('function')
    expect(harness.ensureLocalHostedSchema).not.toHaveBeenCalled()
  })

  it('refuses a bare loopback URL before any schema migration', async () => {
    const { createApiServices } = await import('./service-adapter')

    await expect(createApiServices()).rejects.toThrow(
      /Start WebChess through npm run local:dev/u,
    )

    expect(harness.getDatabase).toHaveBeenCalledOnce()
    expect(harness.ensureLocalHostedSchema).not.toHaveBeenCalled()
  })

  it('migrates a launcher-authorized local-session database', async () => {
    process.env.WEBCHESS_LOCAL_HOSTED_AUTH = 'true'
    const { createApiServices } = await import('./service-adapter')

    await createApiServices()

    expect(harness.getDatabase).toHaveBeenCalledOnce()
    expect(harness.ensureLocalHostedSchema).toHaveBeenCalledWith(database)
  })

  it('migrates a launcher-authorized Clerk development database', async () => {
    process.env.WEBCHESS_LOCAL_HOSTED_AUTH = 'true'
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    const { createApiServices } = await import('./service-adapter')

    await createApiServices()

    expect(harness.ensureLocalHostedSchema).toHaveBeenCalledWith(database)
  })

  it('preserves OpenClaw isolation without running local migrations', async () => {
    process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
    const { createApiServices } = await import('./service-adapter')

    await createApiServices()

    expect(harness.ensureLocalHostedSchema).not.toHaveBeenCalled()
  })
})

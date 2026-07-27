import { afterEach, describe, expect, it, vi } from 'vitest'

async function securityHeaders() {
  vi.resetModules()
  const { default: config } = await import('../next.config')
  const routes = await config.headers?.()
  return routes?.flatMap((route) => route.headers) ?? []
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Next.js security headers', () => {
  it('leaves configured Clerk CSP generation to the strict routing middleware', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_example')
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_example')

    const headers = await securityHeaders()

    expect(
      headers.find((header) => header.key === 'Content-Security-Policy'),
    ).toBeUndefined()
    expect(
      headers.find((header) => header.key === 'X-Frame-Options'),
    ).toEqual({ key: 'X-Frame-Options', value: 'DENY' })
  })

  it('keeps the static CSP for unconfigured offline and local tests', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('CLERK_SECRET_KEY', '')

    const headers = await securityHeaders()
    const policy = headers.find(
      (header) => header.key === 'Content-Security-Policy',
    )?.value

    expect(policy).toContain("script-src 'self' 'unsafe-inline'")
  })
})

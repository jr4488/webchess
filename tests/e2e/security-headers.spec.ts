import { expect, test } from './fixtures/test'

const GAME_ID = '00000000-0000-4000-8000-000000000001'
const DIVISION_INTENT_KEY = '00000000-0000-4000-8000-000000000002'

const protectedApiRequests = [
  { method: 'DELETE', path: '/api/account' },
  { method: 'POST', path: '/api/account/export' },
  { method: 'POST', path: `/api/games/${GAME_ID}/case-export` },
  { method: 'GET', path: '/api/account/usage' },
  { method: 'POST', path: '/api/divide' },
  {
    method: 'GET',
    path: `/api/division-intents/${DIVISION_INTENT_KEY}`,
  },
  { method: 'GET', path: '/api/games/current' },
  { method: 'GET', path: `/api/games/${GAME_ID}` },
  { method: 'POST', path: `/api/games/${GAME_ID}/start` },
  { method: 'POST', path: `/api/games/${GAME_ID}/moves` },
  { method: 'POST', path: `/api/games/${GAME_ID}/answer` },
  { method: 'POST', path: `/api/games/${GAME_ID}/replay` },
  {
    method: 'POST',
    path: `/api/games/${GAME_ID}/abandon`,
  },
] as const

const authenticationErrors = {
  401: {
    code: 'authentication_required',
    message: 'Sign in to continue.',
  },
  503: {
    code: 'authentication_unavailable',
    message: 'Authentication is not configured in this environment.',
  },
} as const

function expectDirective(
  policy: string,
  directive: string,
  ...sources: string[]
): void {
  const value = policy
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry === directive || entry.startsWith(`${directive} `))

  expect(value, `Missing CSP directive: ${directive}`).toBeTruthy()
  for (const source of sources) {
    expect(value, `${directive} must allow ${source}`).toContain(source)
  }
}

test('documents emit the production browser security policy', async ({
  page,
}) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
  expect(response).not.toBeNull()

  const headers = response?.headers() ?? {}
  const policy = headers['content-security-policy'] ?? ''

  expectDirective(policy, 'default-src', "'self'")
  expectDirective(policy, 'base-uri', "'self'")
  expectDirective(policy, 'frame-ancestors', "'none'")
  expectDirective(policy, 'object-src', "'none'")
  expectDirective(
    policy,
    'connect-src',
    "'self'",
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://*.protect.clerk.com',
  )
  expectDirective(
    policy,
    'form-action',
    "'self'",
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
  )
  expectDirective(
    policy,
    'frame-src',
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://*.protect.clerk.com',
    'https://challenges.cloudflare.com',
  )
  expectDirective(
    policy,
    'script-src',
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://*.protect.clerk.com',
    'https://challenges.cloudflare.com',
  )
  expect(policy).not.toContain("'unsafe-eval'")

  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe(
    'strict-origin-when-cross-origin',
  )
  expect(headers['permissions-policy']).toContain('camera=()')
  expect(headers['permissions-policy']).toContain('geolocation=()')
  expect(headers['permissions-policy']).toContain('microphone=()')
  expect(headers['cross-origin-opener-policy']).toBe(
    'same-origin-allow-popups',
  )
  expect(headers['cross-origin-resource-policy']).toBe('same-origin')
  expect(headers['strict-transport-security']).toMatch(
    /(?:^|;\s*)max-age=(?:31536000|[4-9]\d{7,}|\d{9,})(?:;|$)/i,
  )
  expect(headers).not.toHaveProperty('x-powered-by')
})

test.describe('protected API authentication and response headers', () => {
  for (const apiRequest of protectedApiRequests) {
    test(`${apiRequest.method} ${apiRequest.path}`, async ({ request }) => {
      const response = await request.fetch(apiRequest.path, {
        method: apiRequest.method,
        failOnStatusCode: false,
        maxRedirects: 0,
      })
      const status = response.status()
      const expectedError =
        authenticationErrors[status as keyof typeof authenticationErrors]

      expect(
        expectedError,
        `${apiRequest.path} must reject an absent session before validating the request or invoking a service`,
      ).toBeDefined()
      expect(await response.json()).toEqual({
        error: expectedError,
      })

      const headers = response.headers()
      expect(headers['content-type']).toMatch(
        /^application\/json(?:;\s*charset=utf-8)?$/i,
      )
      expect(headers['cache-control'] ?? '').toMatch(
        /(?:^|,)\s*(?:private,\s*)?no-store(?:,|$)/i,
      )
      expect(headers.pragma).toBe('no-cache')
      expect(headers.expires).toBe('0')
      expect(headers['x-content-type-options']).toBe('nosniff')
      expect(headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    })
  }
})

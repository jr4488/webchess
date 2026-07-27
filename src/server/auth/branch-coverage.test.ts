import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authMock, headersMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  headersMock: vi.fn(),
  redirectMock: vi.fn((location: string) => {
    throw new Error(`redirect:${location}`)
  }),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: authMock,
}))

vi.mock('next/headers', () => ({
  headers: headersMock,
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

import { LOCAL_E2E_AUTH_HEADER } from './e2e'
import {
  getAuthenticatedUser,
  getRequestAuth,
  requirePageUser,
} from './session'
import { sanitizeReturnUrl } from './return-url'

const environmentKeys = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'WEBCHESS_E2E_AUTH',
  'WEBCHESS_E2E_USER_ID',
  'VERCEL',
  'VERCEL_ENV',
] as const

const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)

function restoreEnvironment(): void {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(() => {
  restoreEnvironment()
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  delete process.env.CLERK_SECRET_KEY
  delete process.env.WEBCHESS_E2E_AUTH
  delete process.env.WEBCHESS_E2E_USER_ID
  delete process.env.VERCEL
  delete process.env.VERCEL_ENV
  authMock.mockReset()
  headersMock.mockReset()
  redirectMock.mockClear()
})

afterEach(restoreEnvironment)

describe('implicit request authentication branches', () => {
  it('returns unavailable when current headers have no host', async () => {
    headersMock.mockResolvedValue(new Headers())

    await expect(getRequestAuth()).resolves.toEqual({ status: 'unavailable' })
    expect(authMock).not.toHaveBeenCalled()
  })

  it('returns unavailable when current headers contain a malformed host', async () => {
    headersMock.mockResolvedValue(new Headers({ host: '[' }))

    await expect(getRequestAuth()).resolves.toEqual({ status: 'unavailable' })
    expect(authMock).not.toHaveBeenCalled()
  })

  it('builds an implicit HTTP request and resolves the local E2E principal', async () => {
    process.env.WEBCHESS_E2E_AUTH = 'playwright'
    process.env.WEBCHESS_E2E_USER_ID = 'e2e_implicit_user'
    headersMock.mockResolvedValue(
      new Headers({
        host: 'localhost:3000',
        [LOCAL_E2E_AUTH_HEADER]: 'playwright',
      }),
    )

    await expect(getRequestAuth()).resolves.toEqual({
      status: 'authenticated',
      user: {
        userId: 'e2e_implicit_user',
        source: 'local-e2e',
      },
    })
  })

  it('accepts the first forwarded protocol value for an implicit request', async () => {
    process.env.WEBCHESS_E2E_AUTH = 'playwright'
    process.env.WEBCHESS_E2E_USER_ID = 'e2e_forwarded_user'
    headersMock.mockResolvedValue(
      new Headers({
        host: 'localhost:3000',
        'x-forwarded-proto': ' https , http ',
        [LOCAL_E2E_AUTH_HEADER]: 'playwright',
      }),
    )

    await expect(getRequestAuth()).resolves.toMatchObject({
      status: 'authenticated',
      user: { userId: 'e2e_forwarded_user' },
    })
  })
})

describe('authenticated user and page boundaries', () => {
  it('maps signed-out and authenticated request states to nullable users', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    authMock
      .mockResolvedValueOnce({ userId: null })
      .mockResolvedValueOnce({ userId: 'user_branch_123' })

    const request = new Request('https://webchess.example/account')

    await expect(getAuthenticatedUser(request)).resolves.toBeNull()
    await expect(getAuthenticatedUser(request)).resolves.toEqual({
      userId: 'user_branch_123',
      source: 'clerk',
    })
  })

  it('returns an authenticated page user with the default return URL', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    authMock.mockResolvedValue({ userId: 'user_page_123' })

    await expect(
      requirePageUser(undefined, new Request('https://webchess.example/play')),
    ).resolves.toEqual({
      userId: 'user_page_123',
      source: 'clerk',
    })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('redirects signed-out page requests to a sanitized sign-in path', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    authMock.mockResolvedValue({ userId: null })

    await expect(
      requirePageUser(
        '//attacker.example/steal',
        new Request('https://webchess.example/account'),
      ),
    ).rejects.toThrow('redirect:/sign-in?return_url=%2Fplay')
    expect(redirectMock).toHaveBeenCalledWith(
      '/sign-in?return_url=%2Fplay',
    )
  })
})

describe('return URL edge branches', () => {
  it('rejects a DEL control character in a candidate and fallback', () => {
    expect(sanitizeReturnUrl(`/account\u007fsettings`)).toBe('/play')
    expect(sanitizeReturnUrl(undefined, `/account\u007fsettings`)).toBe('/play')
  })

  it('uses a valid custom fallback for a non-string candidate', () => {
    expect(sanitizeReturnUrl(null, '/account?tab=usage')).toBe(
      '/account?tab=usage',
    )
  })
})

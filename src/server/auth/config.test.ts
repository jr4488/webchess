import { describe, expect, it } from 'vitest'

import {
  clerkAuthorizedParties,
  isClerkConfigured,
  isProtectedPagePath,
  removeUnsafeInlineScriptPolicy,
} from './config'

describe('isClerkConfigured', () => {
  it('requires both public and secret Clerk keys', () => {
    expect(
      isClerkConfigured({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
        CLERK_SECRET_KEY: 'sk_test_example',
      }),
    ).toBe(true)
    expect(
      isClerkConfigured({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      }),
    ).toBe(false)
    expect(
      isClerkConfigured({
        CLERK_SECRET_KEY: 'sk_test_example',
      }),
    ).toBe(false)
  })
})

describe('isProtectedPagePath', () => {
  it.each(['/account', '/account/usage'])(
    'protects %s',
    (pathname) => {
      expect(isProtectedPagePath(pathname)).toBe(true)
    },
  )

  it.each(['/', '/white-paper', '/play', '/play/resume', '/playbook', '/api/games'])(
    'does not classify %s as a protected page',
    (pathname) => {
      expect(isProtectedPagePath(pathname)).toBe(false)
    },
  )
})

describe('clerkAuthorizedParties', () => {
  it('uses only the exact resolved deployment origin', () => {
    expect(
      clerkAuthorizedParties({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'webchess-preview-abc.vercel.app',
      }),
    ).toEqual(['https://webchess-preview-abc.vercel.app'])

    expect(
      clerkAuthorizedParties({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: 'https://webchess.anansiportia.com',
      }),
    ).toEqual(['https://webchess.anansiportia.com'])
  })
})

describe('removeUnsafeInlineScriptPolicy', () => {
  it('removes unsafe-inline only from script-src', () => {
    expect(
      removeUnsafeInlineScriptPolicy(
        "default-src 'self'; script-src 'self' 'nonce-example' 'unsafe-inline' 'strict-dynamic'; style-src 'self' 'unsafe-inline'",
      ),
    ).toBe(
      "default-src 'self'; script-src 'self' 'nonce-example' 'strict-dynamic'; style-src 'self' 'unsafe-inline'",
    )
  })
})

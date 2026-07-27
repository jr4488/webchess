import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SignInPage from './sign-in/[[...sign-in]]/page'
import SignUpPage from './sign-up/[[...sign-up]]/page'

const clerkMocks = vi.hoisted(() => ({
  signIn: vi.fn(() => null),
  signUp: vi.fn(() => null),
}))

vi.mock('@clerk/nextjs', () => ({
  SignIn: clerkMocks.signIn,
  SignUp: clerkMocks.signUp,
}))

beforeEach(() => {
  clerkMocks.signIn.mockClear()
  clerkMocks.signUp.mockClear()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://webchess.example')
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_example')
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_example')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('auth page return destinations', () => {
  it('uses the app return_url first and carries it to sign-up', async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({
          redirect_url: 'https://webchess.example/play',
          return_url: '/account?tab=usage',
        }),
      }),
    )

    expect(clerkMocks.signIn).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: '/account?tab=usage',
        signUpUrl: '/sign-up?return_url=%2Faccount%3Ftab%3Dusage',
      }),
      undefined,
    )
  })

  it('accepts a same-site Clerk redirect and carries it to sign-in', async () => {
    render(
      await SignUpPage({
        searchParams: Promise.resolve({
          redirect_url:
            'https://webchess.example/account/security?from=play',
        }),
      }),
    )

    expect(clerkMocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: '/account/security?from=play',
        signInUrl:
          '/sign-in?return_url=%2Faccount%2Fsecurity%3Ffrom%3Dplay',
      }),
      undefined,
    )
  })

  it('uses the derived Vercel Preview origin for Clerk redirects', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'webchess-preview-abc.vercel.app')

    render(
      await SignInPage({
        searchParams: Promise.resolve({
          redirect_url:
            'https://webchess-preview-abc.vercel.app/account',
        }),
      }),
    )

    expect(clerkMocks.signIn).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: '/account',
        signUpUrl: '/sign-up?return_url=%2Faccount',
      }),
      undefined,
    )
  })

  it('does not pass an external Clerk redirect through either auth flow', async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({
          redirect_url: 'https://attacker.example/steal',
        }),
      }),
    )

    expect(clerkMocks.signIn).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRedirectUrl: '/play',
        signUpUrl: '/sign-up?return_url=%2Fplay',
      }),
      undefined,
    )
  })

  it('describes only the authentication methods Clerk actually renders', async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({}),
      }),
    )

    expect(
      screen.getByText(/option shown by clerk/i),
    ).toHaveTextContent(/google, verified-email, or enrolled-passkey/i)
    expect(screen.queryByText(/are configured in clerk/i)).not.toBeInTheDocument()

    render(
      await SignUpPage({
        searchParams: Promise.resolve({}),
      }),
    )

    expect(
      screen.getByText(/methods clerk shows/i),
    ).toHaveTextContent(/manage passkeys from your account/i)
  })
})

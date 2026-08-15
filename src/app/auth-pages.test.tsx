import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SignInPage from './sign-in/[[...sign-in]]/page'
import SignUpPage from './sign-up/[[...sign-up]]/page'

const clerkMocks = vi.hoisted(() => ({
  signIn: vi.fn(() => null),
  signUp: vi.fn(() => null),
}))
const nextMocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: '127.0.0.1:3005' })),
}))

vi.mock('@clerk/nextjs', () => ({
  SignIn: clerkMocks.signIn,
  SignUp: clerkMocks.signUp,
}))
vi.mock('next/headers', () => ({
  headers: nextMocks.headers,
}))

beforeEach(() => {
  clerkMocks.signIn.mockClear()
  clerkMocks.signUp.mockClear()
  nextMocks.headers.mockReset()
  nextMocks.headers.mockResolvedValue(
    new Headers({ host: '127.0.0.1:3005' }),
  )
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://webchess.example')
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_example')
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_example')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('auth page return destinations', () => {
  const enableLocalHostedAuth = () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3005')
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('CLERK_SECRET_KEY', '')
    vi.stubEnv('WEBCHESS_LOCAL_HOSTED_AUTH', 'true')
    vi.stubEnv(
      'WEBCHESS_LOCAL_SESSION_SECRET',
      'local-session-secret-material-that-is-stable-32b',
    )
  }

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

  it('renders the signed local-session action when Clerk is absent on loopback', async () => {
    enableLocalHostedAuth()

    const { unmount } = render(
      await SignInPage({
        searchParams: Promise.resolve({ return_url: '/account' }),
      }),
    )

    expect(nextMocks.headers).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: 'Continue on this machine' }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('/account')).toHaveAttribute(
      'name',
      'return_url',
    )
    unmount()

    render(
      await SignUpPage({
        searchParams: Promise.resolve({}),
      }),
    )
    expect(
      screen.getByRole('button', { name: 'Continue on this machine' }),
    ).toBeInTheDocument()
  })

  it.each([
    ['missing', new Headers()],
    ['malformed', new Headers({ host: '[' })],
  ])('fails closed when the Host header is %s', async (_case, requestHeaders) => {
    enableLocalHostedAuth()
    nextMocks.headers.mockResolvedValue(requestHeaders)

    const { unmount } = render(
      await SignInPage({ searchParams: Promise.resolve({}) }),
    )

    expect(screen.getByRole('heading', {
      name: 'Sign-in is not available here yet.',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: 'Continue on this machine',
    })).not.toBeInTheDocument()
    unmount()

    render(await SignUpPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', {
      name: 'Account creation is not available here yet.',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: 'Continue on this machine',
    })).not.toBeInTheDocument()
  })
})

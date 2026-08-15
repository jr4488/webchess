import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountDashboard } from './AccountDashboard'

const clerkMocks = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@clerk/nextjs', () => ({
  UserProfile: () => <div aria-label="Clerk user profile">Clerk settings</div>,
  useClerk: () => ({ signOut: clerkMocks.signOut }),
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: { delete: clerkMocks.deleteUser },
  }),
}))

const usagePayload = {
  usage: {
    period: {
      startsAt: '2026-07-26T00:00:00.000Z',
      endsAt: '2026-07-27T00:00:00.000Z',
    },
    modelOperations: {
      used: 3,
      reserved: 1,
      limit: 100,
      remaining: 96,
    },
    gameStarts: {
      used: 1,
      reserved: 0,
      limit: 2,
      remaining: 1,
    },
    activeModelRequests: 1,
  },
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function confirmAccountDeletion(): void {
  fireEvent.change(
    screen.getByLabelText(/type delete my webchess data/i),
    { target: { value: 'DELETE MY WEBCHESS DATA' } },
  )
  fireEvent.click(
    screen.getByRole('button', { name: /permanently delete my account/i }),
  )
}

describe('AccountDashboard', () => {
  beforeEach(() => {
    clerkMocks.deleteUser.mockReset()
    clerkMocks.signOut.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(usagePayload)),
    )
  })

  it('shows durable quotas, reservations, export, and the local fixture boundary', async () => {
    render(<AccountDashboard identityMode="local-e2e" />)

    expect(await screen.findByText(/3 used, 1 in progress of 100/i)).toBeInTheDocument()
    expect(screen.getByText(/active model requests/i)).toHaveTextContent('1')
    expect(
      screen.getByRole('button', { name: /download webchess data/i }),
    ).toBeEnabled()
    expect(screen.getByText(/synchronous, single-file export/i)).toHaveTextContent(
      /server-configured size limit capped at 100 MB.*oversized export is refused/i,
    )
    expect(screen.getByRole('link', { name: /^support$/i })).toHaveAttribute(
      'href',
      '/support',
    )
    expect(screen.getByText(/support does not promise/i)).toHaveTextContent(
      /custom data handoff or response time/i,
    )
    expect(screen.getByRole('heading', { name: /local test identity/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/clerk user profile/i)).not.toBeInTheDocument()
  })

  it('renders the signed local-hosted identity branch with loopback sign-out', async () => {
    render(<AccountDashboard identityMode="local-hosted" />)

    expect(await screen.findByRole('heading', { name: /local machine identity/i }))
      .toBeInTheDocument()
    expect(screen.getByText(/signed local principal for this computer/i))
      .toBeInTheDocument()
    const signOut = screen.getByRole('button', { name: /^sign out$/i })
    const form = signOut.closest('form')
    expect(form).toHaveAttribute('action', '/api/auth/local/sign-out')
    expect(form).toHaveAttribute('method', 'post')
    expect(screen.queryByLabelText(/clerk user profile/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /delete account/i }))
      .not.toBeInTheDocument()
  })

  it('downloads an account export through an origin-protected POST', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      if (input === '/api/account/export') {
        return new Response('{"games":[]}\n', {
          status: 200,
          headers: {
            'Content-Disposition':
              'attachment; filename="webchess-export-2026-07-27.json"',
            'Content-Type': 'application/json',
          },
        })
      }
      return jsonResponse(usagePayload)
    })
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:webchess-export')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    let clickedDownload: { download: string; href: string } | null = null
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedDownload = {
          download: this.download,
          href: this.href,
        }
      })

    render(<AccountDashboard identityMode="local-e2e" />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: /download webchess data/i,
      }),
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/account/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }),
    )
    expect(createObjectUrl).toHaveBeenCalledOnce()
    const exportedBlob = createObjectUrl.mock.calls[0]?.[0]
    expect(exportedBlob).toMatchObject({
      size: 13,
      type: 'application/json',
    })
    expect(click).toHaveBeenCalledOnce()
    expect(clickedDownload).toEqual({
      download: 'webchess-export-2026-07-27.json',
      href: 'blob:webchess-export',
    })
    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      60_000,
    )
    expect(revokeObjectUrl).not.toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
  })

  it('renders Clerk security controls for a production identity', async () => {
    render(<AccountDashboard identityMode="clerk" />)

    expect(await screen.findByLabelText(/clerk user profile/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    expect(clerkMocks.signOut).toHaveBeenCalledWith({ redirectUrl: '/' })
    expect(screen.getByText(/add or remove passkeys/i)).toBeInTheDocument()
  })

  it('deletes WebChess data before attempting Clerk identity deletion', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/account' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return jsonResponse(usagePayload)
    })
    clerkMocks.deleteUser.mockRejectedValue(new Error('self deletion disabled'))
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: vi.fn(() => 'f5db5ced-cb37-4db0-b0ca-0922c9cfb447'),
    })

    render(<AccountDashboard identityMode="clerk" />)

    fireEvent.change(
      screen.getByLabelText(/type delete my webchess data/i),
      { target: { value: 'DELETE MY WEBCHESS DATA' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: /permanently delete my account/i }),
    )

    await waitFor(() => expect(clerkMocks.deleteUser).toHaveBeenCalledTimes(1))

    const deletionRequest = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/account' && init?.method === 'DELETE',
    )
    expect(deletionRequest).toBeDefined()
    expect(deletionRequest?.[1]).toMatchObject({
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'f5db5ced-cb37-4db0-b0ca-0922c9cfb447',
      },
      body: JSON.stringify({ confirmation: 'DELETE MY WEBCHESS DATA' }),
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      /webchess data is deleted, but clerk did not delete/i,
    )
    expect(
      screen.getByRole('button', { name: /retry clerk identity deletion/i }),
    ).toBeEnabled()
  })

  it.each([
    [401, /session has ended/i],
    [503, /usage is temporarily unavailable/i],
  ])('renders the safe usage error for HTTP %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'internal detail' }, status)),
    )

    render(<AccountDashboard identityMode="local-e2e" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled()
  })

  it.each([
    null,
    {},
    { usage: null },
    {
      usage: {
        ...usagePayload.usage,
        modelOperations: null,
      },
    },
    {
      usage: {
        ...usagePayload.usage,
        activeModelRequests: -1,
      },
    },
  ])('rejects a malformed usage response without rendering quota data', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(payload)),
    )

    render(<AccountDashboard identityMode="local-e2e" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /usage service returned an unexpected response/i,
    )
    expect(screen.queryByText(/3 used, 1 in progress/i)).not.toBeInTheDocument()
  })

  it('retries a failed usage request and replaces the error with durable quotas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(usagePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(<AccountDashboard identityMode="local-e2e" />)

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText(/3 used, 1 in progress of 100/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts a pending usage retry when the dashboard unmounts', async () => {
    let retrySignal: AbortSignal | null = null
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockImplementationOnce((_input, init) => {
        retrySignal = init?.signal ?? null
        return new Promise<Response>(() => undefined)
      })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = render(<AccountDashboard identityMode="local-e2e" />)

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const capturedRetrySignal = (): AbortSignal => {
      if (!retrySignal) throw new Error('The retry did not receive an abort signal.')
      return retrySignal
    }
    expect(capturedRetrySignal().aborted).toBe(false)
    unmount()
    expect(capturedRetrySignal().aborted).toBe(true)
  })

  it('uses the raw reset value if the server returns an invalid date', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({
        usage: {
          ...usagePayload.usage,
          period: {
            ...usagePayload.usage.period,
            endsAt: 'not-a-date',
          },
        },
      })),
    )

    render(<AccountDashboard identityMode="local-e2e" />)

    expect(await screen.findByText('not-a-date')).toHaveAttribute(
      'dateTime',
      'not-a-date',
    )
  })

  it('uses a generic usage failure for a non-Error rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('network unavailable'))

    render(<AccountDashboard identityMode="local-e2e" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /usage is temporarily unavailable/i,
    )
  })

  it.each([
    [{ message: 'Deletion denied by policy.' }, 'Deletion denied by policy.'],
    [{ error: 'Deletion temporarily blocked.' }, 'Deletion temporarily blocked.'],
    [
      { message: 'x'.repeat(241), error: 'y'.repeat(241) },
      'WebChess could not delete your saved data.',
    ],
    [null, 'WebChess could not delete your saved data.'],
  ])('shows a bounded server deletion error', async (payload, message) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/account' && init?.method === 'DELETE') {
        return jsonResponse(payload, 400)
      }
      return jsonResponse(usagePayload)
    })

    render(<AccountDashboard identityMode="clerk" />)
    confirmAccountDeletion()

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(clerkMocks.deleteUser).not.toHaveBeenCalled()
  })

  it('falls back safely when a failed deletion response is not JSON', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/account' && init?.method === 'DELETE') {
        return new Response('{', { status: 500 })
      }
      return jsonResponse(usagePayload)
    })

    render(<AccountDashboard identityMode="clerk" />)
    confirmAccountDeletion()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not delete your saved data/i,
    )
  })

  it('uses a generic account-data failure for a non-Error rejection', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/account' && init?.method === 'DELETE') {
        throw 'network unavailable'
      }
      return jsonResponse(usagePayload)
    })

    render(<AccountDashboard identityMode="clerk" />)
    confirmAccountDeletion()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not delete your account data/i,
    )
  })

  it('retries only Clerk identity deletion after WebChess data is gone', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/account' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return jsonResponse(usagePayload)
    })
    clerkMocks.deleteUser.mockRejectedValue(new Error('self deletion disabled'))

    render(<AccountDashboard identityMode="clerk" />)
    confirmAccountDeletion()

    const retry = await screen.findByRole('button', {
      name: /retry clerk identity deletion/i,
    })
    fireEvent.click(retry)

    await waitFor(() =>
      expect(clerkMocks.deleteUser).toHaveBeenCalledTimes(2),
    )
    const deletionRequests = fetchMock.mock.calls.filter(
      ([input, init]) => input === '/api/account' && init?.method === 'DELETE',
    )
    expect(deletionRequests).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      /webchess data is deleted, but clerk did not delete/i,
    )
  })
})

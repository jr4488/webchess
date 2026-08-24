import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  requirePageUser: vi.fn(async () => ({ source: 'clerk' })),
}))

vi.mock('@/server/auth', () => ({
  requirePageUser: authMocks.requirePageUser,
}))

vi.mock('@/components/account/AccountDashboard', () => ({
  AccountDashboard: ({ identityMode }: { identityMode: string }) => (
    <div data-testid="account-data-controls" data-identity-mode={identityMode} />
  ),
}))

import AccountPage from './account/[[...account]]/page'
import NotFound from './not-found'

afterEach(() => {
  cleanup()
  authMocks.requirePageUser.mockClear()
})

describe('retired hosted runtime navigation', () => {
  it('sends 404 recovery to installation, not hosted play', () => {
    render(<NotFound />)

    expect(screen.getByRole('link', { name: 'Install WebChess' })).toHaveAttribute(
      'href',
      '/install',
    )
    expect(screen.queryByRole('link', { name: /play webchess/i })).not.toBeInTheDocument()
  })

  it('preserves account data controls while replacing the play breadcrumb', async () => {
    render(await AccountPage())

    expect(authMocks.requirePageUser).toHaveBeenCalledWith('/account')
    expect(screen.getByTestId('account-data-controls')).toHaveAttribute(
      'data-identity-mode',
      'clerk',
    )
    expect(screen.getByRole('link', { name: 'Install' })).toHaveAttribute(
      'href',
      '/install',
    )
    expect(screen.queryByRole('link', { name: 'Play' })).not.toBeInTheDocument()
  })
})

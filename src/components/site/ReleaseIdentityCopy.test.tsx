import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ResearchHome } from './ResearchHome'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const originalReleaseSha = process.env.WEBCHESS_RELEASE_SHA
const originalVercelSha = process.env.VERCEL_GIT_COMMIT_SHA

afterEach(() => {
  if (originalReleaseSha === undefined) delete process.env.WEBCHESS_RELEASE_SHA
  else process.env.WEBCHESS_RELEASE_SHA = originalReleaseSha
  if (originalVercelSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
  else process.env.VERCEL_GIT_COMMIT_SHA = originalVercelSha
})

describe('public release identity copy', () => {
  it('offers the local installation path from primary navigation', () => {
    render(<SiteHeader />)

    expect(screen.getByRole('link', { name: 'Install' })).toHaveAttribute(
      'href',
      '/install',
    )
    expect(screen.getByRole('link', { name: 'Run locally' })).toHaveAttribute(
      'href',
      '/install',
    )
  })

  it('fails closed when the immutable source commit is unresolved', () => {
    delete process.env.WEBCHESS_RELEASE_SHA
    delete process.env.VERCEL_GIT_COMMIT_SHA

    render(<SiteFooter />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Source identity pending',
    )
    expect(
      screen.queryByRole('link', { name: 'Immutable source' }),
    ).not.toBeInTheDocument()
  })

  it('does not let an environment SHA replace the resolved manifest', () => {
    process.env.WEBCHESS_RELEASE_SHA = SHA
    delete process.env.VERCEL_GIT_COMMIT_SHA

    render(<SiteFooter />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Source identity pending',
    )
    expect(
      screen.queryByRole('link', { name: 'Immutable source' }),
    ).not.toBeInTheDocument()
  })

  it('labels paper 3.0 as historical and sends readers to local installation', () => {
    delete process.env.WEBCHESS_RELEASE_SHA
    delete process.env.VERCEL_GIT_COMMIT_SHA

    render(<ResearchHome />)

    expect(screen.getByText(/historical audit document.*edition 3\.0/i)).toBeVisible()
    expect(
      screen.getByText(/0384978b2ba709da4c9824f2821c8623d3f84364/i),
    ).toBeVisible()
    expect(
      screen.getByRole('link', {
        name: /exact source 0384978b2ba709da4c9824f2821c8623d3f84364/i,
      }),
    ).toHaveAttribute(
      'href',
      'https://github.com/jr4488/webchess/tree/0384978b2ba709da4c9824f2821c8623d3f84364',
    )
    expect(
      screen.getByRole('link', { name: 'Run the candidate locally' }),
    ).toHaveAttribute('href', '/install')
  })
})

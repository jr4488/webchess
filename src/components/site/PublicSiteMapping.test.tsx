import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RELEASE_COMMIT = '0123456789abcdef0123456789abcdef01234567'
const RELEASE_SOURCE_URL =
  `https://github.com/jr4488/webchess/tree/${RELEASE_COMMIT}`

const releaseState = vi.hoisted(() => ({
  commit: null as string | null,
  sourceUrl: null as string | null,
}))

vi.mock('@/lib/release-source', () => ({
  configuredReleaseCommit: () => releaseState.commit,
  immutableReleaseSourceUrl: () => releaseState.sourceUrl,
}))

vi.mock('./AmbientWeb', () => ({
  AmbientWeb: () => <div data-testid="ambient-web" />,
}))

vi.mock('./EpisodePlayer', () => ({
  EpisodePlayer: () => <div data-testid="episode-player" />,
}))

import { ProductHome } from './ProductHome'
import { ResearchHome } from './ResearchHome'
import { SiteHeader } from './SiteHeader'

beforeEach(() => {
  releaseState.commit = null
  releaseState.sourceUrl = null
})

afterEach(() => {
  cleanup()
})

describe('public candidate mapping and method taxonomy', () => {
  it('uses a release-state-neutral Paper label in primary navigation', () => {
    render(<SiteHeader />)

    expect(screen.getByRole('link', { name: 'Paper' })).toHaveAttribute(
      'href',
      '/white-paper',
    )
  })

  it('names eight formal authorities and keeps Answer as a generated artifact', () => {
    const { container } = render(<ProductHome />)
    const lifecycle = container.querySelector('#lifecycle')

    expect(lifecycle).not.toBeNull()
    const scoped = within(lifecycle as HTMLElement)
    expect(
      scoped.getByRole('heading', {
        name: 'Eight formal authorities, one generated Answer artifact.',
      }),
    ).toBeVisible()
    expect(scoped.getByRole('heading', { name: 'Gate' })).toBeVisible()
    expect(scoped.getByRole('heading', { name: 'Retry' })).toBeVisible()
    expect(scoped.getByRole('heading', { name: 'Answer artifact' })).toBeVisible()
    expect(
      scoped.getByText('Generated artifact · not an authority'),
    ).toBeVisible()
    expect(
      [...(lifecycle?.querySelectorAll('.wc-authority') ?? [])].filter(
        (badge) => badge.textContent?.endsWith('authority') &&
          !badge.textContent?.includes('not an authority'),
      ),
    ).toHaveLength(8)
    expect(scoped.getByText(/Answer sits between a passed Gate and Charlotte/)).toHaveTextContent(
      'not a ninth authority',
    )
  })

  it('fails closed to historical paper 3.0 while release identity is unresolved', () => {
    render(<ProductHome />)

    expect(screen.getByText('Historical technical paper · edition 3.0')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Read historical paper 3.0' })).toHaveAttribute(
      'href',
      '/white-paper',
    )
    expect(screen.queryByRole('link', { name: 'Inspect exact source' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Download mapped PDF' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Source identity pending').length).toBeGreaterThan(0)
  })

  it('foregrounds mapped paper 3.1 and exact candidate identity when resolved', () => {
    releaseState.commit = RELEASE_COMMIT
    releaseState.sourceUrl = RELEASE_SOURCE_URL

    render(<ProductHome />)

    expect(screen.getByText('Mapped candidate paper · edition 3.1')).toBeVisible()
    expect(screen.getAllByText(RELEASE_COMMIT).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Inspect exact source' })).toHaveAttribute(
      'href',
      RELEASE_SOURCE_URL,
    )
    expect(screen.getByRole('link', { name: 'Download mapped PDF' })).toHaveAttribute(
      'href',
      '/downloads/webchess-white-paper.pdf',
    )
    expect(screen.getByRole('link', { name: 'Download historical PDF' })).toHaveAttribute(
      'href',
      '/downloads/webchess-white-paper-v3-historical.pdf',
    )

    cleanup()
    render(<ResearchHome />)

    expect(screen.getByText('Mapped candidate paper · edition 3.1')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Read mapped candidate edition 3.1' }),
    ).toHaveAttribute('href', '/white-paper')
    expect(
      screen.getByRole('link', { name: 'Read preserved historical edition 3.0' }),
    ).toHaveAttribute(
      'href',
      '/downloads/webchess-white-paper-v3-historical.html',
    )
    expect(
      screen.getByRole('link', { name: /Inspect exact source/ }),
    ).toHaveAttribute('href', RELEASE_SOURCE_URL)
    expect(
      screen.getAllByRole('link', { name: 'Verify release identity' }),
    ).not.toHaveLength(0)
  })
})

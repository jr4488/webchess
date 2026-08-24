import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownDocument } from './MarkdownDocument'

describe('MarkdownDocument', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders accessible document controls, headings, tables, formulas, and mapped links', () => {
    render(
      <MarkdownDocument
        sourceHref="/downloads/webchess-white-paper.md"
        sourceLabel="Download Markdown"
        downloads={[
          {
            href: '/downloads/webchess-white-paper.pdf',
            label: 'Download PDF',
          },
        ]}
        source={[
          '# Main & 42',
          '',
          '## Section *One*!',
          '',
          '### Nested heading',
          '',
          '[Home](README.md)',
          '',
          '[Install section](../INSTALL.md#requirements)',
          '',
          '[Architecture section](docs/ARCHITECTURE.md#invariants)',
          '',
          '[Operator guide](docs/WEBCHESS_2_0_OPERATIONS.md)',
          '',
          '[Current white paper](docs/WEBCHESS_WHITE_PAPER_V3.md)',
          '',
          '[Research program](docs/RESEARCH.md)',
          '',
          '[Terms section](docs/TERMS.md#limits)',
          '',
          '[Root link](/privacy)',
          '',
          '[Fragment link](#nested-heading)',
          '',
          '[External link](https://example.com)',
          '',
          '[Unknown relative link](notes.md)',
          '',
          '![A radial chessboard becoming a web](../public/white-paper/figures/arachne-cover-v3.jpg)',
          '',
          '| Name | Value |',
          '| --- | --- |',
          '| WebChess | 64 |',
          '',
          String.raw`\[`,
          'x = 8 \\times 8',
          String.raw`\]`,
          '',
          '$$',
          'y = x + 1',
          '$$',
          '',
          String.raw`Inline \(d,m\in\{0,\ldots,7\}\) and \(C_{req}\).`,
        ].join('\n')}
      />,
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute(
      'id',
      'main-42',
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Section One!' }),
    ).toHaveAttribute('id', 'section-one')
    expect(
      screen.getByRole('heading', { level: 3, name: 'Nested heading' }),
    ).toHaveAttribute('id', 'nested-heading')

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(
      screen.getByRole('link', { name: 'Install section' }),
    ).toHaveAttribute('href', '/install#requirements')
    expect(
      screen.getByRole('link', { name: 'Architecture section' }),
    ).toHaveAttribute(
      'href',
      '/white-paper#214-three-runtime-surfaces-three-separate-promises',
    )
    expect(screen.getByRole('link', { name: 'Operator guide' })).toHaveAttribute(
      'href',
      '/operations',
    )
    expect(
      screen.getByRole('link', { name: 'Current white paper' }),
    ).toHaveAttribute('href', '/white-paper')
    expect(
      screen.getAllByRole('link', { name: 'Research program' })[0],
    ).toHaveAttribute('href', '/white-paper#18-falsifiable-evaluation-program')
    expect(
      screen.getByRole('link', { name: 'Terms section' }),
    ).toHaveAttribute('href', '/terms#limits')
    expect(screen.getByRole('link', { name: 'Root link' })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(
      screen.getByRole('link', { name: 'Fragment link' }),
    ).toHaveAttribute('href', '#nested-heading')
    expect(
      screen.getByRole('link', { name: 'External link' }),
    ).toHaveAttribute('href', 'https://example.com')
    expect(
      screen.getByRole('link', { name: 'Unknown relative link' }),
    ).toHaveAttribute('href', 'notes.md')
    expect(
      screen.getByRole('img', { name: 'A radial chessboard becoming a web' }),
    ).toHaveAttribute('src', '/white-paper/figures/arachne-cover-v3.jpg')

    const tableRegion = screen.getByRole('region', {
      name: 'Scrollable table',
    })
    expect(tableRegion).toHaveAttribute('tabindex', '0')
    expect(within(tableRegion).getByRole('table')).toBeInTheDocument()

    const formulaRegions = screen.getAllByRole('region', {
      name: 'Scrollable code or formula',
    })
    expect(formulaRegions).toHaveLength(2)
    expect(formulaRegions[0]).toHaveAttribute('tabindex', '0')
    expect(formulaRegions[0]).toHaveTextContent('x = 8 × 8')
    expect(formulaRegions[1]).toHaveTextContent('y = x + 1')
    expect(screen.getByText('d,m∈{0,…,7}')).toBeInTheDocument()
    expect(screen.getByText('C_req')).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: 'Download Markdown' }),
    ).toHaveAttribute('download')
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'download',
    )
  })

  it('omits optional downloads and preserves an unclosed display expression', () => {
    render(
      <MarkdownDocument
        source={[
          '# Plain',
          '',
          String.raw`\[`,
          'unfinished expression',
        ].join('\n')}
      />,
    )

    expect(
      screen.queryByRole('link', { name: 'Download source' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/unfinished expression/)).toBeInTheDocument()
  })

  it('does not advertise the source archive without reviewed release identity', () => {
    vi.stubEnv('WEBCHESS_RELEASE_SHA', '')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')

    render(
      <MarkdownDocument
        source="# Policy"
        sourceHref="/downloads/webchess-source.zip"
      />,
    )

    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Source identity pending',
    )
    expect(
      screen.queryByRole('link', { name: 'Download source' }),
    ).not.toBeInTheDocument()
  })
})

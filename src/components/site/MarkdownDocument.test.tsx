import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownDocument } from './MarkdownDocument'

describe('MarkdownDocument', () => {
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
          '| Name | Value |',
          '| --- | --- |',
          '| WebChess | 64 |',
          '',
          String.raw`\[`,
          'x = 8 \\times 8',
          String.raw`\]`,
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
    ).toHaveAttribute('href', '/white-paper#4-system-architecture')
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

    const tableRegion = screen.getByRole('region', {
      name: 'Scrollable table',
    })
    expect(tableRegion).toHaveAttribute('tabindex', '0')
    expect(within(tableRegion).getByRole('table')).toBeInTheDocument()

    const formulaRegion = screen.getByRole('region', {
      name: 'Scrollable code or formula',
    })
    expect(formulaRegion).toHaveAttribute('tabindex', '0')
    expect(formulaRegion).toHaveTextContent('x = 8 \\times 8')

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
})

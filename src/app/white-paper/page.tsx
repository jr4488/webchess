import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadWhitePaper } from '@/content/documents/whitePaper'

export const metadata: Metadata = {
  title: 'The First Answer Is Not Enough — historical edition 3.0',
  description:
    'Historical edition 3.0 of the Arachne Method paper, mapped to the audited WebChess 0384978 source snapshot.',
}

const DOWNLOADS = [
  { href: '/downloads/webchess-white-paper-v3-historical.md', label: 'Download historical Markdown' },
  { href: '/downloads/webchess-white-paper-v3-historical.html', label: 'Download historical HTML' },
  { href: '/downloads/webchess-white-paper-v3-historical.pdf', label: 'Download historical PDF' },
] as const

export default async function WhitePaperPage() {
  const source = await loadWhitePaper()

  return (
    <MarkdownDocument
      downloads={DOWNLOADS}
      source={[
        '> **Historical audit edition 3.0.** This preserved manuscript maps to [immutable WebChess source `0384978b2ba709da4c9824f2821c8623d3f84364`](https://github.com/jr4488/webchess/tree/0384978b2ba709da4c9824f2821c8623d3f84364). It is not the unresolved edition 3.1/code-freeze release mapping and does not claim validated efficacy.',
        '',
        source,
      ].join('\n')}
    />
  )
}

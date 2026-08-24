import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import {
  loadCandidateWhitePaper,
  loadWhitePaper,
} from '@/content/documents/whitePaper'
import { immutableReleaseSourceUrl } from '@/lib/release-source'

export function generateMetadata(): Metadata {
  return immutableReleaseSourceUrl()
    ? {
        title: 'The Arachne Method and WebChess — edition 3.1',
        description:
          'The code-freeze-mapped replication companion for the WebChess 2.2.0-rc.1 research instrument.',
      }
    : {
        title: 'The First Answer Is Not Enough — historical edition 3.0',
        description:
          'Historical edition 3.0 of the Arachne Method paper, mapped to the audited WebChess 0384978 source snapshot.',
      }
}

const CANDIDATE_DOWNLOADS = [
  { href: '/downloads/webchess-white-paper.md', label: 'Download mapped Markdown' },
  { href: '/downloads/webchess-white-paper.html', label: 'Download mapped HTML' },
  { href: '/downloads/webchess-white-paper.pdf', label: 'Download mapped PDF' },
] as const

const HISTORICAL_DOWNLOADS = [
  { href: '/downloads/webchess-white-paper-v3-historical.md', label: 'Download historical Markdown' },
  { href: '/downloads/webchess-white-paper-v3-historical.html', label: 'Download historical HTML' },
  { href: '/downloads/webchess-white-paper-v3-historical.pdf', label: 'Download historical PDF' },
] as const

export default async function WhitePaperPage() {
  const immutableSourceUrl = immutableReleaseSourceUrl()
  const source = immutableSourceUrl
    ? await loadCandidateWhitePaper()
    : await loadWhitePaper()

  return (
    <MarkdownDocument
      downloads={immutableSourceUrl ? CANDIDATE_DOWNLOADS : HISTORICAL_DOWNLOADS}
      source={immutableSourceUrl
        ? [
            `> **Code-freeze-mapped edition 3.1.** This implementation companion maps to [the exact reviewed WebChess source](${immutableSourceUrl}) through the resolved release identity. It reports no validated efficacy.`,
            '',
            source,
          ].join('\n')
        : [
            '> **HISTORICAL AND RETIRED — not installation or runtime instructions.** This byte-preserved edition 3.0 manuscript maps to [immutable WebChess source `0384978b2ba709da4c9824f2821c8623d3f84364`](https://github.com/jr4488/webchess/tree/0384978b2ba709da4c9824f2821c8623d3f84364). Its runtime, migration, research, and status claims apply only to that snapshot. Use the current `INSTALL.md` account-authenticated OpenClaw path; provider keys/tokens and non-OpenClaw principals fail closed. Edition 3.1 remains unpublished until the code-freeze release identity resolves. Neither paper claims validated efficacy.',
            '',
            source,
          ].join('\n')}
    />
  )
}

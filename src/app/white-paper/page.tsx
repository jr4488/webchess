import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadWhitePaper } from '@/content/documents/whitePaper'

export const metadata: Metadata = {
  title: 'The First Answer Is Not Enough',
  description:
    'The Arachne Method: an architecture for AI-assisted deliberation before decision, with a complete WebChess implementation audit and falsifiable research agenda.',
}

const DOWNLOADS = [
  { href: '/downloads/webchess-white-paper.md', label: 'Download Markdown' },
  { href: '/downloads/webchess-white-paper.html', label: 'Download HTML' },
  { href: '/downloads/webchess-white-paper.pdf', label: 'Download PDF' },
] as const

export default async function WhitePaperPage() {
  const source = await loadWhitePaper()

  return (
    <MarkdownDocument
      downloads={DOWNLOADS}
      source={source}
    />
  )
}

import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadWhitePaper } from '@/content/documents/whitePaper'

export const metadata: Metadata = {
  title: 'White paper',
  description:
    'The complete WebChess method, evidence standard, circular-chess rules, limitations, and research agenda.',
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

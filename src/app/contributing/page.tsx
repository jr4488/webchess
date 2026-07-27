import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadContributing } from '@/content/documents/contributing'

export const metadata: Metadata = {
  title: 'Contributing',
  description:
    'How to contribute code, documentation, accessibility improvements, and reproducible research to WebChess.',
}

export default async function ContributingPage() {
  const source = await loadContributing()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-source.zip"
      sourceLabel="Download source archive"
    />
  )
}

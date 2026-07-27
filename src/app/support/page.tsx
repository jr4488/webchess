import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadSupport } from '@/content/documents/support'

export const metadata: Metadata = {
  title: 'Support',
  description:
    'Get WebChess help through GitHub Discussions, report reproducible defects, or disclose a vulnerability privately.',
}

export default async function SupportPage() {
  const source = await loadSupport()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-source.zip"
      sourceLabel="Download source archive"
    />
  )
}

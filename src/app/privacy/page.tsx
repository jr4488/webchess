import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadPrivacy } from '@/content/documents/privacy'

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What the hosted WebChess service processes, why it is needed, and how users control stored game data.',
}

export default async function PrivacyPage() {
  const source = await loadPrivacy()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-source.zip"
      sourceLabel="Download source archive"
    />
  )
}

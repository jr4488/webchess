import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadPrivacy } from '@/content/documents/privacy'

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What the local WebChess research candidate processes through OpenClaw and loopback PostgreSQL, with retained hosted code documented only for audit.',
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

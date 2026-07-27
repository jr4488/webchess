import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadAcceptableUse } from '@/content/documents/acceptableUse'

export const metadata: Metadata = {
  title: 'Acceptable use',
  description:
    'The WebChess rules for lawful, safe use and responsible security research.',
}

export default async function AcceptableUsePage() {
  const source = await loadAcceptableUse()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-source.zip"
      sourceLabel="Download source archive"
    />
  )
}

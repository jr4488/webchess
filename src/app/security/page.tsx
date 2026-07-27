import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadSecurity } from '@/content/documents/security'

export const metadata: Metadata = {
  title: 'Security',
  description:
    'WebChess security boundaries and the private process for reporting vulnerabilities.',
}

export default async function SecurityPage() {
  const source = await loadSecurity()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-source.zip"
      sourceLabel="Download source archive"
    />
  )
}

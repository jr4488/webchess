import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadTerms } from '@/content/documents/terms'

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'Terms for the local WebChess research candidate and its account-authenticated OpenClaw path.',
}

export default async function TermsPage() {
  const source = await loadTerms()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-source.zip"
      sourceLabel="Download source archive"
    />
  )
}

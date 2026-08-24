import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadInstall } from '@/content/documents/install'

export const metadata: Metadata = {
  title: 'Install',
  description:
    'Run WebChess locally through OpenClaw with OpenAI account OAuth and PostgreSQL 17; provider API keys and tokens are rejected.',
}

export default async function InstallPage() {
  const source = await loadInstall()

  return (
    <MarkdownDocument
      source={source}
      sourceHref="/downloads/webchess-installation.md"
      sourceLabel="Download source"
    />
  )
}

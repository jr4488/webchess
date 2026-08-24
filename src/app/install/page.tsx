import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadInstall } from '@/content/documents/install'

export const metadata: Metadata = {
  title: 'Install',
  description:
    'Run WebChess locally through OpenClaw with OpenAI account OAuth and PostgreSQL 17; no WebChess-side OPENAI_API_KEY is required.',
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

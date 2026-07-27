import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadInstall } from '@/content/documents/install'

export const metadata: Metadata = {
  title: 'Install',
  description:
    'Install WebChess locally or prepare a dedicated Clerk, Neon, OpenAI, and Vercel deployment.',
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

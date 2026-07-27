import type { Metadata } from 'next'

import { TextDocument } from '@/components/site/TextDocument'
import { loadLicense } from '@/content/documents/license'

export const metadata: Metadata = {
  title: 'Apache-2.0 license',
  description: 'The Apache License 2.0 terms governing the WebChess source code.',
}

export default async function LicensePage() {
  const source = await loadLicense()

  return (
    <TextDocument
      downloadHref="/downloads/LICENSE"
      source={source}
      title="Apache License 2.0"
    />
  )
}

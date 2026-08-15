import type { Metadata } from 'next'

import { MarkdownDocument } from '@/components/site/MarkdownDocument'
import { loadOperations } from '@/content/documents/operations'

export const metadata: Metadata = {
  title: 'Operator guide',
  description:
    'Operate, observe, recover, and roll back the durable WebChess 2.2 lifecycle safely.',
}

export default async function OperationsPage() {
  const source = await loadOperations()

  return <MarkdownDocument source={source} />
}

import type { Metadata } from 'next'

import { ProductHome } from '@/components/site/ProductHome'

export const metadata: Metadata = {
  title: 'Move past the first answer',
  description:
    'WebChess is a rule-governed deliberative layer for AI: 64 perspectives, circular conflict, adversarial testing, deterministic refusal, reversible action, and durable provenance.',
  openGraph: {
    title: 'WebChess — Move past the first answer',
    description:
      'A stateful, auditable deliberative layer for difficult questions and foundation models.',
    type: 'website',
  },
}

export default function HomePage() {
  return <ProductHome />
}

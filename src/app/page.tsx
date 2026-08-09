import type { Metadata } from 'next'

import { ProductHome } from '@/components/site/ProductHome'

export const metadata: Metadata = {
  title: 'Every question arrives wrapped in its first frame',
  description:
    'WebChess is deliberative middleware for foundation models: 64 candidate perspectives, seeded symbolic casting, circular-chess traversal, adversarial review, deterministic refusal, reversible action, and durable provenance.',
  openGraph: {
    title: 'WebChess — Cut the question loose from its first frame',
    description:
      'An external computational institution for difficult questions and foundation models.',
    type: 'website',
  },
}

export default function HomePage() {
  return <ProductHome />
}

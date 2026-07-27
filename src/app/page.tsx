import type { Metadata } from 'next'

import { ProductHome } from '@/components/site/ProductHome'

export const metadata: Metadata = {
  title: 'Circular chess for difficult questions',
  description:
    'Divide a difficult question into 64 perspectives, play the complete circular-chess game, and turn its capture trail into practical next moves.',
}

export default function HomePage() {
  return <ProductHome />
}

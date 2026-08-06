import type { Metadata } from 'next'

import { ResearchHome } from '@/components/site/ResearchHome'

export const metadata: Metadata = {
  title: 'Research',
  description:
    'The WebChess white paper, implementation, safety posture, intellectual lineage, and falsifiable evaluation program.',
}

export default function ResearchPage() {
  return <ResearchHome />
}

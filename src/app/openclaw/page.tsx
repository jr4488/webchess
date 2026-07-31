import type { Metadata } from 'next'

import { OpenClawApp } from '@/App'

export const metadata: Metadata = {
  title: 'Local OpenClaw',
  robots: {
    index: false,
    follow: false,
  },
}

export default function OpenClawPage() {
  return <OpenClawApp />
}

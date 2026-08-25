import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OpenClawApp } from '@/App'
import { resolveOpenClawReleaseIdentity } from '@/lib/openclaw-release-identity'
import { isOpenClawLocalModeEnabled } from '@/server/openclaw/config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Local OpenClaw',
  robots: {
    index: false,
    follow: false,
  },
}

export default function OpenClawPage() {
  if (!isOpenClawLocalModeEnabled()) {
    notFound()
  }
  return (
    <OpenClawApp
      releaseIdentity={resolveOpenClawReleaseIdentity()}
    />
  )
}

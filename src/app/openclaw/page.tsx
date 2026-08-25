import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { OpenClawApp } from '@/App'
import type { OpenClawReleaseIdentity } from '@/components/OpenClawReleaseIdentity'
import {
  configuredReleaseCommit,
  loadPublicReleaseIdentity,
  type PublicReleaseIdentity,
} from '@/lib/release-source'
import { isOpenClawLocalModeEnabled } from '@/server/openclaw/config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Local OpenClaw',
  robots: {
    index: false,
    follow: false,
  },
}

type ReleaseEnvironment = Readonly<{
  VERCEL_GIT_COMMIT_SHA?: string
  WEBCHESS_RELEASE_SHA?: string
}>

export function resolveOpenClawReleaseIdentity(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
  identity: PublicReleaseIdentity | null = loadPublicReleaseIdentity(),
): OpenClawReleaseIdentity | null {
  if (!identity) return null

  return {
    softwareVersion: identity.release.version,
    sourceCommit: configuredReleaseCommit(environment, identity),
    methodVersions: identity.release.methodVersions,
  }
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

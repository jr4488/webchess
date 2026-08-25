import 'server-only'

import type { OpenClawReleaseIdentity } from '../components/OpenClawReleaseIdentity'
import {
  configuredReleaseCommit,
  loadPublicReleaseIdentity,
  type PublicReleaseIdentity,
} from './release-source'

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

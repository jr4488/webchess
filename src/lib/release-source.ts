import 'server-only'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RELEASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u

export const WEBCHESS_REPOSITORY_URL =
  'https://github.com/jr4488/webchess' as const

type ReleaseEnvironment = Readonly<{
  VERCEL_GIT_COMMIT_SHA?: string
  WEBCHESS_RELEASE_SHA?: string
}>

export interface PublicReleaseIdentity {
  readonly schema: 'webchess-release-identity/1'
  readonly status: 'resolved'
  readonly release: {
    readonly version: '2.2.0-rc.1'
  }
  readonly source: {
    readonly repository: typeof WEBCHESS_REPOSITORY_URL
    readonly commit: string
    readonly archive: {
      readonly downloadPath: string
      readonly sha256: string
    }
  }
  readonly paper: {
    readonly candidate: {
      readonly edition: '3.1'
      readonly repositoryPath: string
      readonly pdf: {
        readonly downloadPath: '/downloads/webchess-white-paper.pdf'
        readonly sha256: string
      }
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parsePublicReleaseIdentity(
  value: unknown,
): PublicReleaseIdentity | null {
  const identity = record(value)
  const release = record(identity?.release)
  const source = record(identity?.source)
  const archive = record(source?.archive)
  const paper = record(identity?.paper)
  const candidate = record(paper?.candidate)
  const pdf = record(candidate?.pdf)
  const commit = typeof source?.commit === 'string'
    ? source.commit.toLowerCase()
    : ''
  const expectedArchivePath = `/downloads/webchess-source-${commit}.zip`

  if (
    identity?.schema !== 'webchess-release-identity/1' ||
    identity.status !== 'resolved' ||
    release?.version !== '2.2.0-rc.1' ||
    source?.repository !== WEBCHESS_REPOSITORY_URL ||
    !RELEASE_COMMIT_PATTERN.test(commit) ||
    source.commit !== commit ||
    archive?.downloadPath !== expectedArchivePath ||
    typeof archive.sha256 !== 'string' ||
    !SHA256_PATTERN.test(archive.sha256) ||
    candidate?.edition !== '3.1' ||
    typeof candidate.repositoryPath !== 'string' ||
    !candidate.repositoryPath.startsWith('docs/') ||
    !candidate.repositoryPath.endsWith('.md') ||
    candidate.repositoryPath.includes('..') ||
    pdf?.downloadPath !== '/downloads/webchess-white-paper.pdf' ||
    typeof pdf.sha256 !== 'string' ||
    !SHA256_PATTERN.test(pdf.sha256)
  ) {
    return null
  }

  return value as PublicReleaseIdentity
}

export function loadPublicReleaseIdentity(
  path = join(
    process.cwd(),
    'public',
    'downloads',
    'webchess-release-identity.json',
  ),
): PublicReleaseIdentity | null {
  try {
    return parsePublicReleaseIdentity(
      JSON.parse(readFileSync(path, 'utf8')),
    )
  } catch {
    return null
  }
}

/**
 * Resolve only a manifest-bound, explicitly reviewed full release commit.
 * Deployment metadata corroborates that identity but never creates one;
 * public links never fall back to a branch, tag, or abbreviated SHA.
 */
export function configuredReleaseCommit(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
  identity: PublicReleaseIdentity | null = loadPublicReleaseIdentity(),
): string | null {
  const reviewed = environment.WEBCHESS_RELEASE_SHA?.trim().toLowerCase()
  const deployed = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase()

  if (
    !identity ||
    !reviewed ||
    !RELEASE_COMMIT_PATTERN.test(reviewed) ||
    reviewed !== identity.source.commit
  ) {
    return null
  }

  if (
    deployed &&
    (!RELEASE_COMMIT_PATTERN.test(deployed) || deployed !== reviewed)
  ) {
    return null
  }

  return reviewed
}

export function immutableReleaseSourceUrl(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
  identity: PublicReleaseIdentity | null = loadPublicReleaseIdentity(),
): string | null {
  const commit = configuredReleaseCommit(environment, identity)
  return commit ? `${WEBCHESS_REPOSITORY_URL}/tree/${commit}` : null
}

export function retainedReleaseArchivePath(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
  identity: PublicReleaseIdentity | null = loadPublicReleaseIdentity(),
): string | null {
  return configuredReleaseCommit(environment, identity)
    ? identity?.source.archive.downloadPath ?? null
    : null
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { GITHUB_REPOSITORY_URL } from './routes'

const releaseCommitPattern = /^[a-f0-9]{40}$/u
const sha256Pattern = /^[a-f0-9]{64}$/u

interface ReleaseIdentityFile {
  readonly schema?: unknown
  readonly status?: unknown
  readonly release?: {
    readonly version?: unknown
  }
  readonly dependencies?: {
    readonly codexSearch?: {
      readonly apiKeyFallback?: unknown
      readonly authPolicy?: unknown
      readonly npmIntegrity?: unknown
      readonly package?: unknown
      readonly provider?: unknown
      readonly transport?: unknown
      readonly version?: unknown
    }
  }
  readonly source?: {
    readonly repository?: unknown
    readonly commit?: unknown
    readonly archive?: {
      readonly downloadPath?: unknown
      readonly sha256?: unknown
    }
  }
  readonly paper?: {
    readonly candidate?: {
      readonly edition?: unknown
      readonly repositoryPath?: unknown
      readonly pdf?: {
        readonly downloadPath?: unknown
        readonly sha256?: unknown
      }
    }
  }
}

export interface ExpectedPublicRelease {
  readonly archivePath: string
  readonly commit: string
  readonly identityPath: '/downloads/webchess-release-identity.json'
  readonly sourceUrl: string
}

/**
 * Mirror the public release gate closely enough for browser expectations.
 * A deployment SHA can corroborate the reviewed release, but only a matching
 * generated identity plus WEBCHESS_RELEASE_SHA resolves public source links.
 */
export function expectedPublicRelease(
  environment: NodeJS.ProcessEnv = process.env,
): ExpectedPublicRelease | null {
  const reviewed = environment.WEBCHESS_RELEASE_SHA?.trim().toLowerCase()
  const deployed = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase()

  if (!reviewed || !releaseCommitPattern.test(reviewed)) {
    return null
  }

  if (
    deployed &&
    (!releaseCommitPattern.test(deployed) || deployed !== reviewed)
  ) {
    return null
  }

  let identity: ReleaseIdentityFile
  try {
    identity = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          'public',
          'downloads',
          'webchess-release-identity.json',
        ),
        'utf8',
      ),
    ) as ReleaseIdentityFile
  } catch {
    return null
  }

  const archivePath = identity.source?.archive?.downloadPath
  const candidatePath = identity.paper?.candidate?.repositoryPath
  if (
    identity.schema !== 'webchess-release-identity/1' ||
    identity.status !== 'resolved' ||
    identity.release?.version !== '2.2.0-rc.1' ||
    identity.source?.repository !== GITHUB_REPOSITORY_URL ||
    identity.source.commit !== reviewed ||
    archivePath !== `/downloads/webchess-source-${reviewed}.zip` ||
    typeof identity.source.archive?.sha256 !== 'string' ||
    !sha256Pattern.test(identity.source.archive.sha256) ||
    identity.paper?.candidate?.edition !== '3.1' ||
    typeof candidatePath !== 'string' ||
    !candidatePath.startsWith('docs/') ||
    !candidatePath.endsWith('.md') ||
    candidatePath.includes('..') ||
    identity.paper.candidate.pdf?.downloadPath !==
      '/downloads/webchess-white-paper.pdf' ||
    typeof identity.paper.candidate.pdf.sha256 !== 'string' ||
    !sha256Pattern.test(identity.paper.candidate.pdf.sha256) ||
    identity.dependencies?.codexSearch?.package !== '@openclaw/codex' ||
    identity.dependencies.codexSearch.version !== '2026.7.1-1' ||
    identity.dependencies.codexSearch.npmIntegrity !==
      'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==' ||
    identity.dependencies.codexSearch.provider !== 'codex' ||
    identity.dependencies.codexSearch.authPolicy !==
      'same-openai-account-oauth' ||
    identity.dependencies.codexSearch.transport !==
      'managed-private-stdio-agent-scoped' ||
    identity.dependencies.codexSearch.apiKeyFallback !== false
  ) {
    return null
  }

  return {
    archivePath,
    commit: reviewed,
    identityPath: '/downloads/webchess-release-identity.json',
    sourceUrl: `${GITHUB_REPOSITORY_URL}/tree/${reviewed}`,
  }
}

import { describe, expect, it } from 'vitest'

import type { PublicReleaseIdentity } from '@/lib/release-source'

import { resolveOpenClawReleaseIdentity } from './page'

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567'
const MANIFEST = {
  schema: 'webchess-release-identity/1',
  status: 'resolved',
  release: {
    version: '2.2.0-rc.1',
  },
  source: {
    repository: 'https://github.com/jr4488/webchess',
    commit: SOURCE_COMMIT,
    archive: {
      downloadPath: `/downloads/webchess-source-${SOURCE_COMMIT}.zip`,
      sha256: 'a'.repeat(64),
    },
  },
  paper: {
    candidate: {
      edition: '3.1',
      repositoryPath: 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md',
      pdf: {
        downloadPath: '/downloads/webchess-white-paper.pdf',
        sha256: 'b'.repeat(64),
      },
    },
  },
  dependencies: {
    codexSearch: {
      package: '@openclaw/codex',
      version: '2026.7.1-1',
      npmIntegrity:
        'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==',
      provider: 'codex',
      authPolicy: 'same-openai-account-oauth',
      transport: 'managed-private-stdio-agent-scoped',
      apiKeyFallback: false,
    },
  },
} satisfies PublicReleaseIdentity

describe('local OpenClaw release identity resolution', () => {
  it('passes the manifest release only when the full launcher SHA corroborates it', () => {
    expect(resolveOpenClawReleaseIdentity({
      WEBCHESS_RELEASE_SHA: SOURCE_COMMIT,
    }, MANIFEST)).toEqual({
      softwareVersion: '2.2.0-rc.1',
      sourceCommit: SOURCE_COMMIT,
    })
  })

  it('retains the software label but fails the source commit closed on mismatch', () => {
    expect(resolveOpenClawReleaseIdentity({
      WEBCHESS_RELEASE_SHA: 'f'.repeat(40),
    }, MANIFEST)).toEqual({
      softwareVersion: '2.2.0-rc.1',
      sourceCommit: null,
    })
  })

  it('labels all release identity unavailable without a resolved manifest', () => {
    expect(resolveOpenClawReleaseIdentity({
      WEBCHESS_RELEASE_SHA: SOURCE_COMMIT,
    }, null)).toBeNull()
  })
})

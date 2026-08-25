import { describe, expect, it } from 'vitest'

import { CURRENT_METHOD_VERSION_TUPLE } from '@/lib/lifecycle/method-versions.mjs'
import { parsePublicReleaseIdentity } from '@/lib/release-source'
import { sourceArchiveResponse } from './route'

const SHA = '0123456789abcdef0123456789abcdef01234567'

function identity() {
  const parsed = parsePublicReleaseIdentity({
    schema: 'webchess-release-identity/1',
    status: 'resolved',
    release: {
      version: '2.2.0-rc.1',
      methodVersions: { ...CURRENT_METHOD_VERSION_TUPLE },
    },
    source: {
      repository: 'https://github.com/jr4488/webchess',
      commit: SHA,
      archive: {
        downloadPath: `/downloads/webchess-source-${SHA}.zip`,
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
  })
  if (!parsed) throw new Error('Invalid release identity test fixture.')
  return parsed
}

describe('source archive download', () => {
  it('redirects to the retained commit-addressed artifact only when all identities match', () => {
    const response = sourceArchiveResponse({
      environment: {
        WEBCHESS_RELEASE_SHA: SHA,
        VERCEL_GIT_COMMIT_SHA: SHA,
      },
      identity: identity(),
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      `/downloads/webchess-source-${SHA}.zip`,
    )
    expect(response.headers.get('location')).not.toContain('github.com')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    {
      environment: { WEBCHESS_RELEASE_SHA: SHA },
      identity: null,
    },
    {
      environment: { VERCEL_GIT_COMMIT_SHA: SHA },
      identity: identity(),
    },
    {
      environment: {
        WEBCHESS_RELEASE_SHA: SHA,
        VERCEL_GIT_COMMIT_SHA:
          'fedcba9876543210fedcba9876543210fedcba98',
      },
      identity: identity(),
    },
  ])('fails closed for missing, implicit, or conflicting identity', async (fixture) => {
    const response = sourceArchiveResponse(fixture)

    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RELEASE_IDENTITY_UNAVAILABLE' },
    })
  })
})

import { describe, expect, it } from 'vitest'

import { CURRENT_METHOD_VERSION_TUPLE } from './lifecycle/method-versions.mjs'
import {
  configuredReleaseCommit,
  immutableReleaseSourceUrl,
  parsePublicReleaseIdentity,
  retainedReleaseArchivePath,
} from './release-source'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const CODEX_SEARCH_DEPENDENCY = {
  package: '@openclaw/codex',
  version: '2026.7.1-1',
  npmIntegrity:
    'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==',
  provider: 'codex',
  authPolicy: 'same-openai-account-oauth',
  transport: 'managed-private-stdio-agent-scoped',
  apiKeyFallback: false,
} as const

function identity(overrides: Record<string, unknown> = {}) {
  return {
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
      codexSearch: CODEX_SEARCH_DEPENDENCY,
    },
    ...overrides,
  }
}

function identityWithCodexSearch(
  overrides: Record<string, unknown>,
) {
  return identity({
    dependencies: {
      codexSearch: {
        ...CODEX_SEARCH_DEPENDENCY,
        ...overrides,
      },
    },
  })
}

describe('immutable release source identity', () => {
  it('requires the resolved manifest and explicit release commit to agree', () => {
    const parsed = parsePublicReleaseIdentity(identity())
    expect(parsed).not.toBeNull()
    expect(configuredReleaseCommit({ WEBCHESS_RELEASE_SHA: SHA }, parsed)).toBe(SHA)
    expect(immutableReleaseSourceUrl({ WEBCHESS_RELEASE_SHA: SHA }, parsed)).toBe(
      `https://github.com/jr4488/webchess/tree/${SHA}`,
    )
    expect(retainedReleaseArchivePath({ WEBCHESS_RELEASE_SHA: SHA }, parsed)).toBe(
      `/downloads/webchess-source-${SHA}.zip`,
    )
  })

  it('accepts matching explicit, manifest, and deployment commits', () => {
    const parsed = parsePublicReleaseIdentity(identity())
    expect(configuredReleaseCommit({
      WEBCHESS_RELEASE_SHA: SHA.toUpperCase(),
      VERCEL_GIT_COMMIT_SHA: SHA,
    }, parsed)).toBe(SHA)
  })

  it.each([
    {},
    { VERCEL_GIT_COMMIT_SHA: SHA },
    { WEBCHESS_RELEASE_SHA: 'main' },
    { WEBCHESS_RELEASE_SHA: SHA.slice(0, 12) },
    {
      WEBCHESS_RELEASE_SHA: SHA,
      VERCEL_GIT_COMMIT_SHA: 'fedcba9876543210fedcba9876543210fedcba98',
    },
  ])('fails closed for implicit, missing, mutable, abbreviated, or conflicting environment identity', (environment) => {
    const parsed = parsePublicReleaseIdentity(identity())
    expect(configuredReleaseCommit(environment, parsed)).toBeNull()
    expect(immutableReleaseSourceUrl(environment, parsed)).toBeNull()
  })

  it('does not allow environment metadata to replace a manifest', () => {
    expect(configuredReleaseCommit({ WEBCHESS_RELEASE_SHA: SHA }, null)).toBeNull()
    expect(immutableReleaseSourceUrl({ WEBCHESS_RELEASE_SHA: SHA }, null)).toBeNull()
  })

  it.each([
    ['package', '@openclaw/codex-next'],
    ['version', '2026.7.1'],
    ['npmIntegrity', 'sha512-unreviewed'],
    ['provider', 'alternate'],
    ['authPolicy', 'api-key'],
    ['transport', 'custom-network'],
    ['apiKeyFallback', true],
  ])('rejects public Codex Search dependency drift in %s', (field, driftedValue) => {
    expect(parsePublicReleaseIdentity(
      identityWithCodexSearch({ [field]: driftedValue }),
    )).toBeNull()
  })

  it.each(Object.keys(CURRENT_METHOD_VERSION_TUPLE))(
    'rejects public method-version drift in %s',
    (field) => {
      expect(parsePublicReleaseIdentity(identity({
        release: {
          version: '2.2.0-rc.1',
          methodVersions: {
            ...CURRENT_METHOD_VERSION_TUPLE,
            [field]: 'webchess-drifted-v999',
          },
        },
      }))).toBeNull()
    },
  )

  it('rejects a missing or extended method-version tuple', () => {
    expect(parsePublicReleaseIdentity(identity({
      release: { version: '2.2.0-rc.1' },
    }))).toBeNull()
    expect(parsePublicReleaseIdentity(identity({
      release: {
        version: '2.2.0-rc.1',
        methodVersions: {
          ...CURRENT_METHOD_VERSION_TUPLE,
          unreviewedStage: 'webchess-unreviewed-v1',
        },
      },
    }))).toBeNull()
  })

  it.each([
    identity({ status: 'unresolved' }),
    identity({
      source: {
        repository: 'https://github.com/someone/fork',
        commit: SHA,
        archive: {
          downloadPath: `/downloads/webchess-source-${SHA}.zip`,
          sha256: 'a'.repeat(64),
        },
      },
    }),
    identity({
      source: {
        repository: 'https://github.com/jr4488/webchess',
        commit: SHA,
        archive: {
          downloadPath: '/downloads/webchess-source.zip',
          sha256: 'a'.repeat(64),
        },
      },
    }),
    identity({ dependencies: {} }),
  ])('rejects malformed, noncanonical, or unresolved manifests', (value) => {
    expect(parsePublicReleaseIdentity(value)).toBeNull()
  })
})

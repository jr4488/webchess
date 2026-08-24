import { describe, expect, it } from 'vitest'

import { resolveReleaseIdentity } from './release-identity.mjs'
import { validatePackedReleaseIdentity } from './verify-packed-artifact.mjs'

const COMMIT = '0384978b2ba709da4c9824f2821c8623d3f84364'

function identity() {
  return resolveReleaseIdentity({
    paperPdfSha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    paperRepositoryPath: 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md',
    sourceArchiveSha256:
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    sourceCommit: COMMIT,
  })
}

describe('packed public release identity', () => {
  it('accepts the exact canonical identity bound to the build commit', () => {
    const releaseIdentity = identity()
    expect(validatePackedReleaseIdentity(releaseIdentity, COMMIT)).toBe(
      releaseIdentity,
    )
  })

  it.each([
    ['package', '@openclaw/codex-next'],
    ['version', '2026.7.1'],
    ['npmIntegrity', 'sha512-unreviewed'],
    ['provider', 'alternate'],
    ['authPolicy', 'api-key'],
    ['transport', 'custom-network'],
    ['apiKeyFallback', true],
  ])('rejects packed Codex Search dependency drift in %s', (field, driftedValue) => {
    const releaseIdentity = identity()
    releaseIdentity.dependencies.codexSearch[field] = driftedValue

    expect(() => validatePackedReleaseIdentity(
      releaseIdentity,
      COMMIT,
    )).toThrow('does not match the canonical release contract')
  })

  it('rejects a missing dependency contract and a mismatched build commit', () => {
    const missingDependency = identity()
    delete missingDependency.dependencies.codexSearch
    expect(() => validatePackedReleaseIdentity(
      missingDependency,
      COMMIT,
    )).toThrow('does not match the canonical release contract')

    expect(() => validatePackedReleaseIdentity(
      identity(),
      '1234567890abcdef1234567890abcdef12345678',
    )).toThrow('does not match the build identity')
  })
})

import { describe, expect, it } from 'vitest'

import {
  configuredReleaseCommit,
  immutableReleaseSourceUrl,
} from './release-source'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('immutable release source identity', () => {
  it('accepts a complete configured release commit', () => {
    expect(configuredReleaseCommit({ WEBCHESS_RELEASE_SHA: SHA })).toBe(SHA)
    expect(immutableReleaseSourceUrl({ WEBCHESS_RELEASE_SHA: SHA })).toBe(
      `https://github.com/jr4488/webchess/tree/${SHA}`,
    )
  })

  it('accepts matching explicit and deployment commits', () => {
    expect(configuredReleaseCommit({
      WEBCHESS_RELEASE_SHA: SHA.toUpperCase(),
      VERCEL_GIT_COMMIT_SHA: SHA,
    })).toBe(SHA)
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
  ])('fails closed for implicit, missing, mutable, abbreviated, or conflicting identity', (environment) => {
    expect(configuredReleaseCommit(environment)).toBeNull()
    expect(immutableReleaseSourceUrl(environment)).toBeNull()
  })
})

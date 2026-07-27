import { afterEach, describe, expect, it } from 'vitest'

import { GET } from './route'

const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA
const originalRelease = process.env.WEBCHESS_RELEASE_SHA
const originalVercel = process.env.VERCEL
const originalVercelEnvironment = process.env.VERCEL_ENV

afterEach(() => {
  if (originalCommit === undefined) {
    delete process.env.VERCEL_GIT_COMMIT_SHA
  } else {
    process.env.VERCEL_GIT_COMMIT_SHA = originalCommit
  }
  if (originalRelease === undefined) delete process.env.WEBCHESS_RELEASE_SHA
  else process.env.WEBCHESS_RELEASE_SHA = originalRelease
  if (originalVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = originalVercel
  if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = originalVercelEnvironment
})

describe('source archive download', () => {
  it('redirects a Vercel deployment to its immutable Git commit archive', () => {
    process.env.VERCEL_GIT_COMMIT_SHA =
      '0123456789abcdef0123456789abcdef01234567'

    const response = GET()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://github.com/jr4488/webchess/archive/0123456789abcdef0123456789abcdef01234567.zip',
    )
    expect(response.headers.get('cache-control')).toBe(
      'no-store',
    )
  })

  it('uses the public main branch when no valid Vercel SHA is available', () => {
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'

    const response = GET()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://github.com/jr4488/webchess/archive/refs/heads/main.zip',
    )
  })

  it('fails closed on Vercel when release provenance is unavailable', async () => {
    process.env.VERCEL = '1'
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'

    const response = GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RELEASE_SHA_UNAVAILABLE' },
    })
  })

  it('allows an explicit reviewed release SHA to override Git metadata', () => {
    process.env.VERCEL = '1'
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'
    process.env.WEBCHESS_RELEASE_SHA =
      'fedcba9876543210fedcba9876543210fedcba98'

    expect(GET().headers.get('location')).toBe(
      'https://github.com/jr4488/webchess/archive/fedcba9876543210fedcba9876543210fedcba98.zip',
    )
  })
})

import { afterEach, describe, expect, it } from 'vitest'

import { GET } from './route'

const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA
const originalRelease = process.env.WEBCHESS_RELEASE_SHA
const originalVercel = process.env.VERCEL
const originalVercelEnvironment = process.env.VERCEL_ENV
const originalVercelTargetEnvironment = process.env.VERCEL_TARGET_ENV
const originalVercelUrl = process.env.VERCEL_URL

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
  if (originalVercelTargetEnvironment === undefined) {
    delete process.env.VERCEL_TARGET_ENV
  } else {
    process.env.VERCEL_TARGET_ENV = originalVercelTargetEnvironment
  }
  if (originalVercelUrl === undefined) delete process.env.VERCEL_URL
  else process.env.VERCEL_URL = originalVercelUrl
})

describe('source archive download', () => {
  it('redirects only when the reviewed release and deployment commits match', () => {
    process.env.WEBCHESS_RELEASE_SHA =
      '0123456789abcdef0123456789abcdef01234567'
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

  it('fails closed outside Vercel when no immutable SHA is available', async () => {
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_TARGET_ENV
    delete process.env.VERCEL_URL
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'

    const response = GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RELEASE_SHA_UNAVAILABLE' },
    })
  })

  it('does not treat deployment metadata alone as reviewed release identity', async () => {
    delete process.env.WEBCHESS_RELEASE_SHA
    process.env.VERCEL_GIT_COMMIT_SHA =
      '0123456789abcdef0123456789abcdef01234567'

    const response = GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RELEASE_SHA_UNAVAILABLE' },
    })
  })

  it.each([
    ['VERCEL', '1'],
    ['VERCEL_ENV', 'preview'],
    ['VERCEL_TARGET_ENV', 'preview'],
    ['VERCEL_URL', 'webchess-preview.vercel.app'],
  ] as const)('fails closed with the %s marker when release provenance is unavailable', async (name, value) => {
    process.env[name] = value
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'

    const response = GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RELEASE_SHA_UNAVAILABLE' },
    })
  })

  it('allows an explicit reviewed release SHA when deployment metadata is absent', () => {
    process.env.VERCEL = '1'
    delete process.env.VERCEL_GIT_COMMIT_SHA
    process.env.WEBCHESS_RELEASE_SHA =
      'fedcba9876543210fedcba9876543210fedcba98'

    expect(GET().headers.get('location')).toBe(
      'https://github.com/jr4488/webchess/archive/fedcba9876543210fedcba9876543210fedcba98.zip',
    )
  })

  it('fails closed when explicit and deployment SHAs conflict', async () => {
    process.env.WEBCHESS_RELEASE_SHA =
      'fedcba9876543210fedcba9876543210fedcba98'
    process.env.VERCEL_GIT_COMMIT_SHA =
      '0123456789abcdef0123456789abcdef01234567'

    const response = GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RELEASE_SHA_UNAVAILABLE' },
    })
  })
})

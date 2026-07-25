// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createWebChessApp } from './app.mjs'
import {
  assertProductionDistribution,
  DEFAULT_SERVER_HOST,
  mountProductionRoutes,
  resolveServerHost,
} from './production.mjs'

const INDEX_MARKER = '<main>WebChess production shell</main>'

async function createDistributionFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'webchess-production-test-'))
  await mkdir(path.join(directory, 'assets'))
  await writeFile(
    path.join(directory, 'index.html'),
    `<!doctype html><html><body>${INDEX_MARKER}</body></html>`,
  )
  await writeFile(path.join(directory, 'assets', 'index-Ab12cd_E.js'), 'window.webChess = true')
  await writeFile(path.join(directory, 'favicon.svg'), '<svg></svg>')
  return directory
}

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const candidate = app.listen(0, DEFAULT_SERVER_HOST, () => resolve(candidate))
    candidate.once('error', reject)
  })
  const address = server.address()
  return {
    baseUrl: `http://${DEFAULT_SERVER_HOST}:${address.port}`,
    server,
  }
}

describe('production server configuration', () => {
  it('binds to loopback unless HOST is explicitly configured', () => {
    expect(resolveServerHost({})).toBe('127.0.0.1')
    expect(resolveServerHost({ HOST: '  ' })).toBe('127.0.0.1')
    expect(resolveServerHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0')
  })

  it('rejects a missing or incomplete production build before startup', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'webchess-missing-build-'))

    try {
      expect(() => assertProductionDistribution(path.join(directory, 'missing')))
        .toThrow(/npm run build/)
      expect(() => assertProductionDistribution(directory))
        .toThrow(/npm run build/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('production HTTP routing', () => {
  let baseUrl
  let distributionDirectory
  let server

  beforeAll(async () => {
    distributionDirectory = await createDistributionFixture()
    const app = createWebChessApp({ apiKey: '' })
    mountProductionRoutes(app, { distributionDirectory })
    ;({ baseUrl, server } = await listen(app))
  })

  afterAll(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await rm(distributionDirectory, { recursive: true, force: true })
  })

  it.each(['/', '/play', '/play/'])('serves the app shell for %s document navigation', async (route) => {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { accept: 'text/html' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toContain(INDEX_MARKER)
  })

  it('serves document HEAD requests consistently without a body', async () => {
    const getResponse = await fetch(`${baseUrl}/play`, {
      headers: { accept: 'text/html' },
    })
    const headResponse = await fetch(`${baseUrl}/play`, {
      method: 'HEAD',
      headers: { accept: 'text/html' },
    })

    expect(headResponse.status).toBe(getResponse.status)
    expect(headResponse.headers.get('content-type')).toBe(getResponse.headers.get('content-type'))
    expect(headResponse.headers.get('content-length')).toBe(getResponse.headers.get('content-length'))
    expect(await headResponse.text()).toBe('')
  })

  it('does not turn unknown paths, APIs, or missing assets into the app shell', async () => {
    const [unknownPage, unknownApi, missingAsset] = await Promise.all([
      fetch(`${baseUrl}/not-a-page`, { headers: { accept: 'text/html' } }),
      fetch(`${baseUrl}/api/not-a-route`, { headers: { accept: 'text/html' } }),
      fetch(`${baseUrl}/assets/missing-old-hash.js`, { headers: { accept: 'text/html' } }),
    ])

    expect(unknownPage.status).toBe(404)
    expect(unknownPage.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await unknownPage.text()).not.toContain(INDEX_MARKER)

    expect(unknownApi.status).toBe(404)
    expect(unknownApi.headers.get('content-type')).toMatch(/^application\/json/)
    await expect(unknownApi.json()).resolves.toEqual({ error: 'API route not found.' })

    expect(missingAsset.status).toBe(404)
    expect(missingAsset.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await missingAsset.text()).not.toContain(INDEX_MARKER)
  })

  it('returns matching GET and HEAD metadata for missing APIs and assets', async () => {
    for (const route of ['/api/missing', '/assets/missing.js']) {
      const getResponse = await fetch(`${baseUrl}${route}`)
      const headResponse = await fetch(`${baseUrl}${route}`, { method: 'HEAD' })

      expect(headResponse.status).toBe(getResponse.status)
      expect(headResponse.headers.get('content-type')).toBe(getResponse.headers.get('content-type'))
      expect(headResponse.headers.get('content-length')).toBe(getResponse.headers.get('content-length'))
      expect(await headResponse.text()).toBe('')
    }
  })

  it('uses immutable caching only for fingerprinted build assets', async () => {
    const [hashedAsset, unhashedAsset] = await Promise.all([
      fetch(`${baseUrl}/assets/index-Ab12cd_E.js`),
      fetch(`${baseUrl}/favicon.svg`),
    ])

    expect(hashedAsset.status).toBe(200)
    expect(hashedAsset.headers.get('cache-control'))
      .toBe('public, max-age=31536000, immutable')
    expect(unhashedAsset.status).toBe(200)
    expect(unhashedAsset.headers.get('cache-control')).toBe('no-cache')
  })

  it('requires an HTML representation before serving a document route', async () => {
    const response = await fetch(`${baseUrl}/play`, {
      headers: { accept: 'application/json' },
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/)
  })
})

// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRuntimeApp,
  resolveServerPort,
  startWebChessServer,
} from './server.mjs'

const servers = new Set()
const temporaryDirectories = new Set()

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  servers.clear()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

function productionDistribution() {
  const root = mkdtempSync(path.join(tmpdir(), 'webchess-runtime-'))
  const distributionDirectory = path.join(root, 'dist')
  mkdirSync(distributionDirectory)
  writeFileSync(
    path.join(distributionDirectory, 'index.html'),
    '<!doctype html><title>WebChess runtime test</title>',
  )
  temporaryDirectories.add(root)
  return distributionDirectory
}

describe('executable server boundary', () => {
  it('validates the configured port', () => {
    expect(resolveServerPort({})).toBe(5173)
    expect(resolveServerPort({ PORT: '0' })).toBe(0)
    expect(() => resolveServerPort({ PORT: 'not-a-port' })).toThrow(/PORT/)
    expect(() => resolveServerPort({ PORT: '70000' })).toThrow(/PORT/)
  })

  it('mounts Vite middleware in development without starting a listener', async () => {
    const middleware = vi.fn((_request, _response, next) => next())
    const createViteServer = vi.fn().mockResolvedValue({ middlewares: middleware })

    const runtime = await createRuntimeApp({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '4321' },
      createViteServer,
    })

    expect(runtime).toMatchObject({ host: '127.0.0.1', port: 4321 })
    expect(createViteServer).toHaveBeenCalledWith(expect.objectContaining({
      appType: 'spa',
      server: { middlewareMode: true },
    }))
  })

  it('starts the production app on loopback and reports the actual port', async () => {
    const logger = { log: vi.fn() }
    const server = await startWebChessServer({
      environment: { NODE_ENV: 'production', PORT: '0' },
      distributionDirectory: productionDistribution(),
      logger,
    })
    servers.add(server)
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an address for the test server.')
    }

    const health = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    expect(logger.log).toHaveBeenCalledWith(
      `WebChess is ready at http://127.0.0.1:${address.port}`,
    )
  })
})

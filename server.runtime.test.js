// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter, once } from 'node:events'
import {
  createConnection as createNetConnection,
  createServer as createNetServer,
} from 'node:net'
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
    expect(resolveServerPort({ PORT: ' 4321 ' })).toBe(4321)
    expect(() => resolveServerPort({ PORT: 'not-a-port' })).toThrow(/PORT/)
    expect(() => resolveServerPort({ PORT: '5173junk' })).toThrow(/PORT/)
    expect(() => resolveServerPort({ PORT: '1.5' })).toThrow(/PORT/)
    expect(() => resolveServerPort({ PORT: '   ' })).toThrow(/PORT/)
    expect(() => resolveServerPort({ PORT: '70000' })).toThrow(/PORT/)
  })

  it('validates the port before creating a development watcher', async () => {
    const createViteServer = vi.fn()

    await expect(createRuntimeApp({
      environment: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '5173junk',
      },
      createViteServer,
    })).rejects.toThrow(/PORT/)

    expect(createViteServer).not.toHaveBeenCalled()
  })

  it('closes the provider when production route initialization fails', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'webchess-runtime-missing-'))
    temporaryDirectories.add(root)
    const closeProvider = vi.fn()

    await expect(createRuntimeApp({
      environment: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0' },
      distributionDirectory: path.join(root, 'missing-dist'),
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })).rejects.toThrow(/production build is unavailable/i)

    expect(closeProvider).toHaveBeenCalledOnce()
  })

  it('closes the provider when the development watcher cannot be created', async () => {
    const closeProvider = vi.fn()
    const viteError = new Error('Vite creation failed')

    await expect(createRuntimeApp({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '0' },
      createViteServer: vi.fn().mockRejectedValue(viteError),
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })).rejects.toBe(viteError)

    expect(closeProvider).toHaveBeenCalledOnce()
  })

  it('mounts Vite middleware in development without starting a listener', async () => {
    const middleware = vi.fn((_request, _response, next) => next())
    const createViteServer = vi.fn().mockResolvedValue({ middlewares: middleware })

    const runtime = await createRuntimeApp({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '4321' },
      createViteServer,
    })

    expect(runtime).toMatchObject({ host: '127.0.0.1', port: 4321 })
    expect(runtime.provider).toMatchObject({
      id: 'openai-api',
      localOnly: false,
    })
    // The hot-reload socket is derived from the app port so that two instances
    // on different ports do not fight over one default socket.
    expect(createViteServer).toHaveBeenCalledWith(expect.objectContaining({
      appType: 'spa',
      server: { middlewareMode: true, hmr: { port: 24_321 } },
    }))
  })

  it('closes Vite even when provider cleanup fails', async () => {
    const providerError = new Error('provider close failed')
    const closeProvider = vi.fn(() => {
      throw providerError
    })
    const closeVite = vi.fn().mockResolvedValue(undefined)
    const runtime = await createRuntimeApp({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '0' },
      createViteServer: vi.fn().mockResolvedValue({
        close: closeVite,
        middlewares: vi.fn((_request, _response, next) => next()),
      }),
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })

    await expect(runtime.close()).rejects.toBe(providerError)
    await expect(runtime.close()).rejects.toBe(providerError)
    expect(closeProvider).toHaveBeenCalledOnce()
    expect(closeVite).toHaveBeenCalledOnce()
  })

  it('passes the resolved host into local-only provider enforcement', async () => {
    const middleware = vi.fn((_request, _response, next) => next())
    const runtime = await createRuntimeApp({
      environment: {
        NODE_ENV: 'development',
        HOST: '0.0.0.0',
        PORT: '0',
        WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt',
      },
      appOptions: {
        accessCode: 'a sufficiently long test code',
        sessionSecret: 'a sufficiently long test secret with more than 32 bytes',
        client: { responses: { parse: vi.fn() } },
      },
      createViteServer: vi.fn().mockResolvedValue({ middlewares: middleware }),
    })

    expect(runtime).toMatchObject({
      host: '0.0.0.0',
      provider: { id: 'codex-chatgpt', localOnly: true },
    })

    const server = runtime.app.listen(0, '127.0.0.1')
    servers.add(server)
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an address for the test server.')
    }
    const ready = await fetch(`http://127.0.0.1:${address.port}/api/ready`)
    expect(ready.status).toBe(503)
    expect(await ready.json()).toMatchObject({
      provider: { id: 'codex-chatgpt', localOnly: true },
      reason: expect.stringMatching(/loopback host/i),
    })
  })

  it('starts the production app on loopback and reports the actual port', async () => {
    const logger = { log: vi.fn() }
    const closeProvider = vi.fn()
    const server = await startWebChessServer({
      environment: { NODE_ENV: 'production', PORT: '0' },
      distributionDirectory: productionDistribution(),
      logger,
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
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
      expect.stringMatching(/^WebChess model provider: .+ \(openai-api\)$/u),
    )
    expect(logger.log).toHaveBeenCalledWith(
      `WebChess is ready at http://127.0.0.1:${address.port}`,
    )
    expect(logger.log.mock.calls.filter(
      ([message]) => message.startsWith('WebChess model provider:'),
    )).toHaveLength(1)

    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    servers.delete(server)
    expect(closeProvider).toHaveBeenCalledOnce()
  })

  it('forwards the default console logger to unexpected request errors', async () => {
    const sentinel = new Error('session entropy failed')
    let randomCall = 0
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const server = await startWebChessServer({
        environment: {
          NODE_ENV: 'production',
          HOST: '127.0.0.1',
          PORT: '0',
          WEBCHESS_ACCESS_CODE: 'a sufficiently long test code',
          WEBCHESS_SESSION_SECRET:
            'a distinct sufficiently long test secret with more than 32 bytes',
        },
        distributionDirectory: productionDistribution(),
        appOptions: {
          client: { responses: { parse: vi.fn() } },
          randomBytes(size) {
            randomCall += 1
            if (randomCall === 1) return Buffer.alloc(size, 1)
            throw sentinel
          },
        },
      })
      servers.add(server)
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected an address for the test server.')
      }
      const origin = `http://127.0.0.1:${address.port}`
      const response = await fetch(`${origin}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({
          accessCode: 'a sufficiently long test code',
        }),
      })

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'The server could not complete this request.',
      })
      expect(errorLog).toHaveBeenCalledWith(sentinel)
    } finally {
      errorLog.mockRestore()
      infoLog.mockRestore()
    }
  })

  it('waits for runtime cleanup before completing an ordinary server close', async () => {
    let releaseVite
    const closeViteGate = new Promise((resolve) => {
      releaseVite = resolve
    })
    const closeVite = vi.fn(() => closeViteGate)
    const closeProvider = vi.fn()
    const server = await startWebChessServer({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '0' },
      handleSignals: false,
      logger: { log: vi.fn(), error: vi.fn() },
      createViteServer: vi.fn().mockResolvedValue({
        close: closeVite,
        middlewares: vi.fn((_request, _response, next) => next()),
      }),
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })
    servers.add(server)
    const transportClosed = once(server, 'close')
    let closeCallbackSettled = false
    const serverClosed = new Promise((resolve, reject) => {
      server.close((error) => {
        closeCallbackSettled = true
        if (error) reject(error)
        else resolve()
      })
    })

    await transportClosed
    await vi.waitFor(() => expect(closeVite).toHaveBeenCalledOnce())
    const settledBeforeRelease = closeCallbackSettled
    releaseVite()
    await serverClosed
    servers.delete(server)

    expect(settledBeforeRelease).toBe(false)
    expect(closeProvider).toHaveBeenCalledOnce()
  })

  it('forces lingering partial requests closed after the shutdown grace period', async () => {
    const closeProvider = vi.fn()
    const server = await startWebChessServer({
      environment: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0' },
      distributionDirectory: productionDistribution(),
      handleSignals: false,
      logger: { log: vi.fn(), error: vi.fn() },
      shutdownGraceMs: 25,
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })
    servers.add(server)
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an address for the test server.')
    }

    const socket = createNetConnection(address.port, '127.0.0.1')
    socket.on('error', () => {})
    // A forced shutdown may reset this intentionally incomplete request.
    // Wait for close without letting node:events.once reject on that reset.
    const socketClosed = new Promise((resolve) => {
      socket.once('close', resolve)
    })
    await once(socket, 'connect')
    socket.write(
      'POST /api/session HTTP/1.1\r\n' +
      `Host: 127.0.0.1:${address.port}\r\n` +
      'Content-Type: application/json\r\n' +
      'Content-Length: 100\r\n',
    )

    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    servers.delete(server)
    await socketClosed

    expect(server.listening).toBe(false)
    expect(socket.destroyed).toBe(true)
    expect(closeProvider).toHaveBeenCalledOnce()
  })

  it('settles startup cleanly when termination arrives before listening', async () => {
    class EarlyTerminationTarget extends EventEmitter {
      once(eventName, listener) {
        const target = super.once(eventName, listener)
        if (eventName === 'SIGTERM') this.emit('SIGTERM')
        return target
      }
    }

    const signalTarget = new EarlyTerminationTarget()
    const closeVite = vi.fn().mockResolvedValue(undefined)
    const closeProvider = vi.fn()
    const logger = { log: vi.fn(), error: vi.fn() }
    const server = await startWebChessServer({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '0' },
      logger,
      signalTarget,
      createViteServer: vi.fn().mockResolvedValue({
        close: closeVite,
        middlewares: vi.fn((_request, _response, next) => next()),
      }),
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })

    expect(server.listening).toBe(false)
    expect(closeVite).toHaveBeenCalledOnce()
    expect(closeProvider).toHaveBeenCalledOnce()
    expect(logger.log).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(signalTarget.listenerCount('SIGINT')).toBe(0)
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0)
  })

  it('waits for runtime cleanup before rejecting a listen error', async () => {
    const blocker = createNetServer()
    blocker.listen(0, '127.0.0.1')
    servers.add(blocker)
    await once(blocker, 'listening')
    const address = blocker.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an address for the blocker server.')
    }

    let releaseVite
    const closeViteGate = new Promise((resolve) => {
      releaseVite = resolve
    })
    let closeViteSettled = false
    const closeVite = vi.fn(() => closeViteGate.then(() => {
      closeViteSettled = true
    }))
    const startup = startWebChessServer({
      environment: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(address.port),
      },
      handleSignals: false,
      logger: { log: vi.fn(), error: vi.fn() },
      createViteServer: vi.fn().mockResolvedValue({
        close: closeVite,
        middlewares: vi.fn((_request, _response, next) => next()),
      }),
      appOptions: {
        client: { responses: { parse: vi.fn() } },
      },
    })
    let startupSettled = false
    void startup.then(
      () => {
        startupSettled = true
      },
      () => {
        startupSettled = true
      },
    )

    try {
      await vi.waitFor(() => expect(closeVite).toHaveBeenCalledOnce())
      await new Promise((resolve) => setImmediate(resolve))
      expect(startupSettled).toBe(false)
    } finally {
      releaseVite()
    }

    await expect(startup).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(closeViteSettled).toBe(true)
  })

  it('closes the development watcher and provider on a termination signal', async () => {
    const signalTarget = new EventEmitter()
    const middleware = vi.fn((_request, _response, next) => next())
    const closeVite = vi.fn().mockResolvedValue(undefined)
    const closeProvider = vi.fn()
    const server = await startWebChessServer({
      environment: { NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '0' },
      logger: { log: vi.fn(), error: vi.fn() },
      signalTarget,
      createViteServer: vi.fn().mockResolvedValue({
        close: closeVite,
        middlewares: middleware,
      }),
      appOptions: {
        client: {
          close: closeProvider,
          responses: { parse: vi.fn() },
        },
      },
    })
    servers.add(server)
    const closed = once(server, 'close')

    signalTarget.emit('SIGTERM')
    await closed
    await vi.waitFor(() => {
      expect(closeVite).toHaveBeenCalledOnce()
      expect(closeProvider).toHaveBeenCalledOnce()
    })
    servers.delete(server)
    expect(signalTarget.listenerCount('SIGINT')).toBe(0)
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0)
  })
})

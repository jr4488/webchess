import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWebChessApp } from './server/app.mjs'
import {
  mountProductionRoutes,
  resolveServerHost,
} from './server/production.mjs'

const modulePath = fileURLToPath(import.meta.url)
const defaultRootDirectory = path.dirname(modulePath)

function finishCleanup(results, message) {
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message)
}

export function resolveServerPort(environment = process.env) {
  const configuredPort = String(environment.PORT ?? '5173').trim()
  const port = Number(configuredPort)
  if (
    !/^\d+$/u.test(configuredPort) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new Error('PORT must be an integer from 0 to 65535.')
  }
  return port
}

export async function createRuntimeApp(options = {}) {
  const environment = options.environment ?? process.env
  const port = resolveServerPort(environment)
  const logger = options.appOptions?.logger ?? options.logger ?? console
  const rootDirectory = options.rootDirectory ?? defaultRootDirectory
  const distributionDirectory =
    options.distributionDirectory ?? path.join(rootDirectory, 'dist')
  const host = resolveServerHost(environment)
  const app = createWebChessApp({
    ...options.appOptions,
    environment,
    host,
    logger,
  })

  let vite
  try {
    if (environment.NODE_ENV === 'production') {
      mountProductionRoutes(app, { distributionDirectory })
    } else {
      const createViteServer = options.createViteServer ??
        (await import('vite')).createServer
      vite = await createViteServer({
        root: rootDirectory,
        appType: 'spa',
        server: { middlewareMode: true },
      })
      app.use(vite.middlewares)
    }
  } catch (initializationError) {
    const cleanupResults = await Promise.allSettled([
      Promise.resolve().then(() => app.locals.closeWebChessProvider?.()),
      Promise.resolve().then(() => vite?.close?.()),
    ])
    const cleanupFailures = cleanupResults.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [initializationError, ...cleanupFailures],
        'WebChess initialization and cleanup failed.',
        { cause: initializationError },
      )
    }
    throw initializationError
  }

  let closePromise
  const close = () => {
    if (!closePromise) {
      const closeProvider = Promise.resolve().then(
        () => app.locals.closeWebChessProvider?.(),
      )
      const closeVite = Promise.resolve().then(() => vite?.close?.())
      closePromise = Promise.allSettled([closeProvider, closeVite]).then(
        (results) => finishCleanup(results, 'WebChess runtime cleanup failed.'),
      )
    }
    return closePromise
  }

  return {
    app,
    close,
    host,
    port,
    provider: app.locals.webChessProvider,
  }
}

export async function startWebChessServer(options = {}) {
  const logger = options.logger ?? console
  const signalTarget = options.signalTarget ?? process
  const shutdownGraceMs = options.shutdownGraceMs ?? 5_000
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 0) {
    throw new TypeError('shutdownGraceMs must be a non-negative integer.')
  }
  const {
    app,
    close,
    host,
    port,
    provider,
  } = await createRuntimeApp({ ...options, logger })

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host)
    const nativeServerClose = server.close.bind(server)
    let stopping = false
    let startupSettled = false
    let serverClosePromise
    let shutdownPromise

    const settleStartup = (settle, value) => {
      if (startupSettled) return false
      startupSettled = true
      settle(value)
      return true
    }
    const closeServer = () => {
      if (!serverClosePromise) {
        serverClosePromise = new Promise((resolveClose, rejectClose) => {
          const finish = () => {
            server.off('error', failBeforeListening)
            const forceCloseTimer = setTimeout(() => {
              server.closeAllConnections?.()
            }, shutdownGraceMs)
            forceCloseTimer.unref?.()
            nativeServerClose((error) => {
              clearTimeout(forceCloseTimer)
              if (error) rejectClose(error)
              else resolveClose()
            })
          }
          const failBeforeListening = (error) => {
            server.off('listening', finish)
            rejectClose(error)
          }
          if (server.listening) {
            finish()
            return
          }
          server.once('listening', finish)
          server.once('error', failBeforeListening)
        })
      }
      return serverClosePromise
    }
    const shutdown = () => {
      if (!shutdownPromise) {
        shutdownPromise = Promise.allSettled([close(), closeServer()]).then(
          (results) => finishCleanup(results, 'WebChess server shutdown failed.'),
        )
      }
      return shutdownPromise
    }
    const stopForSignal = () => {
      if (stopping) return
      stopping = true
      removeSignalHandlers()
      shutdown().then(
        () => {
          settleStartup(resolve, server)
        },
        (error) => {
          process.exitCode = 1
          if (!settleStartup(reject, error)) {
            logger.error?.(error)
          }
        },
      )
    }
    const removeSignalHandlers = () => {
      signalTarget.off('SIGINT', stopForSignal)
      signalTarget.off('SIGTERM', stopForSignal)
    }
    server.close = (callback) => {
      const pendingShutdown = shutdown()
      if (typeof callback === 'function') {
        pendingShutdown.then(() => callback(), callback)
      } else {
        void pendingShutdown.catch((error) => logger.error?.(error))
      }
      return server
    }
    if (options.handleSignals !== false) {
      signalTarget.once('SIGINT', stopForSignal)
      signalTarget.once('SIGTERM', stopForSignal)
    }
    server.once('close', () => {
      removeSignalHandlers()
      if (!shutdownPromise) {
        shutdownPromise = close()
        void shutdownPromise.catch((error) => logger.error?.(error))
      }
    })
    server.once('error', (error) => {
      removeSignalHandlers()
      close().then(
        () => {
          if (!settleStartup(reject, error)) {
            logger.error?.(error)
            process.exitCode = 1
          }
        },
        (closeError) => {
          const startupError = new AggregateError(
            [error, closeError],
            'WebChess startup and cleanup failed.',
          )
          if (!settleStartup(reject, startupError)) {
            logger.error?.(startupError)
            process.exitCode = 1
          }
        },
      )
    })
    server.once('listening', () => {
      if (stopping) return
      const address = server.address()
      const activePort = typeof address === 'object' && address ? address.port : port
      logger.log(
        `WebChess model provider: ${provider.label} (${provider.id}${
          provider.localOnly ? ', local only' : ''
        })`,
      )
      logger.log(`WebChess is ready at http://${host}:${activePort}`)
      settleStartup(resolve, server)
    })
  })
}

const launchedDirectly =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === modulePath

if (launchedDirectly) {
  await startWebChessServer()
}

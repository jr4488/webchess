import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWebChessApp } from './server/app.mjs'
import {
  mountProductionRoutes,
  resolveServerHost,
} from './server/production.mjs'

const modulePath = fileURLToPath(import.meta.url)
const defaultRootDirectory = path.dirname(modulePath)

export function resolveServerPort(environment = process.env) {
  const port = Number.parseInt(environment.PORT ?? '5173', 10)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer from 0 to 65535.')
  }
  return port
}

export async function createRuntimeApp(options = {}) {
  const environment = options.environment ?? process.env
  const rootDirectory = options.rootDirectory ?? defaultRootDirectory
  const distributionDirectory =
    options.distributionDirectory ?? path.join(rootDirectory, 'dist')
  const app = createWebChessApp(options.appOptions)

  if (environment.NODE_ENV === 'production') {
    mountProductionRoutes(app, { distributionDirectory })
  } else {
    const createViteServer = options.createViteServer ??
      (await import('vite')).createServer
    const vite = await createViteServer({
      root: rootDirectory,
      appType: 'spa',
      server: { middlewareMode: true },
    })
    app.use(vite.middlewares)
  }

  return {
    app,
    host: resolveServerHost(environment),
    port: resolveServerPort(environment),
  }
}

export async function startWebChessServer(options = {}) {
  const logger = options.logger ?? console
  const { app, host, port } = await createRuntimeApp(options)

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host)
    server.once('error', reject)
    server.once('listening', () => {
      const address = server.address()
      const activePort = typeof address === 'object' && address ? address.port : port
      logger.log(`WebChess is ready at http://${host}:${activePort}`)
      resolve(server)
    })
  })
}

const launchedDirectly =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === modulePath

if (launchedDirectly) {
  await startWebChessServer()
}

import { constants as fileSystemConstants, statSync, accessSync } from 'node:fs'
import path from 'node:path'

import express from 'express'

export const DEFAULT_SERVER_HOST = '127.0.0.1'

const DOCUMENT_ROUTES = new Set(['/', '/play', '/play/'])
const HASHED_ASSET_PATTERN = /-[A-Za-z0-9_-]{8,}\.[^./]+$/

export function resolveServerHost(environment = process.env) {
  return environment.HOST?.trim() || DEFAULT_SERVER_HOST
}

export function assertProductionDistribution(distributionDirectory) {
  const indexPath = path.join(distributionDirectory, 'index.html')

  try {
    const distribution = statSync(distributionDirectory)
    const index = statSync(indexPath)
    accessSync(indexPath, fileSystemConstants.R_OK)

    if (!distribution.isDirectory() || !index.isFile()) {
      throw new Error('The production output is not a directory with an index file.')
    }
  } catch (error) {
    throw new Error(
      `Production build is unavailable at ${indexPath}. Run "npm run build" before "npm start".`,
      { cause: error },
    )
  }

  return indexPath
}

function isHashedAsset(filePath, distributionDirectory) {
  const relativePath = path.relative(distributionDirectory, filePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false
  }

  const [topLevelDirectory] = relativePath.split(path.sep)
  return topLevelDirectory === 'assets' && HASHED_ASSET_PATTERN.test(path.basename(filePath))
}

function isDocumentNavigation(request) {
  if (!DOCUMENT_ROUTES.has(request.path)) {
    return false
  }

  return request.accepts('html') === 'html'
}

export function mountProductionRoutes(app, options) {
  const distributionDirectory = path.resolve(options.distributionDirectory)
  const indexPath = assertProductionDistribution(distributionDirectory)

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found.' })
  })

  app.use(express.static(distributionDirectory, {
    fallthrough: true,
    index: false,
    redirect: false,
    setHeaders(response, filePath) {
      response.setHeader(
        'Cache-Control',
        isHashedAsset(filePath, distributionDirectory)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      )
    },
  }))

  app.use((request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method) || !isDocumentNavigation(request)) {
      next()
      return
    }

    response.setHeader('Cache-Control', 'no-cache')
    response.sendFile(indexPath)
  })

  app.use((_request, response) => {
    response.status(404).type('text/plain').send('Not found.')
  })

  return app
}

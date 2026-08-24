import { execFileSync } from 'node:child_process'
import {
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runtimePayloadIdentity } from './runtime-payload-identity.mjs'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const outputPath = path.join(projectRoot, 'webchess-build-identity.json')

async function clean() {
  try {
    await unlink(outputPath)
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw error
    }
  }
}

function gitOutput(args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
}

async function generate() {
  await clean()
  const sourceCommit = gitOutput(['rev-parse', '--verify', 'HEAD']).toLowerCase()
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error('Cannot pack WebChess without an exact Git commit.')
  }
  if (gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error(
      'Refusing to stamp a packed WebChess artifact from a dirty checkout.',
    )
  }
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  )
  const payload = await runtimePayloadIdentity(projectRoot)
  const identity = {
    format: 'webchess-build-identity/1',
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    sourceCommit,
    runtimePayload: {
      format: payload.format,
      sha256: payload.sha256,
      fileCount: payload.fileCount,
      byteCount: payload.byteCount,
    },
  }
  await writeFile(outputPath, `${JSON.stringify(identity, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o644,
  })
}

if (process.argv[2] === '--clean') {
  await clean()
} else if (process.argv.length === 2) {
  await generate()
} else {
  throw new Error('Usage: node scripts/generate-build-identity.mjs [--clean]')
}

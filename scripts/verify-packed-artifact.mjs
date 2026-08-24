import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runtimePayloadIdentity } from './runtime-payload-identity.mjs'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function publicArtifactPath(packageRoot, downloadPath) {
  if (
    typeof downloadPath !== 'string' ||
    !downloadPath.startsWith('/downloads/') ||
    downloadPath.includes('..')
  ) {
    throw new Error('Packed release identity contains an unsafe download path.')
  }
  return path.join(packageRoot, 'public', downloadPath)
}

async function verifyDigest(filename, expected) {
  if (!SHA256_PATTERN.test(expected)) {
    throw new Error('Packed release identity contains an invalid SHA-256 digest.')
  }
  const actual = sha256(await readFile(filename))
  if (actual !== expected) {
    throw new Error(`Packed artifact digest mismatch for ${path.basename(filename)}.`)
  }
  return actual
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/verify-packed-artifact.mjs <webchess.tgz>')
  }
  const artifactPath = path.resolve(process.argv[2])
  const metadata = await lstat(artifactPath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Packed WebChess artifact must be a regular file.')
  }

  const listing = execFileSync('tar', ['-tzf', artifactPath], {
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean)
  const uniqueEntries = new Set(listing)
  if (
    listing.length === 0 ||
    uniqueEntries.size !== listing.length ||
    listing.some((entry) => {
      const segments = entry.split('/')
      return !entry.startsWith('package/') || segments.includes('..')
    })
  ) {
    throw new Error('Packed WebChess artifact contains an unsafe or duplicate path.')
  }
  if (listing.some((entry) => path.posix.basename(entry) === '.npmignore')) {
    throw new Error('Packed WebChess artifact contains an npm control file.')
  }

  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'webchess-packed-artifact-'),
  )
  try {
    execFileSync('tar', [
      '-xzf',
      artifactPath,
      '--directory',
      temporaryRoot,
      '--no-same-owner',
      '--no-same-permissions',
    ], { stdio: 'inherit' })
    const packageRoot = path.join(temporaryRoot, 'package')
    const identity = JSON.parse(
      await readFile(path.join(packageRoot, 'webchess-build-identity.json'), 'utf8'),
    )
    const payload = await runtimePayloadIdentity(packageRoot)
    if (
      identity.format !== 'webchess-build-identity/1' ||
      !/^[0-9a-f]{40}$/u.test(identity.sourceCommit) ||
      identity.runtimePayload?.format !== payload.format ||
      identity.runtimePayload.sha256 !== payload.sha256 ||
      identity.runtimePayload.fileCount !== payload.fileCount ||
      identity.runtimePayload.byteCount !== payload.byteCount
    ) {
      throw new Error('Packed WebChess build identity does not match extracted runtime bytes.')
    }
    const packedLauncher = await import(
      pathToFileURL(
        path.join(packageRoot, 'openclaw-plugin', 'dist', 'launcher.js'),
      ).href
    )
    const launcherIdentity = await packedLauncher.resolveWebChessBuildIdentity(
      packageRoot,
    )
    if (
      launcherIdentity.sourceCommit !== identity.sourceCommit ||
      launcherIdentity.runtimeArtifactSha256 !== payload.sha256
    ) {
      throw new Error('Packed launcher identity does not match extracted runtime bytes.')
    }

    const reviewedLock = await readFile(path.join(projectRoot, 'package-lock.json'))
    const packedLock = await readFile(path.join(packageRoot, 'npm-shrinkwrap.json'))
    if (!reviewedLock.equals(packedLock)) {
      throw new Error('Packed dependency graph does not match package-lock.json.')
    }

    const releaseIdentity = JSON.parse(
      await readFile(
        path.join(packageRoot, 'public', 'downloads', 'webchess-release-identity.json'),
        'utf8',
      ),
    )
    if (
      releaseIdentity.schema !== 'webchess-release-identity/1' ||
      releaseIdentity.status !== 'resolved' ||
      releaseIdentity.source?.commit !== identity.sourceCommit
    ) {
      throw new Error('Packed public release identity does not match the build identity.')
    }
    const sourceSha256 = await verifyDigest(
      publicArtifactPath(packageRoot, releaseIdentity.source.archive.downloadPath),
      releaseIdentity.source.archive.sha256,
    )
    const paperSha256 = await verifyDigest(
      publicArtifactPath(
        packageRoot,
        releaseIdentity.paper.candidate.pdf.downloadPath,
      ),
      releaseIdentity.paper.candidate.pdf.sha256,
    )

    process.stdout.write(`${JSON.stringify({
      format: 'webchess-packed-artifact-verification/1',
      artifactSha256: sha256(await readFile(artifactPath)),
      entryCount: listing.length,
      sourceCommit: identity.sourceCommit,
      runtimePayloadSha256: payload.sha256,
      sourceSha256,
      paperSha256,
    }, null, 2)}\n`)
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true })
  }
}

await main()

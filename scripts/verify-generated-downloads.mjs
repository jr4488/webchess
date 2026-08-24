import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  trustedGitReleaseSource,
  verifyDownloadArtifacts,
} from './verify-packed-artifact.mjs'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const SOURCE_ENTRIES = [
  'INSTALL.md',
  'LICENSE',
  'package.json',
  'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md',
  'docs/WEBCHESS_WHITE_PAPER_V3.md',
  'public',
]

async function collectFiles(root, relativePath, files) {
  const absolutePath = path.join(root, relativePath)
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink()) {
    throw new Error(
      `Generated download verification rejects symbolic links: ${relativePath}.`,
    )
  }
  if (metadata.isDirectory()) {
    for (const child of (await readdir(absolutePath)).sort()) {
      await collectFiles(
        root,
        path.posix.join(relativePath, child),
        files,
      )
    }
    return
  }
  if (!metadata.isFile()) {
    throw new Error(
      `Generated download verification rejects special files: ${relativePath}.`,
    )
  }
  files.set(relativePath, await readFile(absolutePath))
}

export async function verifyGeneratedDownloads(root = projectRoot) {
  const { sourceArchive, sourceCommit } = trustedGitReleaseSource(root)
  const files = new Map()
  for (const entry of SOURCE_ENTRIES) {
    await collectFiles(root, entry, files)
  }
  const verified = verifyDownloadArtifacts(
    files,
    sourceCommit,
    sourceArchive,
  )
  return {
    format: 'webchess-generated-download-verification/1',
    sourceCommit,
    sourceSha256: verified.sourceSha256,
    paperSha256: verified.paperSha256,
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node scripts/verify-generated-downloads.mjs')
  }
  process.stdout.write(
    `${JSON.stringify(await verifyGeneratedDownloads(), null, 2)}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}

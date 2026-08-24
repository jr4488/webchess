import { createHash } from 'node:crypto'
import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises'
import path from 'node:path'

export const RUNTIME_PAYLOAD_ENTRIES = [
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'db',
  'docs',
  'INSTALL.md',
  'LICENSE',
  'next.config.ts',
  'package.json',
  'public',
  'README.md',
  'SECURITY.md',
  'src',
  'SUPPORT.md',
  'tsconfig.json',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function collectFiles(root, relativePath, files) {
  const absolutePath = path.join(root, relativePath)
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink()) {
    throw new Error(`Runtime payload must not contain a symbolic link: ${relativePath}`)
  }
  if (metadata.isDirectory()) {
    const children = (await readdir(absolutePath)).sort()
    for (const child of children) {
      await collectFiles(root, path.posix.join(relativePath, child), files)
    }
    return
  }
  if (!metadata.isFile()) {
    throw new Error(`Runtime payload contains an unsupported file type: ${relativePath}`)
  }
  const bytes = await readFile(absolutePath)
  files.push({
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  })
}

export async function runtimePayloadIdentity(root) {
  const files = []
  for (const entry of RUNTIME_PAYLOAD_ENTRIES) {
    await collectFiles(root, entry, files)
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const manifest = {
    format: 'webchess-runtime-payload/1',
    files,
  }
  return {
    ...manifest,
    fileCount: files.length,
    byteCount: files.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(JSON.stringify(manifest)),
  }
}

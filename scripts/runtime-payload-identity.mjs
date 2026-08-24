import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
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
  'openclaw-plugin/dist',
  'openclaw-plugin/src',
  'openclaw-plugin/tsconfig.json',
  'openclaw.plugin.json',
  'package.json',
  'public',
  'README.md',
  'SECURITY.md',
  'src',
  'SUPPORT.md',
  'tsconfig.json',
]

// npm uses nested .npmignore files to decide what enters a packed artifact,
// but it does not include those control files in the artifact itself. Keep the
// source-side identity aligned with the bytes that the installed launcher can
// actually inspect.
const NPM_PACK_CONTROL_FILES = new Set(['.npmignore'])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function runtimePayloadEntryForPath(relativePath) {
  return RUNTIME_PAYLOAD_ENTRIES.find(
    (entry) => relativePath === entry || relativePath.startsWith(`${entry}/`),
  )
}

function identityFromFiles(files) {
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

async function collectFiles(root, relativePath, files) {
  const absolutePath = path.join(root, relativePath)
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink()) {
    throw new Error(`Runtime payload must not contain a symbolic link: ${relativePath}`)
  }
  if (metadata.isDirectory()) {
    const children = (await readdir(absolutePath)).sort()
    for (const child of children) {
      if (NPM_PACK_CONTROL_FILES.has(child)) continue
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
    mode: (metadata.mode & 0o111) === 0 ? 0o644 : 0o755,
    sha256: sha256(bytes),
  })
}

export async function runtimePayloadIdentity(root) {
  const files = []
  for (const entry of RUNTIME_PAYLOAD_ENTRIES) {
    await collectFiles(root, entry, files)
  }
  return identityFromFiles(files)
}

export function runtimePayloadIdentityFromFiles(entries) {
  const files = []
  const seenPaths = new Set()
  const seenEntries = new Set()
  for (const entry of entries) {
    const relativePath = entry?.path
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      path.posix.normalize(relativePath) !== relativePath ||
      relativePath.startsWith('/') ||
      relativePath.includes('\\') ||
      relativePath.split('/').some((segment) => !segment || segment === '..')
    ) {
      throw new Error('Runtime payload contains an unsafe file path.')
    }
    if (seenPaths.has(relativePath)) {
      throw new Error(`Runtime payload contains a duplicate file: ${relativePath}`)
    }
    seenPaths.add(relativePath)
    const runtimeEntry = runtimePayloadEntryForPath(relativePath)
    if (!runtimeEntry) continue
    if (
      !(Buffer.isBuffer(entry.bytes) || (
        ArrayBuffer.isView(entry.bytes) && entry.bytes.BYTES_PER_ELEMENT === 1
      )) ||
      !Number.isInteger(entry.mode) ||
      (entry.mode !== 0o644 && entry.mode !== 0o755)
    ) {
      throw new Error(`Runtime payload file has invalid bytes or mode: ${relativePath}`)
    }
    seenEntries.add(runtimeEntry)
    files.push({
      path: relativePath,
      bytes: entry.bytes.byteLength,
      mode: entry.mode,
      sha256: sha256(entry.bytes),
    })
  }
  const missingEntries = RUNTIME_PAYLOAD_ENTRIES.filter(
    (entry) => !seenEntries.has(entry),
  )
  if (missingEntries.length > 0) {
    throw new Error(
      `Runtime payload is missing required entries: ${missingEntries.join(', ')}`,
    )
  }
  return identityFromFiles(files)
}

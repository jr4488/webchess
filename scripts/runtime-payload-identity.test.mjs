import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  RUNTIME_PAYLOAD_ENTRIES,
  runtimePayloadIdentity,
  runtimePayloadIdentityFromFiles,
} from './runtime-payload-identity.mjs'

const temporaryRoots = []
const DIRECTORY_ENTRIES = new Set([
  'db',
  'docs',
  'openclaw-plugin/dist',
  'openclaw-plugin/src',
  'public',
  'src',
])

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, {
      force: true,
      recursive: true,
    })),
  )
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'webchess-runtime-payload-'))
  temporaryRoots.push(root)
  for (const entry of RUNTIME_PAYLOAD_ENTRIES) {
    const target = path.join(root, entry)
    if (DIRECTORY_ENTRIES.has(entry)) {
      await mkdir(target, { recursive: true })
      await writeFile(path.join(target, 'payload.txt'), `${entry}\n`)
    } else {
      await writeFile(target, `${entry}\n`)
    }
  }
  return root
}

describe('runtime payload identity', () => {
  it('ignores npm pack control files that npm omits from the artifact', async () => {
    const root = await fixture()
    const before = await runtimePayloadIdentity(root)

    await writeFile(path.join(root, 'public', '.npmignore'), '*\n')
    await mkdir(path.join(root, 'public', 'downloads'))
    await writeFile(
      path.join(root, 'public', 'downloads', '.npmignore'),
      'generated-*\n',
    )

    await expect(runtimePayloadIdentity(root)).resolves.toEqual(before)
  })

  it('continues to bind ordinary nested payload bytes', async () => {
    const root = await fixture()
    const before = await runtimePayloadIdentity(root)

    await writeFile(path.join(root, 'public', 'payload.txt'), 'changed\n')
    const after = await runtimePayloadIdentity(root)

    expect(after.sha256).not.toBe(before.sha256)
    expect(after.byteCount).not.toBe(before.byteCount)
    expect(after.fileCount).toBe(before.fileCount)
  })

  it('binds the executable plugin distribution and OpenClaw manifest', async () => {
    const root = await fixture()
    const before = await runtimePayloadIdentity(root)

    await writeFile(
      path.join(root, 'openclaw-plugin', 'dist', 'payload.txt'),
      'changed executable\n',
    )
    const executableChanged = await runtimePayloadIdentity(root)
    expect(executableChanged.sha256).not.toBe(before.sha256)

    await writeFile(
      path.join(root, 'openclaw.plugin.json'),
      '{"changed":true}\n',
    )
    const manifestChanged = await runtimePayloadIdentity(root)
    expect(manifestChanged.sha256).not.toBe(executableChanged.sha256)
  })

  it('computes the same identity from verified in-memory artifact files', async () => {
    const root = await fixture()
    const filesystemIdentity = await runtimePayloadIdentity(root)
    const files = []
    for (const entry of filesystemIdentity.files) {
      files.push({
        path: entry.path,
        bytes: await readFile(path.join(root, entry.path)),
        mode: entry.mode,
      })
    }

    expect(runtimePayloadIdentityFromFiles(files)).toEqual(filesystemIdentity)
  })

  it('rejects duplicate, unsafe, and incomplete in-memory payloads', () => {
    const files = RUNTIME_PAYLOAD_ENTRIES.map((entry) => ({
      path: DIRECTORY_ENTRIES.has(entry) ? `${entry}/payload.txt` : entry,
      bytes: Buffer.from(entry),
      mode: 0o644,
    }))

    expect(() => runtimePayloadIdentityFromFiles([
      ...files,
      files[0],
    ])).toThrow('duplicate file')
    expect(() => runtimePayloadIdentityFromFiles([
      ...files,
      { path: '../escape', bytes: Buffer.from('escape'), mode: 0o644 },
    ])).toThrow('unsafe file path')
    expect(() => runtimePayloadIdentityFromFiles(files.slice(1))).toThrow(
      'missing required entries',
    )
  })
})

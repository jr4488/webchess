import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  RUNTIME_PAYLOAD_ENTRIES,
  runtimePayloadIdentity,
} from './runtime-payload-identity.mjs'

const temporaryRoots = []

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
    if (['db', 'docs', 'public', 'src'].includes(entry)) {
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
})

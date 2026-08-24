import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanPackedShrinkwrap,
  preparePackedShrinkwrap,
} from './packed-shrinkwrap.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, {
      force: true,
      recursive: true,
    })),
  )
})

async function fixture(lockfileVersion = 3) {
  const root = await mkdtemp(join(tmpdir(), 'webchess-packed-shrinkwrap-'))
  temporaryRoots.push(root)
  await mkdir(root, { recursive: true })
  const lock = `${JSON.stringify({ lockfileVersion, packages: {} }, null, 2)}\n`
  await writeFile(join(root, 'package-lock.json'), lock)
  return { lock, root }
}

describe('packed dependency lock', () => {
  it('copies the reviewed lock byte-for-byte and cleans only its own copy', async () => {
    const { lock, root } = await fixture()

    await preparePackedShrinkwrap(root)
    expect(await readFile(join(root, 'npm-shrinkwrap.json'), 'utf8')).toBe(lock)

    await preparePackedShrinkwrap(root)
    await cleanPackedShrinkwrap(root)
    await expect(readFile(join(root, 'npm-shrinkwrap.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects a lock format that the packed installer cannot reproduce', async () => {
    const { root } = await fixture(2)

    await expect(preparePackedShrinkwrap(root)).rejects.toThrow(
      'requires a reviewed lockfileVersion 3 lock',
    )
  })

  it('does not replace or remove a differing shrinkwrap', async () => {
    const { root } = await fixture()
    const shrinkwrapPath = join(root, 'npm-shrinkwrap.json')
    await writeFile(shrinkwrapPath, '{"owner":"external"}\n')

    await expect(preparePackedShrinkwrap(root)).rejects.toThrow(
      'Refusing to replace an existing npm-shrinkwrap.json',
    )
    await expect(cleanPackedShrinkwrap(root)).rejects.toThrow(
      'Refusing to remove npm-shrinkwrap.json',
    )
    expect(await readFile(shrinkwrapPath, 'utf8')).toBe('{"owner":"external"}\n')
  })
})

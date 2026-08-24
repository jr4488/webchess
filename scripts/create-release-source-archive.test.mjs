import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createReleaseSourceArchive } from './create-release-source-archive.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const COMMIT_TIME = '1787530000'
const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, {
      force: true,
      recursive: true,
    })),
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'webchess-source-archive-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'public', 'downloads'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    '{"name":"webchess","version":"2.2.0-rc.1"}\n',
  )
  return root
}

function cleanGit(statuses = ['', '']) {
  let statusIndex = 0
  return vi.fn(async (arguments_) => {
    if (arguments_[0] === 'status') {
      return statuses[Math.min(statusIndex++, statuses.length - 1)]
    }
    if (arguments_[0] === 'rev-parse') return `${COMMIT}\n`
    if (arguments_[0] === 'show') return `${COMMIT_TIME}\n`
    throw new Error(`Unexpected Git command: ${arguments_.join(' ')}`)
  })
}

function fixtureZip(prefix, comment = COMMIT) {
  const name = Buffer.from(prefix)
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)
  const commentBytes = Buffer.from(comment)
  const end = Buffer.alloc(22 + commentBytes.length)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  end.writeUInt16LE(commentBytes.length, 20)
  commentBytes.copy(end, 22)
  return Buffer.concat([local, central, end])
}

describe('retained release source archive', () => {
  it('binds an atomic ZIP to one clean commit and reports its digest', async () => {
    const root = await fixture()
    const outputPath = join(root, 'public', 'downloads', 'webchess-source.zip')
    let expectedBytes
    const archive = vi.fn(async ({
      commit,
      commitTime,
      outputPath: temporary,
      prefix,
    }) => {
      expect(commit).toBe(COMMIT)
      expect(commitTime).toBe(COMMIT_TIME)
      expect(prefix).toBe(`webchess-${COMMIT}/`)
      expectedBytes = fixtureZip(prefix)
      await writeFile(temporary, expectedBytes)
    })

    const result = await createReleaseSourceArchive({
      archive,
      git: cleanGit(),
      outputPath,
      root,
    })

    expect(result).toMatchObject({
      byteCount: expectedBytes.length,
      commit: COMMIT,
      commitTime: COMMIT_TIME,
      outputPath,
      prefix: `webchess-${COMMIT}/`,
      sha256: createHash('sha256').update(expectedBytes).digest('hex'),
      version: '2.2.0-rc.1',
    })
    expect(await readFile(outputPath)).toEqual(expectedBytes)
  })

  it('refuses dirty or changing source before replacing the output', async () => {
    const root = await fixture()
    const outputPath = join(root, 'public', 'downloads', 'webchess-source.zip')
    const archive = vi.fn(async ({ outputPath: temporary, prefix }) => {
      await writeFile(temporary, fixtureZip(prefix))
    })

    await expect(createReleaseSourceArchive({
      archive,
      git: cleanGit([' M README.md\n']),
      outputPath,
      root,
    })).rejects.toThrow('requires an exact clean HEAD')
    expect(archive).not.toHaveBeenCalled()

    await expect(createReleaseSourceArchive({
      archive,
      git: cleanGit(['', '?? changed-after-archive\n']),
      outputPath,
      root,
    })).rejects.toThrow('requires an exact clean HEAD')
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses outputs outside the repository', async () => {
    const root = await fixture()

    await expect(createReleaseSourceArchive({
      git: cleanGit(),
      outputPath: join(root, '..', 'escape.zip'),
      root,
    })).rejects.toThrow('must remain inside the repository')
  })
})

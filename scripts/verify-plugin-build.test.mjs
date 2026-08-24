import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  comparePluginBuildInventories,
  verifyPluginBuild,
} from './verify-plugin-build.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })))
})

function file(pathname, contents, executable = false) {
  const bytes = Buffer.from(contents)
  return {
    path: pathname,
    bytes: bytes.byteLength,
    executable,
    sha256: createHash('sha256')
      .update(bytes)
      .digest('hex'),
  }
}

async function fixture({
  distributed = { 'index.js': 'export default {}\n' },
  generated = { 'index.js': 'export default {}\n' },
  sources = ['index.ts'],
  status = '',
  tracked = ['index.js'],
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'webchess-plugin-test-'))
  temporaryRoots.push(root)
  const distRoot = path.join(root, 'openclaw-plugin', 'dist')
  const sourceRoot = path.join(root, 'openclaw-plugin', 'src')
  await mkdir(distRoot, { recursive: true })
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    openclaw: {
      extensions: ['./openclaw-plugin/src/index.ts'],
      runtimeExtensions: ['./openclaw-plugin/dist/index.js'],
    },
  })}\n`)
  for (const filename of sources) {
    const target = path.join(sourceRoot, filename)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'export default {}\n')
  }
  for (const [filename, contents] of Object.entries(distributed)) {
    const target = path.join(distRoot, filename)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
  return verifyPluginBuild({
    root,
    compile: async ({ outputRoot }) => {
      for (const [filename, contents] of Object.entries(generated)) {
        const target = path.join(outputRoot, filename)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, contents)
      }
    },
    git: async (arguments_) => arguments_[0] === 'ls-files'
      ? `${tracked.map((filename) => `openclaw-plugin/dist/${filename}`).join('\0')}${tracked.length ? '\0' : ''}`
      : status,
  })
}

describe('OpenClaw plugin source/dist verification', () => {
  it('accepts the exact generated, distributed, tracked, and clean file set', async () => {
    await expect(fixture()).resolves.toMatchObject({
      fileCount: 1,
      format: 'webchess-plugin-build-verification/1',
    })
  })

  it('reports stale generated content', () => {
    expect(() => comparePluginBuildInventories(
      [file('index.js', 'fresh')],
      [file('index.js', 'stale')],
    )).toThrow('dist is stale')
  })

  it('rejects executable-mode drift in a distributed artifact', () => {
    expect(() => comparePluginBuildInventories(
      [file('index.js', 'current')],
      [file('index.js', 'current', true)],
    )).toThrow('dist is stale')
  })

  it('rejects a missing generated output', async () => {
    await expect(fixture({
      generated: {
        'bridge.js': 'export default {}\n',
        'index.js': 'export default {}\n',
      },
      sources: ['bridge.ts', 'index.ts'],
    })).rejects.toThrow('Missing: bridge.js')
  })

  it('rejects an orphan dist output without a source output', async () => {
    await expect(fixture({
      distributed: {
        'index.js': 'export default {}\n',
        'orphan.js': 'orphan\n',
      },
      tracked: ['index.js', 'orphan.js'],
    })).rejects.toThrow('Unexpected: orphan.js')
  })

  it('rejects a production source omitted by the compiler configuration', async () => {
    await expect(fixture({
      sources: ['bridge.ts', 'index.ts'],
    })).rejects.toThrow('Missing: bridge.js')
  })

  it('rejects deletion of both declared entrypoint source and output', async () => {
    await expect(fixture({
      distributed: { 'bridge.js': 'export default {}\n' },
      generated: { 'bridge.js': 'export default {}\n' },
      sources: ['bridge.ts'],
      tracked: ['bridge.js'],
    })).rejects.toThrow('entrypoint source or runtime output is missing')
  })

  it('rejects an untracked generated output even when its bytes are current', async () => {
    await expect(fixture({ tracked: [] })).rejects.toThrow(
      'Missing: index.js',
    )
  })

  it('rejects a tracked output changed by generation', async () => {
    await expect(fixture({ status: ' M openclaw-plugin/dist/index.js\0' }))
      .rejects.toThrow('tracked or untracked changes')
  })
})

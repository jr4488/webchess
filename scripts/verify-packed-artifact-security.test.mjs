import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import {
  candidateWhitePaperWithReleaseHandoff,
  createPdf,
  downloadablePdfMarkdown,
  historicalWhitePaperForDistribution,
  renderWhitePaperHtml,
} from './generate-downloads.mjs'
import { resolveReleaseIdentity } from './release-identity.mjs'
import {
  RUNTIME_PAYLOAD_ENTRIES,
  runtimePayloadEntryForPath,
  runtimePayloadIdentityFromFiles,
} from './runtime-payload-identity.mjs'
import {
  parsePackedArtifact,
  trustedGitReleaseSource,
  verifyPackedArtifactBytes,
} from './verify-packed-artifact.mjs'

const COMMIT = '0384978b2ba709da4c9824f2821c8623d3f84364'
const DIRECTORY_ENTRIES = new Set([
  'db',
  'docs',
  'openclaw-plugin/dist',
  'openclaw-plugin/src',
  'public',
  'src',
])
const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })))
})

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitBlobObjectId(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex')
}

function trustedRuntimeFiles(files) {
  return files
    .filter((file) => (
      runtimePayloadEntryForPath(file.path) &&
      !file.path.startsWith('public/downloads/')
    ))
    .map((file) => ({
      path: file.path,
      mode: file.mode,
      objectId: gitBlobObjectId(file.bytes),
    }))
}

function writeString(header, value, offset, length) {
  const bytes = Buffer.from(value)
  if (bytes.length > length) throw new Error(`Test tar field is too long: ${value}`)
  bytes.copy(header, offset)
}

function writeOctal(header, value, offset, length) {
  writeString(
    header,
    `${value.toString(8).padStart(length - 1, '0')}\0`,
    offset,
    length,
  )
}

function writeTarChecksum(header) {
  header.fill(0x20, 148, 156)
  const checksum = header.reduce((total, byte) => total + byte, 0)
  writeString(
    header,
    `${checksum.toString(8).padStart(6, '0')}\0 `,
    148,
    8,
  )
}

function tarHeader({
  bytes,
  linkName = '',
  mode = 0o644,
  path,
  type = '0',
}) {
  const header = Buffer.alloc(512)
  writeString(header, path, 0, 100)
  writeOctal(header, mode, 100, 8)
  writeOctal(header, 0, 108, 8)
  writeOctal(header, 0, 116, 8)
  writeOctal(header, bytes.length, 124, 12)
  writeOctal(header, 499_162_500, 136, 12)
  header.fill(0x20, 148, 156)
  writeString(header, type, 156, 1)
  writeString(header, linkName, 157, 100)
  writeString(header, 'ustar\0', 257, 6)
  writeString(header, '00', 263, 2)
  writeTarChecksum(header)
  return header
}

function packedArtifact(entries) {
  const parts = []
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes ?? '')
    parts.push(tarHeader({ ...entry, bytes }), bytes)
    const padding = (512 - (bytes.length % 512)) % 512
    if (padding) parts.push(Buffer.alloc(padding))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

function verifiedFixture() {
  const sourceBytes = Buffer.from('canonical source archive')
  const reviewedLock = Buffer.from('{"lockfileVersion":3}\n')
  const installation = '# Install\n\nAccount auth only.\n'
  const license = 'Fixture license\n'
  const candidateSource = [
    '# Candidate',
    '',
    '<!-- WEBCHESS_RELEASE_HANDOFF -->',
    '',
    'No efficacy claim.',
  ].join('\n')
  const historicalSource = '# Historical\n\nPreserved evidence.\n'
  const packageSource = `${JSON.stringify({
    name: 'webchess',
    version: '2.2.0-rc.1',
  })}\n`
  const candidateMarkdown = candidateWhitePaperWithReleaseHandoff(
    candidateSource,
    COMMIT,
  )
  const candidateHtml = renderWhitePaperHtml(
    candidateMarkdown,
    new Map(),
    {
      documentTitle: 'The Arachne Method and WebChess',
      sourceCommit: COMMIT,
      sourcePath: 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md',
    },
  )
  const candidatePdf = createPdf(
    downloadablePdfMarkdown(candidateMarkdown),
    '2.2.0-rc.1',
    new Map(),
    {
      documentTitle: 'The Arachne Method and WebChess',
      linkAnnotations: true,
    },
  )
  const historicalMarkdown = historicalWhitePaperForDistribution(
    historicalSource,
  )
  const historicalHtml = renderWhitePaperHtml(
    historicalMarkdown,
    new Map(),
  )
  const historicalPdf = createPdf(
    downloadablePdfMarkdown(historicalMarkdown),
    '2.2.0',
    new Map(),
  )
  const releaseIdentity = resolveReleaseIdentity({
    paperPdfSha256: sha256(candidatePdf),
    paperRepositoryPath: 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md',
    sourceArchiveSha256: sha256(sourceBytes),
    sourceCommit: COMMIT,
  })
  const files = RUNTIME_PAYLOAD_ENTRIES.flatMap((entry) => {
    if (entry === 'openclaw-plugin/dist') {
      return [
        {
          path: 'openclaw-plugin/dist/launcher.js',
          bytes: Buffer.from('throw new Error("artifact code executed")\n'),
        },
        {
          path: 'openclaw-plugin/dist/index.js',
          bytes: Buffer.from('export default {}\n'),
        },
      ]
    }
    if (entry === 'openclaw-plugin/src') {
      return [{
        path: 'openclaw-plugin/src/index.ts',
        bytes: Buffer.from('export default {}\n'),
      }]
    }
    if (entry === 'package.json') {
      return [{ path: entry, bytes: Buffer.from(packageSource) }]
    }
    if (entry === 'INSTALL.md') {
      return [{ path: entry, bytes: Buffer.from(installation) }]
    }
    if (entry === 'LICENSE') {
      return [{ path: entry, bytes: Buffer.from(license) }]
    }
    if (entry === 'docs') {
      return [
        {
          path: 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md',
          bytes: Buffer.from(candidateSource),
        },
        {
          path: 'docs/WEBCHESS_WHITE_PAPER_V3.md',
          bytes: Buffer.from(historicalSource),
        },
      ]
    }
    if (entry === 'public') {
      return [
        { path: 'public/downloads/LICENSE', bytes: Buffer.from(license) },
        {
          path: 'public/downloads/webchess-installation.md',
          bytes: Buffer.from(installation),
        },
        {
          path: 'public/downloads/webchess-white-paper.html',
          bytes: Buffer.from(candidateHtml),
        },
        {
          path: 'public/downloads/webchess-white-paper.md',
          bytes: Buffer.from(candidateMarkdown),
        },
        {
          path: 'public/downloads/webchess-white-paper.pdf',
          bytes: candidatePdf,
        },
        {
          path: 'public/downloads/webchess-white-paper-v3-historical.html',
          bytes: Buffer.from(historicalHtml),
        },
        {
          path: 'public/downloads/webchess-white-paper-v3-historical.md',
          bytes: Buffer.from(historicalMarkdown),
        },
        {
          path: 'public/downloads/webchess-white-paper-v3-historical.pdf',
          bytes: historicalPdf,
        },
        {
          path: 'public/downloads/webchess-release-identity.json',
          bytes: Buffer.from(`${JSON.stringify(releaseIdentity, null, 2)}\n`),
        },
        {
          path: `public${releaseIdentity.source.archive.downloadPath}`,
          bytes: sourceBytes,
        },
      ]
    }
    return [{
      path: DIRECTORY_ENTRIES.has(entry) ? `${entry}/payload.txt` : entry,
      bytes: Buffer.from(`${entry}\n`),
    }]
  }).map((entry) => ({ ...entry, mode: 0o644 }))
  const payload = runtimePayloadIdentityFromFiles(files)
  const identity = {
    format: 'webchess-build-identity/1',
    package: { name: 'webchess', version: '2.2.0-rc.1' },
    sourceCommit: COMMIT,
    runtimePayload: {
      format: payload.format,
      sha256: payload.sha256,
      fileCount: payload.fileCount,
      byteCount: payload.byteCount,
    },
  }
  const archiveEntries = [
    ...files,
    {
      path: 'webchess-build-identity.json',
      bytes: Buffer.from(`${JSON.stringify(identity)}\n`),
    },
    { path: 'npm-shrinkwrap.json', bytes: reviewedLock },
  ].map((entry) => ({
    ...entry,
    path: `package/${entry.path}`,
    mode: entry.mode ?? 0o644,
  }))
  return {
    archiveEntries,
    reviewedLock,
    trustedSource: {
      objectFormat: 'sha1',
      package: { name: 'webchess', version: '2.2.0-rc.1' },
      runtimeFiles: trustedRuntimeFiles(files),
      sourceArchive: sourceBytes,
      sourceCommit: COMMIT,
    },
  }
}

function restampFixture(archiveEntries) {
  const files = archiveEntries.map((entry) => ({
    path: entry.path.slice('package/'.length),
    bytes: entry.bytes,
    mode: entry.mode,
  }))
  const payload = runtimePayloadIdentityFromFiles(files)
  const identityEntry = archiveEntries.find(
    (entry) => entry.path === 'package/webchess-build-identity.json',
  )
  const identity = JSON.parse(identityEntry.bytes.toString('utf8'))
  identity.runtimePayload = {
    format: payload.format,
    sha256: payload.sha256,
    fileCount: payload.fileCount,
    byteCount: payload.byteCount,
  }
  identityEntry.bytes = Buffer.from(`${JSON.stringify(identity)}\n`)
  return {
    objectFormat: 'sha1',
    package: { name: 'webchess', version: '2.2.0-rc.1' },
    runtimeFiles: trustedRuntimeFiles(files),
    sourceArchive: archiveEntries.find((entry) =>
      entry.path.startsWith('package/public/downloads/webchess-source-'))
      .bytes,
    sourceCommit: COMMIT,
  }
}

describe('packed artifact tar boundary', () => {
  it('derives the trusted archive from one clean Git HEAD and rejects drift', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webchess-trusted-git-'))
    temporaryRoots.push(root)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    await writeFile(path.join(root, 'README.md'), '# Trusted fixture\n')
    execFileSync('git', ['add', 'README.md'], { cwd: root })
    execFileSync('git', [
      '-c',
      'user.name=WebChess Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-08-24T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-08-24T00:00:00Z',
      },
    })

    const trusted = trustedGitReleaseSource(root)
    expect(trusted.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(trusted.sourceArchive.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    )
    expect(trusted.sourceArchive.includes(
      Buffer.from(trusted.sourceCommit),
    )).toBe(true)
    expect(trusted.objectFormat).toBe('sha1')
    expect(trusted.runtimeFiles).toEqual([
      expect.objectContaining({ path: 'README.md', mode: 0o644 }),
    ])

    await writeFile(path.join(root, 'README.md'), '# Dirty fixture\n')
    expect(() => trustedGitReleaseSource(root)).toThrow(
      'exact clean trusted checkout',
    )
  })

  it('accepts the exact regular-file archive emitted by npm pack', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webchess-real-npm-pack-'))
    temporaryRoots.push(root)
    const outputRoot = path.join(root, 'output')
    await mkdir(outputRoot)
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify({
        files: ['index.js'],
        name: 'webchess-pack-fixture',
        version: '1.0.0',
      })}\n`,
    )
    await writeFile(path.join(root, 'index.js'), 'export default true\n')
    const report = JSON.parse(execFileSync('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      outputRoot,
    ], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
    const entries = parsePackedArtifact(
      await readFile(path.join(outputRoot, report[0].filename)),
    )

    expect(entries.map((entry) => entry.path).sort()).toEqual([
      'package/index.js',
      'package/package.json',
    ])
  })

  it('accepts a canonical regular-file ustar payload without executing its JavaScript', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    const artifact = packedArtifact(archiveEntries)

    expect(verifyPackedArtifactBytes(
      artifact,
      reviewedLock,
      trustedSource,
    )).toMatchObject({
      entryCount: archiveEntries.length,
      sourceCommit: COMMIT,
    })
  })

  it.each([
    {
      label: 'a duplicate',
      entries: [
        { path: 'package/file', bytes: 'one' },
        { path: 'package/file', bytes: 'two' },
      ],
      error: 'duplicate path',
    },
    {
      label: 'a traversal path',
      entries: [{ path: 'package/../escape', bytes: 'escape' }],
      error: 'unsafe path',
    },
    {
      label: 'a symlink',
      entries: [{
        path: 'package/link',
        bytes: '',
        linkName: '../../escape',
        type: '2',
      }],
      error: 'non-regular tar entry',
    },
    {
      label: 'a hard link',
      entries: [{
        path: 'package/link',
        bytes: '',
        linkName: 'package/file',
        type: '1',
      }],
      error: 'non-regular tar entry',
    },
    {
      label: 'a PAX path override',
      entries: [{ path: 'package/pax', bytes: 'path=escape', type: 'x' }],
      error: 'non-regular tar entry',
    },
    {
      label: 'a GNU long-name record',
      entries: [{ path: 'package/long', bytes: 'escape', type: 'L' }],
      error: 'non-regular tar entry',
    },
    {
      label: 'a special device',
      entries: [{ path: 'package/device', bytes: '', type: '3' }],
      error: 'non-regular tar entry',
    },
    {
      label: 'an npm control file',
      entries: [{ path: 'package/public/.npmignore', bytes: '*' }],
      error: 'npm control file',
    },
  ])('rejects $label before reading package content', ({ entries, error }) => {
    expect(() => parsePackedArtifact(packedArtifact(entries))).toThrow(error)
  })

  it('rejects a header checksum mismatch', () => {
    const tar = gunzipSync(packedArtifact([
      { path: 'package/file', bytes: 'content' },
    ]))
    tar[100] ^= 1

    expect(() => parsePackedArtifact(gzipSync(tar))).toThrow(
      'invalid tar checksum',
    )
  })

  it('rejects concatenated gzip members and bytes after one gzip member', () => {
    const member = packedArtifact([
      { path: 'package/file', bytes: 'content' },
    ])

    expect(() => parsePackedArtifact(Buffer.concat([member, member]))).toThrow(
      'exactly one gzip member',
    )
    expect(() => parsePackedArtifact(Buffer.concat([
      member,
      Buffer.from('trailing'),
    ]))).toThrow('exactly one gzip member')
  })

  it('rejects nonzero content after the canonical tar end record', () => {
    const tar = gunzipSync(packedArtifact([
      { path: 'package/file', bytes: 'content' },
    ]))
    const ambiguous = Buffer.concat([tar, Buffer.alloc(512)])
    ambiguous[ambiguous.length - 1] = 1

    expect(() => parsePackedArtifact(gzipSync(ambiguous))).toThrow(
      'invalid tar end record',
    )
  })

  it('rejects a tar header claiming a file over the per-file bound', () => {
    const tar = gunzipSync(packedArtifact([
      { path: 'package/file', bytes: 'content' },
    ]))
    const header = tar.subarray(0, 512)
    writeOctal(header, 129 * 1024 * 1024, 124, 12)
    writeTarChecksum(header)

    expect(() => parsePackedArtifact(gzipSync(tar))).toThrow(
      'oversized tar file',
    )
  })

  it('rejects rehashed malicious code that does not match the trusted checkout', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    const launcher = archiveEntries.find(
      (entry) => entry.path === 'package/openclaw-plugin/dist/launcher.js',
    )
    launcher.bytes = Buffer.from('export const changed = true\n')
    restampFixture(archiveEntries)

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      trustedSource,
    )).toThrow('does not match the trusted source')
  })

  it('rejects a mode-only runtime mutation even if the identity is restamped', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    const launcher = archiveEntries.find(
      (entry) => entry.path === 'package/openclaw-plugin/dist/launcher.js',
    )
    launcher.mode = 0o755
    restampFixture(archiveEntries)

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      trustedSource,
    )).toThrow('does not match the trusted source')
  })

  it('rejects extra or rewritten build-identity package metadata', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    const identityEntry = archiveEntries.find(
      (entry) => entry.path === 'package/webchess-build-identity.json',
    )
    const identity = JSON.parse(identityEntry.bytes.toString('utf8'))
    identity.package.version = '9.9.9'
    identity.unreviewed = true
    identityEntry.bytes = Buffer.from(`${JSON.stringify(identity)}\n`)

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      trustedSource,
    )).toThrow('does not match the trusted source')
  })

  it('rejects dependency-shadowing files outside the exact package contract', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    archiveEntries.push({
      path: 'package/node_modules/openclaw/index.js',
      bytes: Buffer.from('export const shadowed = true\n'),
    })

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      trustedSource,
    )).toThrow('dependency-shadowing path')
  })

  it('rejects an ignored dependency shadow nested below an allowed runtime prefix', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    archiveEntries.push({
      path: 'package/openclaw-plugin/dist/node_modules/openclaw/index.js',
      bytes: Buffer.from('export const shadowed = true\n'),
    })

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      trustedSource,
    )).toThrow('dependency-shadowing path')
  })

  it('rejects a stale generated download even if the payload is restamped', () => {
    const { archiveEntries, reviewedLock } = verifiedFixture()
    const installation = archiveEntries.find(
      (entry) => entry.path ===
        'package/public/downloads/webchess-installation.md',
    )
    installation.bytes = Buffer.from('# Stale installation\n')
    const restampedSource = restampFixture(archiveEntries)

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      restampedSource,
    )).toThrow('generated download is stale')
  })

  it('rejects a source archive and manifest restamped away from Git HEAD', () => {
    const { archiveEntries, reviewedLock, trustedSource } = verifiedFixture()
    const sourceArchive = archiveEntries.find((entry) =>
      entry.path.startsWith('package/public/downloads/webchess-source-'))
    sourceArchive.bytes = Buffer.from('unrelated but self-consistent source')
    const manifestEntry = archiveEntries.find(
      (entry) => entry.path ===
        'package/public/downloads/webchess-release-identity.json',
    )
    const manifest = JSON.parse(manifestEntry.bytes.toString('utf8'))
    manifest.source.archive.sha256 = sha256(sourceArchive.bytes)
    manifestEntry.bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
    const restampedSource = restampFixture(archiveEntries)
    restampedSource.sourceArchive = trustedSource.sourceArchive

    expect(() => verifyPackedArtifactBytes(
      packedArtifact(archiveEntries),
      reviewedLock,
      restampedSource,
    )).toThrow('generated download is stale or noncanonical')
  })
})

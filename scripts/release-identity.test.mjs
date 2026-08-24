import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RELEASE_IDENTITY_TEMPLATE_PATH,
  checkPublicReleaseArtifacts,
  checkReleaseIdentity,
  generateReleaseIdentity,
  resolveReleaseIdentity,
  unresolvedReleaseIdentityTemplate,
  validateReleaseIdentityTemplate,
  validateResolvedReleaseIdentity,
} from './release-identity.mjs'

const COMMIT = '0384978b2ba709da4c9824f2821c8623d3f84364'
const CANDIDATE_PAPER_PATH = 'docs/WEBCHESS_WHITE_PAPER_V3_1.md'
const HISTORICAL_PAPER_PATH = 'docs/WEBCHESS_WHITE_PAPER_V3.md'
const PAPER_PDF = Buffer.from('%PDF-1.4\nexact paper PDF bytes')
const CODEX_SEARCH_DEPENDENCY = Object.freeze({
  package: '@openclaw/codex',
  version: '2026.7.1-1',
  npmIntegrity:
    'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==',
  provider: 'codex',
  authPolicy: 'same-openai-account-oauth',
  transport: 'managed-private-stdio-agent-scoped',
  apiKeyFallback: false,
})

function fixtureSourceArchive(commit) {
  const prefix = `webchess-${commit}/`
  const name = Buffer.from(prefix)
  const local = Buffer.alloc(30 + name.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)
  const comment = Buffer.from(commit)
  const end = Buffer.alloc(22 + comment.length)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  end.writeUInt16LE(comment.length, 20)
  comment.copy(end, 22)
  return Buffer.concat([local, central, end])
}

const SOURCE_ARCHIVE = fixtureSourceArchive(COMMIT)
const SOURCE_ARCHIVE_SHA256 = createHash('sha256')
  .update(SOURCE_ARCHIVE)
  .digest('hex')
const PAPER_PDF_SHA256 = createHash('sha256')
  .update(PAPER_PDF)
  .digest('hex')
const execFileAsync = promisify(execFile)

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, {
      force: true,
      recursive: true,
    })),
  )
})

async function writeFixtureFile(root, path, contents) {
  const absolutePath = join(root, path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents, 'utf8')
  return absolutePath
}

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'webchess-release-identity-'))
  temporaryRoots.push(root)
  const templatePath = await writeFixtureFile(
    root,
    'docs/releases/webchess-release-identity.template.json',
    `${JSON.stringify(unresolvedReleaseIdentityTemplate(), null, 2)}\n`,
  )
  await writeFixtureFile(
    root,
    CANDIDATE_PAPER_PATH,
    '# Candidate\n\n**Paper version:** 3.1\\\n',
  )
  await writeFixtureFile(
    root,
    HISTORICAL_PAPER_PATH,
    '# Historical\n\n**Paper version:** 3.0\\\n',
  )
  await writeFixtureFile(
    root,
    'public/downloads/webchess-white-paper.pdf',
    PAPER_PDF,
  )
  await writeFixtureFile(
    root,
    `public/downloads/webchess-source-${COMMIT}.zip`,
    SOURCE_ARCHIVE,
  )
  await writeFixtureFile(root, '.gitignore', 'public/downloads\n')
  return {
    identityPath: join(
      root,
      'public/downloads/webchess-release-identity.json',
    ),
    root,
    templatePath,
  }
}

function releaseInputs(overrides = {}) {
  return {
    paperPdfSha256: PAPER_PDF_SHA256,
    paperRepositoryPath: CANDIDATE_PAPER_PATH,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    sourceCommit: COMMIT,
    ...overrides,
  }
}

function cleanGit({ head = COMMIT, status = '' } = {}) {
  const papers = new Set([
    CANDIDATE_PAPER_PATH,
    HISTORICAL_PAPER_PATH,
  ])
  return vi.fn(async (arguments_) => {
    if (arguments_[0] === 'status') return status
    if (arguments_[0] === 'rev-parse') return `${head}\n`
    if (arguments_[0] === 'ls-files') {
      const path = arguments_.at(-1)
      if (papers.has(path)) return `${path}\0`
      throw new Error('not tracked')
    }
    throw new Error(`Unexpected Git command: ${arguments_.join(' ')}`)
  })
}

describe('release identity provenance', () => {
  it('keeps the tracked template unresolved while pinning fixed provenance', async () => {
    const template = JSON.parse(
      await readFile(RELEASE_IDENTITY_TEMPLATE_PATH, 'utf8'),
    )

    expect(validateReleaseIdentityTemplate(template)).toBe(template)
    expect(template).toMatchObject({
      schema: 'webchess-release-identity/1',
      status: 'unresolved',
      release: {
        version: '2.2.0-rc.1',
        naming: {
          method: 'The Arachne Method',
          software: 'WebChess',
          anansi: 'Anansi/Division field-construction mnemonic',
        },
        caseBundleSchema: 'webchess-case-bundle/1',
      },
      paper: {
        candidate: { edition: '3.1', repositoryPath: null },
        historical: {
          edition: '3.0',
          repositoryPath: HISTORICAL_PAPER_PATH,
        },
      },
      dependencies: {
        openclaw: {
          version: '2026.7.1-2',
          sourceTag: 'v2026.7.1-2',
          sourceCommit: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
          npmIntegrity:
            'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==',
        },
        codexSearch: CODEX_SEARCH_DEPENDENCY,
      },
      toolchains: {
        node: '24.19.0',
        npm: '11.14.1',
        postgresql: {
          version: '17.10',
          image: 'postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193',
        },
        browser: {
          name: 'Google Chrome',
          version: '150.0.7871.128',
        },
      },
    })
    expect(() => validateResolvedReleaseIdentity(template)).toThrow(
      'source.commit is unresolved',
    )
  })

  it.each([
    ['package', '@openclaw/codex-next'],
    ['version', '2026.7.1'],
    ['npmIntegrity', 'sha512-unreviewed'],
    ['provider', 'alternate'],
    ['authPolicy', 'api-key'],
    ['transport', 'custom-network'],
    ['apiKeyFallback', true],
  ])('rejects Codex Search dependency drift in %s', (field, driftedValue) => {
    const template = structuredClone(unresolvedReleaseIdentityTemplate())
    template.dependencies.codexSearch[field] = driftedValue
    expect(() => validateReleaseIdentityTemplate(template)).toThrow(
      'must retain the exact unresolved',
    )

    const identity = structuredClone(resolveReleaseIdentity(releaseInputs()))
    identity.dependencies.codexSearch[field] = driftedValue
    expect(() => validateResolvedReleaseIdentity(identity)).toThrow(
      'does not match the canonical',
    )
  })

  it('generates an ignored artifact only for injected values matching a clean HEAD', async () => {
    const fixture = await releaseFixture()
    const git = cleanGit()

    const identity = await generateReleaseIdentity({
      git,
      inputs: releaseInputs(),
      outputPath: fixture.identityPath,
      root: fixture.root,
      templatePath: fixture.templatePath,
    })

    expect(identity.source).toEqual({
      repository: 'https://github.com/jr4488/webchess',
      commit: COMMIT,
      archive: {
        downloadPath: `/downloads/webchess-source-${COMMIT}.zip`,
        sha256: SOURCE_ARCHIVE_SHA256,
      },
    })
    expect(identity.status).toBe('resolved')
    expect(identity.paper.candidate).toEqual({
      edition: '3.1',
      repositoryPath: CANDIDATE_PAPER_PATH,
      pdf: {
        downloadPath: '/downloads/webchess-white-paper.pdf',
        sha256: PAPER_PDF_SHA256,
      },
    })
    expect(identity.dependencies.codexSearch).toEqual(
      CODEX_SEARCH_DEPENDENCY,
    )
    await expect(readFile(fixture.identityPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(identity, null, 2)}\n`,
    )
    await expect(checkPublicReleaseArtifacts({
      environment: { WEBCHESS_RELEASE_SHA: COMMIT },
      identityPath: fixture.identityPath,
      root: fixture.root,
      templatePath: fixture.templatePath,
    })).resolves.toEqual(identity)
    expect(git).toHaveBeenCalledWith([
      'ls-files',
      '-z',
      '--error-unmatch',
      '--',
      HISTORICAL_PAPER_PATH,
    ])
  })

  it('runs generation and checking end to end against a real clean Git HEAD', async () => {
    const fixture = await releaseFixture()
    const git = (arguments_) => execFileAsync('git', arguments_, {
      cwd: fixture.root,
      encoding: 'utf8',
    })
    await git(['init', '--quiet'])
    await git(['config', 'user.name', 'Release Test'])
    await git(['config', 'user.email', 'release-test@example.invalid'])
    await git(['add', '.'])
    await git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'])
    const { stdout } = await git(['rev-parse', 'HEAD'])
    const commit = stdout.trim()
    const archive = fixtureSourceArchive(commit)
    await writeFile(
      join(
        fixture.root,
        'public',
        'downloads',
        `webchess-source-${commit}.zip`,
      ),
      archive,
    )

    const identity = await generateReleaseIdentity({
      inputs: releaseInputs({
        sourceArchiveSha256: createHash('sha256').update(archive).digest('hex'),
        sourceCommit: commit,
      }),
      outputPath: fixture.identityPath,
      root: fixture.root,
      templatePath: fixture.templatePath,
    })

    await expect(checkReleaseIdentity({
      identityPath: fixture.identityPath,
      root: fixture.root,
      templatePath: fixture.templatePath,
    })).resolves.toEqual(identity)
    await expect(git(['status', '--porcelain=v1'])).resolves.toMatchObject({
      stdout: '',
    })
  })

  it('refuses dirty source and an injected source SHA that differs from HEAD', async () => {
    const dirtyFixture = await releaseFixture()
    await expect(generateReleaseIdentity({
      git: cleanGit({ status: ' M package.json\n' }),
      inputs: releaseInputs(),
      outputPath: dirtyFixture.identityPath,
      root: dirtyFixture.root,
      templatePath: dirtyFixture.templatePath,
    })).rejects.toThrow('requires an exact clean HEAD')

    const mismatchedFixture = await releaseFixture()
    await expect(generateReleaseIdentity({
      git: cleanGit({ head: '1234567890abcdef1234567890abcdef12345678' }),
      inputs: releaseInputs(),
      outputPath: mismatchedFixture.identityPath,
      root: mismatchedFixture.root,
      templatePath: mismatchedFixture.templatePath,
    })).rejects.toThrow('must exactly equal the clean release HEAD')
  })

  it('visibly rejects missing, placeholder, and historical-paper inputs', () => {
    expect(() => resolveReleaseIdentity()).toThrow(
      'source.commit is unresolved',
    )
    expect(() => resolveReleaseIdentity(releaseInputs({
      paperPdfSha256: '0'.repeat(64),
    }))).toThrow('paper.candidate.pdf.sha256 is missing or a placeholder')
    expect(() => resolveReleaseIdentity(releaseInputs({
      paperRepositoryPath: HISTORICAL_PAPER_PATH,
    }))).toThrow('not the preserved edition 3.0 path')
  })

  it('checks the resolved artifact against the exact clean HEAD and both papers', async () => {
    const fixture = await releaseFixture()
    const identity = resolveReleaseIdentity(releaseInputs())
    await writeFixtureFile(
      fixture.root,
      'public/downloads/webchess-release-identity.json',
      `${JSON.stringify(identity, null, 2)}\n`,
    )

    await expect(checkReleaseIdentity({
      git: cleanGit(),
      identityPath: fixture.identityPath,
      root: fixture.root,
    })).resolves.toEqual(identity)

    await expect(checkReleaseIdentity({
      git: cleanGit({
        head: '1234567890abcdef1234567890abcdef12345678',
      }),
      identityPath: fixture.identityPath,
      root: fixture.root,
    })).rejects.toThrow('does not describe the exact clean HEAD')
  })

  it('fails verification when the artifact is unresolved or a paper edition lies', async () => {
    const fixture = await releaseFixture()
    await expect(checkReleaseIdentity({
      git: cleanGit(),
      identityPath: fixture.templatePath,
      root: fixture.root,
    })).rejects.toThrow('source.commit is unresolved')

    const identity = resolveReleaseIdentity(releaseInputs())
    await writeFixtureFile(
      fixture.root,
      'public/downloads/webchess-release-identity.json',
      `${JSON.stringify(identity, null, 2)}\n`,
    )
    await writeFixtureFile(
      fixture.root,
      CANDIDATE_PAPER_PATH,
      '# Candidate\n\n**Paper version:** 3.0\\\n',
    )
    await expect(checkReleaseIdentity({
      git: cleanGit(),
      identityPath: fixture.identityPath,
      root: fixture.root,
    })).rejects.toThrow(
      'does not identify itself as paper version or edition 3.1',
    )
  })

  it('rejects candidate PDF bytes that do not match the declared digest', async () => {
    const fixture = await releaseFixture()
    const identity = resolveReleaseIdentity(releaseInputs())
    await writeFixtureFile(
      fixture.root,
      'public/downloads/webchess-release-identity.json',
      `${JSON.stringify(identity, null, 2)}\n`,
    )
    await writeFixtureFile(
      fixture.root,
      'public/downloads/webchess-white-paper.pdf',
      Buffer.from('%PDF-1.4\ndifferent candidate paper'),
    )

    await expect(checkReleaseIdentity({
      git: cleanGit(),
      identityPath: fixture.identityPath,
      root: fixture.root,
    })).rejects.toThrow(
      'edition 3.1 PDF bytes do not match paper.candidate.pdf.sha256',
    )
  })
})

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
const SOURCE_ARCHIVE_SHA256 = createHash('sha256')
  .update('exact source archive bytes')
  .digest('hex')
const PAPER_PDF_SHA256 = createHash('sha256')
  .update('exact paper PDF bytes')
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
      release: {
        version: '2.2.0-rc.1',
        method: 'Arachne Method',
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
          commit: '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c',
        },
      },
      toolchains: {
        node: '24.19.0',
        npm: '11.14.1',
        postgresql: '17',
      },
    })
    expect(() => validateResolvedReleaseIdentity(template)).toThrow(
      'source.commit is unresolved',
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
        downloadPath: '/downloads/webchess-source.zip',
        sha256: SOURCE_ARCHIVE_SHA256,
      },
    })
    expect(identity.paper.candidate).toEqual({
      edition: '3.1',
      repositoryPath: CANDIDATE_PAPER_PATH,
      pdf: {
        downloadPath: '/downloads/webchess-white-paper.pdf',
        sha256: PAPER_PDF_SHA256,
      },
    })
    await expect(readFile(fixture.identityPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(identity, null, 2)}\n`,
    )
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

    const identity = await generateReleaseIdentity({
      inputs: releaseInputs({ sourceCommit: commit }),
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
})

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import {
  dirname,
  join,
  posix,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export const RELEASE_IDENTITY_TEMPLATE_PATH = join(
  repositoryRoot,
  'docs',
  'releases',
  'webchess-release-identity.template.json',
)
export const RELEASE_IDENTITY_OUTPUT_PATH = join(
  repositoryRoot,
  'public',
  'downloads',
  'webchess-release-identity.json',
)

const HISTORICAL_PAPER_PATH = 'docs/WEBCHESS_WHITE_PAPER_V3.md'
const OPENCLAW_COMMIT = '0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c'
const PLACEHOLDER_PATTERN = /(?:example|insert|placeholder|replace|tbd|todo|unresolved)/iu

export const RELEASE_INPUT_ENVIRONMENT = Object.freeze({
  paperPdfSha256: 'WEBCHESS_RELEASE_PAPER_PDF_SHA256',
  paperRepositoryPath: 'WEBCHESS_RELEASE_PAPER_PATH',
  sourceArchiveSha256: 'WEBCHESS_RELEASE_SOURCE_ARCHIVE_SHA256',
  sourceCommit: 'WEBCHESS_RELEASE_SOURCE_SHA',
})

export class ReleaseIdentityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReleaseIdentityError'
  }
}

function templatePathForRoot(root) {
  return join(
    root,
    'docs',
    'releases',
    'webchess-release-identity.template.json',
  )
}

function releaseIdentityShape({
  paperPdfSha256 = null,
  paperRepositoryPath = null,
  sourceArchiveSha256 = null,
  sourceCommit = null,
} = {}) {
  const resolved = Boolean(
    paperPdfSha256 &&
    paperRepositoryPath &&
    sourceArchiveSha256 &&
    sourceCommit,
  )

  return {
    schema: 'webchess-release-identity/1',
    status: resolved ? 'resolved' : 'unresolved',
    release: {
      product: 'WebChess',
      version: '2.2.0-rc.1',
      naming: {
        method: 'The Arachne Method',
        software: 'WebChess',
        anansi: 'Anansi/Division field-construction mnemonic',
      },
      caseBundleSchema: 'webchess-case-bundle/1',
    },
    source: {
      repository: 'https://github.com/jr4488/webchess',
      commit: sourceCommit,
      archive: {
        downloadPath: '/downloads/webchess-source.zip',
        sha256: sourceArchiveSha256,
      },
    },
    paper: {
      candidate: {
        edition: '3.1',
        repositoryPath: paperRepositoryPath,
        pdf: {
          downloadPath: '/downloads/webchess-white-paper.pdf',
          sha256: paperPdfSha256,
        },
      },
      historical: {
        edition: '3.0',
        repositoryPath: HISTORICAL_PAPER_PATH,
      },
    },
    dependencies: {
      openclaw: {
        version: '2026.7.1-2',
        sourceTag: 'v2026.7.1-2',
        sourceCommit: OPENCLAW_COMMIT,
        npmIntegrity:
          'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==',
      },
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
  }
}

export function unresolvedReleaseIdentityTemplate() {
  return releaseIdentityShape()
}

function canonicalHex(value, length, field, inputName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ReleaseIdentityError(
      `${field} is unresolved; inject ${inputName} after the release commit exists.`,
    )
  }

  const normalized = value.trim().toLowerCase()
  if (
    PLACEHOLDER_PATTERN.test(normalized) ||
    !new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(normalized) ||
    new Set(normalized).size === 1
  ) {
    throw new ReleaseIdentityError(
      `${field} is missing or a placeholder; ${inputName} must be an exact ${length}-character hexadecimal value.`,
    )
  }

  return normalized
}

function canonicalPaperPath(value) {
  const inputName = RELEASE_INPUT_ENVIRONMENT.paperRepositoryPath
  if (typeof value !== 'string' || !value.trim()) {
    throw new ReleaseIdentityError(
      `paper.candidate.repositoryPath is unresolved; inject ${inputName} only after the edition 3.1 paper is committed.`,
    )
  }

  const normalized = value.trim()
  if (
    PLACEHOLDER_PATTERN.test(normalized) ||
    normalized.includes('\\') ||
    posix.isAbsolute(normalized) ||
    posix.normalize(normalized) !== normalized ||
    !normalized.startsWith('docs/') ||
    !normalized.endsWith('.md') ||
    normalized === HISTORICAL_PAPER_PATH
  ) {
    throw new ReleaseIdentityError(
      `paper.candidate.repositoryPath must identify the committed edition 3.1 Markdown paper, not the preserved edition 3.0 path or a placeholder.`,
    )
  }

  return normalized
}

export function validateReleaseIdentityTemplate(value) {
  if (!isDeepStrictEqual(value, releaseIdentityShape())) {
    throw new ReleaseIdentityError(
      'The tracked release-identity template must retain the exact unresolved webchess-release-identity/1 shape.',
    )
  }
  return value
}

export function resolveReleaseIdentity(inputs = {}) {
  const sourceCommit = canonicalHex(
    inputs.sourceCommit,
    40,
    'source.commit',
    RELEASE_INPUT_ENVIRONMENT.sourceCommit,
  )
  const sourceArchiveSha256 = canonicalHex(
    inputs.sourceArchiveSha256,
    64,
    'source.archive.sha256',
    RELEASE_INPUT_ENVIRONMENT.sourceArchiveSha256,
  )
  const paperRepositoryPath = canonicalPaperPath(
    inputs.paperRepositoryPath,
  )
  const paperPdfSha256 = canonicalHex(
    inputs.paperPdfSha256,
    64,
    'paper.candidate.pdf.sha256',
    RELEASE_INPUT_ENVIRONMENT.paperPdfSha256,
  )

  return releaseIdentityShape({
    paperPdfSha256,
    paperRepositoryPath,
    sourceArchiveSha256,
    sourceCommit,
  })
}

export function validateResolvedReleaseIdentity(value) {
  const sourceCommit = canonicalHex(
    value?.source?.commit,
    40,
    'source.commit',
    RELEASE_INPUT_ENVIRONMENT.sourceCommit,
  )
  const sourceArchiveSha256 = canonicalHex(
    value?.source?.archive?.sha256,
    64,
    'source.archive.sha256',
    RELEASE_INPUT_ENVIRONMENT.sourceArchiveSha256,
  )
  const paperRepositoryPath = canonicalPaperPath(
    value?.paper?.candidate?.repositoryPath,
  )
  const paperPdfSha256 = canonicalHex(
    value?.paper?.candidate?.pdf?.sha256,
    64,
    'paper.candidate.pdf.sha256',
    RELEASE_INPUT_ENVIRONMENT.paperPdfSha256,
  )

  if (
    value.source.commit !== sourceCommit ||
    value.source.archive.sha256 !== sourceArchiveSha256 ||
    value.paper.candidate.repositoryPath !== paperRepositoryPath ||
    value.paper.candidate.pdf.sha256 !== paperPdfSha256 ||
    !isDeepStrictEqual(
      value,
      releaseIdentityShape({
        paperPdfSha256,
        paperRepositoryPath,
        sourceArchiveSha256,
        sourceCommit,
      }),
    )
  ) {
    throw new ReleaseIdentityError(
      'Release identity does not match the canonical webchess-release-identity/1 provenance contract.',
    )
  }

  return value
}

async function executeGit(arguments_, cwd) {
  try {
    const { stdout } = await execFileAsync('git', arguments_, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return stdout
  } catch {
    throw new ReleaseIdentityError(
      'Release identity verification could not read the required Git state.',
    )
  }
}

function oneLine(value) {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/u.test(normalized)) {
    throw new ReleaseIdentityError(
      'Release identity verification could not resolve an exact Git HEAD commit.',
    )
  }
  return normalized
}

async function exactCleanHead(git) {
  const status = await git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (status.length !== 0) {
    throw new ReleaseIdentityError(
      'Release identity requires an exact clean HEAD; tracked and untracked changes are forbidden.',
    )
  }

  return oneLine(
    await git(['rev-parse', '--verify', 'HEAD^{commit}']),
  )
}

async function readJson(path, description) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new ReleaseIdentityError(
      `${description} is missing or is not valid JSON.`,
    )
  }
}

function paperVersionPattern(edition) {
  const escapedEdition = edition.replace('.', String.raw`\.`)
  return new RegExp(
    String.raw`\*\*Paper (?:edition|version):\*\*\s*${escapedEdition}\b`,
    'u',
  )
}

async function verifyTrackedPaper({
  edition,
  git,
  path,
  root,
}) {
  let tracked
  try {
    tracked = await git(['ls-files', '-z', '--error-unmatch', '--', path])
  } catch {
    throw new ReleaseIdentityError(
      `The edition ${edition} paper must be committed at its declared repository path.`,
    )
  }
  if (tracked !== `${path}\0`) {
    throw new ReleaseIdentityError(
      `The edition ${edition} paper must resolve to exactly one committed repository file.`,
    )
  }

  const absolutePath = resolve(root, path)
  const repositoryRelativePath = relative(root, absolutePath)
  if (
    !repositoryRelativePath ||
    repositoryRelativePath.startsWith('..') ||
    resolve(root, repositoryRelativePath) !== absolutePath
  ) {
    throw new ReleaseIdentityError(
      `The edition ${edition} paper path escapes the repository.`,
    )
  }

  let paper
  try {
    paper = await readFile(absolutePath, 'utf8')
  } catch {
    throw new ReleaseIdentityError(
      `The edition ${edition} paper is not readable at its declared repository path.`,
    )
  }
  if (!paperVersionPattern(edition).test(paper)) {
    throw new ReleaseIdentityError(
      `The declared edition ${edition} paper does not identify itself as paper version or edition ${edition}.`,
    )
  }
}

async function verifyDeclaredPapers({ git, identity, root }) {
  await verifyTrackedPaper({
    edition: identity.paper.candidate.edition,
    git,
    path: identity.paper.candidate.repositoryPath,
    root,
  })
  await verifyTrackedPaper({
    edition: identity.paper.historical.edition,
    git,
    path: identity.paper.historical.repositoryPath,
    root,
  })
}

async function verifyCandidatePaperPdf({ identity, root }) {
  const pdfPath = resolve(
    root,
    'public',
    `.${identity.paper.candidate.pdf.downloadPath}`,
  )
  let pdf
  try {
    pdf = await readFile(pdfPath)
  } catch {
    throw new ReleaseIdentityError(
      'The exact edition 3.1 PDF must exist at public/downloads/webchess-white-paper.pdf before release identity generation or checking.',
    )
  }
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new ReleaseIdentityError(
      'The declared edition 3.1 paper artifact is not a PDF.',
    )
  }
  const digest = createHash('sha256').update(pdf).digest('hex')
  if (digest !== identity.paper.candidate.pdf.sha256) {
    throw new ReleaseIdentityError(
      'The edition 3.1 PDF bytes do not match paper.candidate.pdf.sha256.',
    )
  }
}

export function releaseInputsFromEnvironment(environment = process.env) {
  return {
    paperPdfSha256:
      environment[RELEASE_INPUT_ENVIRONMENT.paperPdfSha256],
    paperRepositoryPath:
      environment[RELEASE_INPUT_ENVIRONMENT.paperRepositoryPath],
    sourceArchiveSha256:
      environment[RELEASE_INPUT_ENVIRONMENT.sourceArchiveSha256],
    sourceCommit:
      environment[RELEASE_INPUT_ENVIRONMENT.sourceCommit],
  }
}

export async function generateReleaseIdentity({
  git,
  inputs = releaseInputsFromEnvironment(),
  outputPath = RELEASE_IDENTITY_OUTPUT_PATH,
  root = repositoryRoot,
  templatePath,
} = {}) {
  validateReleaseIdentityTemplate(
    await readJson(
      templatePath ?? templatePathForRoot(root),
      'The tracked release-identity template',
    ),
  )
  const identity = resolveReleaseIdentity(inputs)
  validateResolvedReleaseIdentity(identity)

  const runGit = git ?? ((arguments_) => executeGit(arguments_, root))
  const initialHead = await exactCleanHead(runGit)
  if (identity.source.commit !== initialHead) {
    throw new ReleaseIdentityError(
      `${RELEASE_INPUT_ENVIRONMENT.sourceCommit} must exactly equal the clean release HEAD.`,
    )
  }
  await verifyDeclaredPapers({ git: runGit, identity, root })
  await verifyCandidatePaperPdf({ identity, root })

  await mkdir(dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    })

    const finalHead = await exactCleanHead(runGit)
    if (finalHead !== initialHead) {
      throw new ReleaseIdentityError(
        'Release source changed while the release identity was being generated.',
      )
    }
    await rename(temporaryPath, outputPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }

  return identity
}

export async function checkReleaseIdentity({
  git,
  identityPath = RELEASE_IDENTITY_OUTPUT_PATH,
  root = repositoryRoot,
  templatePath,
} = {}) {
  validateReleaseIdentityTemplate(
    await readJson(
      templatePath ?? templatePathForRoot(root),
      'The tracked release-identity template',
    ),
  )
  const identity = validateResolvedReleaseIdentity(
    await readJson(
      identityPath,
      'The generated release identity',
    ),
  )
  const runGit = git ?? ((arguments_) => executeGit(arguments_, root))
  const initialHead = await exactCleanHead(runGit)
  if (identity.source.commit !== initialHead) {
    throw new ReleaseIdentityError(
      'Generated release identity does not describe the exact clean HEAD.',
    )
  }
  await verifyDeclaredPapers({ git: runGit, identity, root })
  await verifyCandidatePaperPdf({ identity, root })
  const finalHead = await exactCleanHead(runGit)
  if (finalHead !== initialHead) {
    throw new ReleaseIdentityError(
      'Release source changed while the release identity was being checked.',
    )
  }
  return identity
}

async function run() {
  const command = process.argv[2]
  try {
    if (command === 'generate') {
      const identity = await generateReleaseIdentity()
      console.log(
        `Generated webchess-release-identity/1 for ${identity.source.commit}.`,
      )
      return
    }
    if (command === 'check') {
      const identity = await checkReleaseIdentity()
      console.log(
        `Verified webchess-release-identity/1 for ${identity.source.commit}.`,
      )
      return
    }
    throw new ReleaseIdentityError(
      'Usage: node scripts/release-identity.mjs <generate|check>',
    )
  } catch (error) {
    console.error(
      error instanceof ReleaseIdentityError
        ? error.message
        : 'Release identity operation failed.',
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await run()
}

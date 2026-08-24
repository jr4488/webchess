import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u

export class ReleaseSourceArchiveError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReleaseSourceArchiveError'
  }
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
    throw new ReleaseSourceArchiveError(
      'The retained source archive could not read the required Git state.',
    )
  }
}

async function executeArchive({
  commit,
  commitTime,
  outputPath,
  prefix,
  root,
}) {
  try {
    await execFileAsync('git', [
      'archive',
      '--format=zip',
      '-0',
      `--mtime=@${commitTime}`,
      `--prefix=${prefix}`,
      `--output=${outputPath}`,
      commit,
    ], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
  } catch {
    throw new ReleaseSourceArchiveError(
      'Git could not create the retained release source archive.',
    )
  }
}

async function exactCleanHead(git) {
  const status = await git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (status.length !== 0) {
    throw new ReleaseSourceArchiveError(
      'The retained source archive requires an exact clean HEAD.',
    )
  }
  const commit = (await git([
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ])).trim().toLowerCase()
  if (!COMMIT_PATTERN.test(commit)) {
    throw new ReleaseSourceArchiveError(
      'The retained source archive requires an exact Git commit.',
    )
  }
  const commitTime = (await git([
    'show',
    '-s',
    '--format=%ct',
    commit,
  ])).trim()
  if (!/^[1-9]\d{8,11}$/u.test(commitTime)) {
    throw new ReleaseSourceArchiveError(
      'The retained source archive requires an exact commit timestamp.',
    )
  }
  return { commit, commitTime }
}

function releasePrefix(packageJson) {
  if (
    packageJson?.name !== 'webchess' ||
    typeof packageJson.version !== 'string' ||
    !/^2\.2\.0-rc\.1$/u.test(packageJson.version)
  ) {
    throw new ReleaseSourceArchiveError(
      'The retained source archive requires the reviewed WebChess 2.2.0-rc.1 package identity.',
    )
  }
  return packageJson.version
}

function assertOutputInsideRoot(root, outputPath) {
  const absoluteRoot = resolve(root)
  const absoluteOutput = resolve(outputPath)
  const pathWithinRoot = relative(absoluteRoot, absoluteOutput)
  if (
    !pathWithinRoot ||
    pathWithinRoot.startsWith('..') ||
    resolve(absoluteRoot, pathWithinRoot) !== absoluteOutput
  ) {
    throw new ReleaseSourceArchiveError(
      'The retained source archive output must remain inside the repository.',
    )
  }
  return absoluteOutput
}

export function validateCanonicalSourceArchive(bytes, { commit, prefix }) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 22 ||
    bytes.readUInt32LE(0) !== 0x04034b50
  ) {
    throw new ReleaseSourceArchiveError(
      'The retained source artifact is not a nonempty ZIP archive.',
    )
  }

  const minimumOffset = Math.max(0, bytes.length - 65_557)
  let endOffset = -1
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset === -1) {
    throw new ReleaseSourceArchiveError(
      'The retained source ZIP has no canonical end record.',
    )
  }
  const entryCount = bytes.readUInt16LE(endOffset + 10)
  const centralOffset = bytes.readUInt32LE(endOffset + 16)
  const commentLength = bytes.readUInt16LE(endOffset + 20)
  if (
    entryCount < 1 ||
    entryCount === 0xffff ||
    endOffset + 22 + commentLength !== bytes.length ||
    bytes.subarray(endOffset + 22).toString('utf8').trim() !== commit
  ) {
    throw new ReleaseSourceArchiveError(
      'The retained source ZIP is not bound to the declared commit.',
    )
  }

  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > endOffset ||
      bytes.readUInt32LE(cursor) !== 0x02014b50
    ) {
      throw new ReleaseSourceArchiveError(
        'The retained source ZIP has an invalid central directory.',
      )
    }
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const fileCommentLength = bytes.readUInt16LE(cursor + 32)
    const nameStart = cursor + 46
    const next = nameStart + nameLength + extraLength + fileCommentLength
    if (next > endOffset) {
      throw new ReleaseSourceArchiveError(
        'The retained source ZIP has an invalid central directory.',
      )
    }
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8')
    const relativeName = name.slice(prefix.length)
    if (
      !name.startsWith(prefix) ||
      name.includes('\\') ||
      relativeName.startsWith('/') ||
      relativeName.split('/').some((part) => part === '..')
    ) {
      throw new ReleaseSourceArchiveError(
        'The retained source ZIP contains a path outside its commit-addressed root.',
      )
    }
    cursor = next
  }
  if (cursor !== endOffset) {
    throw new ReleaseSourceArchiveError(
      'The retained source ZIP central directory has trailing data.',
    )
  }
}

export async function createReleaseSourceArchive({
  archive = executeArchive,
  git,
  outputPath,
  root = repositoryRoot,
} = {}) {
  const runGit = git ?? ((arguments_) => executeGit(arguments_, root))
  const initial = await exactCleanHead(runGit)
  const resolvedOutput = assertOutputInsideRoot(
    root,
    outputPath ?? join(
      root,
      'public',
      'downloads',
      `webchess-source-${initial.commit}.zip`,
    ),
  )
  let packageJson
  try {
    packageJson = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    )
  } catch {
    throw new ReleaseSourceArchiveError(
      'The retained source archive requires a readable package.json.',
    )
  }
  const version = releasePrefix(packageJson)
  const prefix = `webchess-${initial.commit}/`
  await mkdir(dirname(resolvedOutput), { recursive: true })
  const temporaryPath = `${resolvedOutput}.${process.pid}.${randomUUID()}.tmp`

  try {
    await archive({
      commit: initial.commit,
      commitTime: initial.commitTime,
      outputPath: temporaryPath,
      prefix,
      root,
    })
    const bytes = await readFile(temporaryPath)
    validateCanonicalSourceArchive(bytes, {
      commit: initial.commit,
      prefix,
    })
    const final = await exactCleanHead(runGit)
    if (
      final.commit !== initial.commit ||
      final.commitTime !== initial.commitTime
    ) {
      throw new ReleaseSourceArchiveError(
        'Release source changed while the retained archive was created.',
      )
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await rename(temporaryPath, resolvedOutput)
    return {
      byteCount: bytes.length,
      commit: initial.commit,
      commitTime: initial.commitTime,
      outputPath: resolvedOutput,
      prefix,
      sha256,
      version,
    }
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function run() {
  if (process.argv.length !== 2) {
    throw new ReleaseSourceArchiveError(
      'Usage: node scripts/create-release-source-archive.mjs',
    )
  }
  const result = await createReleaseSourceArchive()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error) => {
    process.stderr.write(
      `${error instanceof ReleaseSourceArchiveError ? error.message : 'Retained source archive generation failed.'}\n`,
    )
    process.exitCode = 1
  })
}

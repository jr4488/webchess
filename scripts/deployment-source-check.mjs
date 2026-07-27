import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

export class ReleaseSourceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReleaseSourceError'
  }
}

async function executeGit(arguments_) {
  try {
    const { stdout } = await execFileAsync('git', arguments_, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return stdout
  } catch {
    throw new ReleaseSourceError(
      'Release source verification could not read the required Git state.',
    )
  }
}

function oneLine(value, description) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new ReleaseSourceError(description)
  }
  return trimmed
}

export async function verifyReleaseSource({
  git = executeGit,
} = {}) {
  const status = await git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (status.length !== 0) {
    throw new ReleaseSourceError(
      'Release source is not clean; tracked and untracked changes are forbidden.',
    )
  }

  const branchRef = oneLine(
    await git(['symbolic-ref', '--quiet', 'HEAD']),
    'Release source must be an attached local branch.',
  )
  if (!branchRef.startsWith('refs/heads/')) {
    throw new ReleaseSourceError(
      'Release source must be an attached local branch.',
    )
  }
  const branch = branchRef.slice('refs/heads/'.length)

  const commit = oneLine(
    await git(['rev-parse', '--verify', 'HEAD^{commit}']),
    'Release source HEAD is not a valid commit.',
  ).toLowerCase()
  if (!COMMIT_PATTERN.test(commit)) {
    throw new ReleaseSourceError(
      'Release source HEAD is not a valid commit.',
    )
  }

  const upstream = await git([
    'for-each-ref',
    '--format=%(upstream:remotename)%00%(upstream:remoteref)',
    branchRef,
  ])
  const [remoteName, remoteRef, ...unexpected] = upstream
    .replace(/\r?\n$/, '')
    .split('\0')
  if (
    unexpected.length > 0 ||
    !remoteName ||
    !remoteRef?.startsWith('refs/heads/')
  ) {
    throw new ReleaseSourceError(
      'Release branch must have a configured remote branch.',
    )
  }

  const remoteState = await git([
    'ls-remote',
    '--exit-code',
    '--heads',
    remoteName,
    remoteRef,
  ])
  const remoteLines = remoteState.trim().split(/\r?\n/)
  if (remoteLines.length !== 1) {
    throw new ReleaseSourceError(
      'The configured remote branch could not be verified.',
    )
  }
  const [remoteCommit, advertisedRef, ...extraFields] =
    remoteLines[0].split(/\s+/)
  if (
    extraFields.length > 0 ||
    advertisedRef !== remoteRef ||
    !COMMIT_PATTERN.test(remoteCommit?.toLowerCase() ?? '')
  ) {
    throw new ReleaseSourceError(
      'The configured remote branch could not be verified.',
    )
  }
  if (remoteCommit.toLowerCase() !== commit) {
    throw new ReleaseSourceError(
      'Release source HEAD does not match the live remote branch commit.',
    )
  }

  const finalCommit = oneLine(
    await git(['rev-parse', '--verify', 'HEAD^{commit}']),
    'Release source changed during verification.',
  ).toLowerCase()
  const finalStatus = await git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (finalCommit !== commit || finalStatus.length !== 0) {
    throw new ReleaseSourceError(
      'Release source changed during verification.',
    )
  }

  return { branch, commit }
}

async function run() {
  try {
    const result = await verifyReleaseSource()
    console.log(
      `Release source verified: ${result.branch} at ${result.commit}.`,
    )
  } catch (error) {
    console.error(
      error instanceof ReleaseSourceError
        ? error.message
        : 'Release source verification failed.',
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

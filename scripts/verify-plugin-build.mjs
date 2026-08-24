import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const PLUGIN_DIST_PATH = 'openclaw-plugin/dist'

export class PluginBuildVerificationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PluginBuildVerificationError'
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function collectFiles(root, relativePath = '', files = []) {
  const absolutePath = path.join(root, relativePath)
  const metadata = await lstat(absolutePath)
  if (metadata.isSymbolicLink()) {
    throw new PluginBuildVerificationError(
      `OpenClaw plugin build contains a symbolic link: ${relativePath || '.'}`,
    )
  }
  if (metadata.isDirectory()) {
    const children = (await readdir(absolutePath)).sort()
    for (const child of children) {
      await collectFiles(
        root,
        relativePath ? path.posix.join(relativePath, child) : child,
        files,
      )
    }
    return files
  }
  if (!metadata.isFile()) {
    throw new PluginBuildVerificationError(
      `OpenClaw plugin build contains an unsupported file: ${relativePath}`,
    )
  }
  const bytes = await readFile(absolutePath)
  files.push({
    path: relativePath,
    bytes: bytes.byteLength,
    executable: (metadata.mode & 0o111) !== 0,
    sha256: sha256(bytes),
  })
  return files
}

function comparePaths(expected, actual, label) {
  const expectedPaths = expected.map((file) => file.path).sort()
  const actualPaths = actual.map((file) => file.path).sort()
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    const missing = expectedPaths.filter((file) => !actualPaths.includes(file))
    const unexpected = actualPaths.filter((file) => !expectedPaths.includes(file))
    throw new PluginBuildVerificationError(
      `${label} file set does not match. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`,
    )
  }
}

function expectedGeneratedFiles(sourceFiles) {
  return sourceFiles.flatMap((file) => {
    if (file.path.endsWith('.d.ts') || file.path.endsWith('.test.ts')) {
      return []
    }
    if (!file.path.endsWith('.ts')) {
      throw new PluginBuildVerificationError(
        `OpenClaw plugin source contains an unsupported file: ${file.path}.`,
      )
    }
    return [{ path: `${file.path.slice(0, -3)}.js` }]
  })
}

export function comparePluginBuildInventories(generated, distributed) {
  comparePaths(generated, distributed, 'OpenClaw plugin source/dist')
  const distributedByPath = new Map(
    distributed.map((file) => [file.path, file]),
  )
  for (const generatedFile of generated) {
    const distributedFile = distributedByPath.get(generatedFile.path)
    if (
      generatedFile.bytes !== distributedFile.bytes ||
      generatedFile.executable !== distributedFile.executable ||
      generatedFile.sha256 !== distributedFile.sha256
    ) {
      throw new PluginBuildVerificationError(
        `OpenClaw plugin dist is stale for ${generatedFile.path}.`,
      )
    }
  }
}

async function validateDeclaredEntrypoints(root, sourceFiles, distributed) {
  let packageJson
  try {
    packageJson = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    )
  } catch {
    throw new PluginBuildVerificationError(
      'OpenClaw plugin build requires a readable package.json.',
    )
  }
  const sourceEntrypoints = packageJson.openclaw?.extensions
  const runtimeEntrypoints = packageJson.openclaw?.runtimeExtensions
  if (
    JSON.stringify(sourceEntrypoints) !==
      JSON.stringify(['./openclaw-plugin/src/index.ts']) ||
    JSON.stringify(runtimeEntrypoints) !==
      JSON.stringify(['./openclaw-plugin/dist/index.js'])
  ) {
    throw new PluginBuildVerificationError(
      'OpenClaw plugin entrypoints do not match the canonical source/runtime contract.',
    )
  }
  if (
    !sourceFiles.some((file) => file.path === 'index.ts') ||
    !distributed.some((file) => file.path === 'index.js')
  ) {
    throw new PluginBuildVerificationError(
      'OpenClaw plugin entrypoint source or runtime output is missing.',
    )
  }
}

async function compilePlugin({ outputRoot, root }) {
  const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    await execFileAsync(process.execPath, [
      compiler,
      '--project',
      path.join(root, 'openclaw-plugin', 'tsconfig.json'),
      '--outDir',
      outputRoot,
      '--pretty',
      'false',
    ], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout).trim()
      : ''
    throw new PluginBuildVerificationError(
      `OpenClaw plugin source did not compile cleanly.${detail ? ` ${detail}` : ''}`,
    )
  }
}

async function gitOutput(arguments_, root) {
  try {
    const { stdout } = await execFileAsync('git', arguments_, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } catch {
    throw new PluginBuildVerificationError(
      'OpenClaw plugin build verification could not read Git state.',
    )
  }
}

function nullSeparated(value) {
  return value.split('\0').filter(Boolean)
}

export async function verifyPluginBuild({
  compile = compilePlugin,
  git,
  root = projectRoot,
} = {}) {
  const runGit = git ?? ((arguments_) => gitOutput(arguments_, root))
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'webchess-plugin-build-'),
  )
  try {
    await compile({ outputRoot: temporaryRoot, root })
    const sourceFiles = await collectFiles(
      path.join(root, 'openclaw-plugin', 'src'),
    )
    const generated = await collectFiles(temporaryRoot)
    const distributed = await collectFiles(path.join(root, PLUGIN_DIST_PATH))
    await validateDeclaredEntrypoints(root, sourceFiles, distributed)
    comparePaths(
      expectedGeneratedFiles(sourceFiles),
      generated,
      'OpenClaw plugin production source/generated output',
    )
    comparePluginBuildInventories(generated, distributed)

    const trackedPrefix = `${PLUGIN_DIST_PATH}/`
    const tracked = nullSeparated(await runGit([
      'ls-files',
      '-z',
      '--',
      PLUGIN_DIST_PATH,
    ])).map((filename) => {
      if (!filename.startsWith(trackedPrefix)) {
        throw new PluginBuildVerificationError(
          'Git returned a plugin output outside the reviewed dist directory.',
        )
      }
      return {
        path: filename.slice(trackedPrefix.length),
      }
    })
    comparePaths(distributed, tracked, 'Tracked OpenClaw plugin dist')

    const status = await runGit([
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      PLUGIN_DIST_PATH,
    ])
    if (status.length !== 0) {
      throw new PluginBuildVerificationError(
        'OpenClaw plugin dist has tracked or untracked changes after generation.',
      )
    }

    return {
      format: 'webchess-plugin-build-verification/1',
      fileCount: distributed.length,
      sha256: sha256(JSON.stringify(distributed)),
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true })
  }
}

async function main() {
  if (process.argv.length !== 2) {
    throw new PluginBuildVerificationError(
      'Usage: node scripts/verify-plugin-build.mjs',
    )
  }
  process.stdout.write(
    `${JSON.stringify(await verifyPluginBuild(), null, 2)}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}

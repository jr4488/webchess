import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  readdir,
  readFile,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServer } from 'vite'

import { runtimePayloadIdentity } from './runtime-payload-identity.mjs'

const MAX_CASE_BYTES = 100_000_000
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

function usage() {
  throw new Error(
    'Usage: npm run case:verify -- /absolute/or/relative/webchess-case.json',
  )
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function migrationChecksum(sql) {
  return sha256(`${sql.replace(/\r\n?/gu, '\n').trim()}\n`)
}

async function localMigrations() {
  const directory = path.join(projectRoot, 'db', 'migrations')
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
  return Object.fromEntries(await Promise.all(names.map(async (name) => {
    const id = name.slice(0, -4)
    return [id, migrationChecksum(await readFile(path.join(directory, name), 'utf8'))]
  })))
}

function localSource() {
  try {
    const commit = execFileSync(
      'git',
      ['rev-parse', '--verify', 'HEAD'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim().toLowerCase()
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
      return { commit: null, clean: null }
    }
    const status = execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    return { commit, clean: status.length === 0 }
  } catch {
    return { commit: null, clean: null }
  }
}

async function main() {
  const argument = process.argv[2]
  if (!argument || process.argv.length !== 3) usage()
  const casePath = path.resolve(process.cwd(), argument)
  const metadata = await stat(casePath)
  if (!metadata.isFile()) throw new Error('The case path must identify one file.')
  if (metadata.size < 2 || metadata.size > MAX_CASE_BYTES) {
    throw new Error(`The case file must be between 2 and ${MAX_CASE_BYTES} bytes.`)
  }

  const source = await readFile(casePath, 'utf8')
  let bundle
  try {
    bundle = JSON.parse(source)
  } catch {
    throw new Error('The case file is not valid JSON.')
  }

  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  )
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  })
  try {
    const sourceCheckout = localSource()
    const runtimePayload = await runtimePayloadIdentity(projectRoot)
    const module = await vite.ssrLoadModule('/src/server/case-bundle.ts')
    const result = module.verifyCaseBundle(bundle, {
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      sourceCommit: sourceCheckout.commit,
      sourceTreeClean: sourceCheckout.clean,
      runtimeArtifactSha256: runtimePayload.sha256,
      migrations: await localMigrations(),
    })
    process.stdout.write(`${JSON.stringify({
      file: casePath,
      format: bundle?.format ?? null,
      profile: bundle?.profile ?? null,
      ...result,
    }, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
  } finally {
    await vite.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

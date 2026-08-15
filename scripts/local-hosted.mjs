import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client as PostgresClient } from 'pg'

export const LOCAL_APP_ENV_FILE = '.env.development.local'
export const LOCAL_COMPOSE_ENV_FILE = 'local/.env'
export const LOCAL_COMPOSE_FILE = 'local/compose.yaml'
export const LOCAL_HOSTNAME = '127.0.0.1'
export const LOCAL_PORT = 3005
export const LOCAL_POSTGRES_CONTAINER = 'webchess-local-postgres'
export const LOCAL_POSTGRES_DATABASE = 'webchess'
export const LOCAL_POSTGRES_IMAGE =
  'postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193'
export const LOCAL_POSTGRES_OWNER_LABEL =
  'com.anansiportia.webchess.local-postgres'
export const LOCAL_POSTGRES_OWNER_LABEL_VALUE = 'managed-v1'
export const LOCAL_POSTGRES_VOLUME_BINDING_LABEL =
  'com.anansiportia.webchess.local-postgres-volume-binding'
export const LOCAL_POSTGRES_VOLUME_OWNER_LABEL =
  'com.anansiportia.webchess.local-postgres-volume'
export const LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE = 'managed-v1'
export const LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE = 'explicitly-adopted-v1'
export const LOCAL_POSTGRES_PORT = 55433
export const LOCAL_POSTGRES_READY_TIMEOUT_MS = 60_000
export const LOCAL_APP_READY_TIMEOUT_MS = 120_000
export const LOCAL_BROWSER_OPEN_TIMEOUT_MS = 15_000
export const LOCAL_POSTGRES_USER = 'webchess'
export const LOCAL_POSTGRES_VOLUME = 'webchess_local_pgdata'
export const LOCAL_SITE_ORIGIN = `http://localhost:${LOCAL_PORT}`
export const LOCAL_HOSTED_AUTH_FLAG = 'WEBCHESS_LOCAL_HOSTED_AUTH'
export const LOCAL_SESSION_SECRET_NAME = 'WEBCHESS_LOCAL_SESSION_SECRET'
export const LOCAL_ENV_LOCK_DIRECTORY = 'local/.webchess-setup.lock'

const PRESERVED_APP_KEYS = new Set([
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'OPENAI_API_KEY',
  'WEBCHESS_DELETION_HMAC_SECRET',
  'WEBCHESS_HMAC_SECRET',
  LOCAL_SESSION_SECRET_NAME,
])

const MINIMUM_SECRET_BYTES = 32
const DOCKER_CAPTURE_TIMEOUT_MS = 15_000
const DOCKER_MUTATION_TIMEOUT_MS = 300_000
const PINNED_POSTGRES_ENVIRONMENT = Object.freeze({
  DOCKER_PG_LLVM_DEPS: 'llvm21-dev \t\tclang21',
  GOSU_VERSION: '1.19',
  LANG: 'en_US.utf8',
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  PGDATA: '/var/lib/postgresql/data',
  PG_MAJOR: '17',
  PG_SHA256: '078a03516dcdbdb705fecaf415ea3d13a956c589e46f09fed68a06fb00598c90',
  PG_VERSION: '17.10',
})

export const LOCAL_HOSTED_QUOTAS = Object.freeze({
  WEBCHESS_DAILY_GAME_LIMIT: '1000',
  WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT: '10000',
  WEBCHESS_DAILY_MODEL_REQUEST_LIMIT: '10000',
  WEBCHESS_HOURLY_ACCOUNT_EXPORT_LIMIT: '20',
  WEBCHESS_HOURLY_GAME_MOVE_LIMIT: '6000',
  WEBCHESS_HOURLY_GAME_START_LIMIT: '1000',
  WEBCHESS_HOURLY_IP_ACCOUNT_EXPORT_LIMIT: '40',
  WEBCHESS_HOURLY_IP_GAME_MOVE_LIMIT: '12000',
  WEBCHESS_HOURLY_IP_GAME_START_LIMIT: '1000',
  WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT: '1000',
  WEBCHESS_HOURLY_IP_WILBUR_ACTION_LIMIT: '2400',
  WEBCHESS_HOURLY_IP_WILBUR_OBSERVATION_LIMIT: '1200',
  WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT: '1000',
  WEBCHESS_HOURLY_WILBUR_ACTION_LIMIT: '1200',
  WEBCHESS_HOURLY_WILBUR_OBSERVATION_LIMIT: '600',
  WEBCHESS_WILBUR_STORAGE_ROW_LIMIT: '500',
  WEBCHESS_WILBUR_STORAGE_TEXT_BYTES_LIMIT: '250000',
})

const nonBlank = (value) =>
  typeof value === 'string' && value.trim().length > 0

export function isLoopbackHostname(value) {
  const hostname = String(value).toLowerCase().replace(/^\[|\]$/gu, '')
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

export function parseLoopbackPostgresUrl(
  value,
  variableName = 'DATABASE_URL',
) {
  if (!nonBlank(value) || value !== value.trim()) {
    throw new Error(
      `${variableName} must be a PostgreSQL URL on a loopback host.`,
    )
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${variableName} is not a valid URL.`)
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !isLoopbackHostname(parsed.hostname)
  ) {
    throw new Error(
      `${variableName} must use PostgreSQL on a loopback host.`,
    )
  }

  return parsed
}

export function postgresUrl({
  user,
  password,
  host = LOCAL_HOSTNAME,
  port = LOCAL_POSTGRES_PORT,
  database = LOCAL_POSTGRES_DATABASE,
}) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

export function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex')
}

export function generatePostgresPassword() {
  return randomBytes(24).toString('base64url')
}

export function parseDotEnv(text) {
  const values = {}
  if (!nonBlank(text)) {
    return values
  }

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      continue
    }
    const key = trimmed.slice(0, separator)
    let value = trimmed.slice(separator + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

export function serializeDotEnv(values, header) {
  const lines = header ? [header, ''] : []
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`)
  }
  return `${lines.join('\n')}\n`
}

export function mergeLocalAppEnv(existing, generated) {
  const next = {}
  for (const key of PRESERVED_APP_KEYS) {
    if (nonBlank(existing[key])) {
      next[key] = existing[key]
    }
  }
  for (const [key, value] of Object.entries(generated)) {
    if (PRESERVED_APP_KEYS.has(key) && nonBlank(existing[key])) {
      continue
    }
    next[key] = value
  }
  return next
}

export function combinedEnvironment(...sources) {
  const combined = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (nonBlank(value)) {
        combined[key] = value
      }
    }
  }
  return combined
}

export function missingLocalHostedSecrets(environment) {
  const required = [
    'OPENAI_API_KEY',
    'WEBCHESS_HMAC_SECRET',
    'WEBCHESS_DELETION_HMAC_SECRET',
    LOCAL_SESSION_SECRET_NAME,
    'DATABASE_URL',
  ]
  return required.filter((name) => !nonBlank(environment[name]))
}

export function resolveLocalAuthMode(environment) {
  const publishableKey = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const secretKey = environment.CLERK_SECRET_KEY
  const hasPublishableKey = nonBlank(publishableKey)
  const hasSecretKey = nonBlank(secretKey)

  if (hasPublishableKey !== hasSecretKey) {
    throw new Error(
      'Local Clerk mode requires both NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY. Remove both to use the signed loopback session.',
    )
  }
  if (!hasPublishableKey) {
    return 'local-session'
  }
  if (
    !publishableKey.startsWith('pk_test_') ||
    !secretKey.startsWith('sk_test_')
  ) {
    throw new Error(
      'Local Clerk mode accepts only matching development pk_test_ and sk_test_ credentials.',
    )
  }
  return 'clerk'
}

function assertSecretStrength(environment, name) {
  const value = environment[name]
  if (!nonBlank(value) || Buffer.byteLength(value, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error(`${name} must contain at least ${MINIMUM_SECRET_BYTES} bytes.`)
  }
}

export function validateLocalHostedSecrets(environment) {
  const names = [
    'WEBCHESS_HMAC_SECRET',
    'WEBCHESS_DELETION_HMAC_SECRET',
    LOCAL_SESSION_SECRET_NAME,
  ]
  for (const name of names) {
    assertSecretStrength(environment, name)
  }
  const distinctSecrets = new Set(names.map((name) => environment[name]))
  if (distinctSecrets.size !== names.length) {
    throw new Error(
      'WEBCHESS_HMAC_SECRET, WEBCHESS_DELETION_HMAC_SECRET, and WEBCHESS_LOCAL_SESSION_SECRET must be distinct secrets.',
    )
  }
}

export function buildLocalAppEnv({
  postgresPassword,
  hmacSecret,
  deletionHmacSecret,
  localSessionSecret,
  existing = {},
}) {
  return mergeLocalAppEnv(existing, {
    DATABASE_URL: postgresUrl({
      user: LOCAL_POSTGRES_USER,
      password: postgresPassword,
    }),
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/play',
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/play',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
    NEXT_PUBLIC_SITE_URL: LOCAL_SITE_ORIGIN,
    WEBCHESS_DELETION_HMAC_SECRET: deletionHmacSecret,
    WEBCHESS_HMAC_SECRET: hmacSecret,
    [LOCAL_SESSION_SECRET_NAME]: localSessionSecret,
    WEBCHESS_OPENCLAW_ENABLED: '',
    WEBCHESS_SOFTWARE_VERSION: '2.2.0-local',
    ...LOCAL_HOSTED_QUOTAS,
  })
}

export function buildChildEnvironment(environment) {
  const child = { ...environment }
  for (const name of [
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_TARGET_ENV',
    'VERCEL_URL',
    'WEBCHESS_OPENCLAW_DATABASE_URL',
    'WEBCHESS_OPENCLAW_ENABLED',
    'WEBCHESS_E2E_AUTH',
    'WEBCHESS_E2E_USER_ID',
    LOCAL_HOSTED_AUTH_FLAG,
  ]) {
    delete child[name]
  }
  child.NEXT_TELEMETRY_DISABLED = '1'
  child[LOCAL_HOSTED_AUTH_FLAG] = 'true'
  child.WEBCHESS_OPENCLAW_ENABLED = 'false'
  return child
}

export function validateLocalPort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('Local WebChess --port must be an integer from 1024 through 65535.')
  }
  return port
}

export function localDevArgs(port = LOCAL_PORT) {
  validateLocalPort(port)
  return [
    'run',
    'dev',
    '--',
    '--hostname',
    LOCAL_HOSTNAME,
    '--port',
    String(port),
  ]
}

export function localPostgresRunArgs({
  volumeBinding = LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
} = {}) {
  if (![
    LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE,
    LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
  ].includes(volumeBinding)) {
    throw new Error('The local PostgreSQL volume binding is invalid.')
  }
  return [
    'run',
    '-d',
    '--name',
    LOCAL_POSTGRES_CONTAINER,
    '--restart',
    'unless-stopped',
    '-e',
    `POSTGRES_DB=${LOCAL_POSTGRES_DATABASE}`,
    '-e',
    `POSTGRES_USER=${LOCAL_POSTGRES_USER}`,
    '-e',
    'POSTGRES_PASSWORD',
    '-p',
    `${LOCAL_HOSTNAME}:${LOCAL_POSTGRES_PORT}:5432`,
    '-v',
    `${LOCAL_POSTGRES_VOLUME}:/var/lib/postgresql/data`,
    '--health-cmd',
    'pg_isready --username=webchess --dbname=webchess',
    '--health-interval',
    '5s',
    '--health-timeout',
    '5s',
    '--health-retries',
    '12',
    '--label',
    `${LOCAL_POSTGRES_OWNER_LABEL}=${LOCAL_POSTGRES_OWNER_LABEL_VALUE}`,
    '--label',
    `${LOCAL_POSTGRES_VOLUME_BINDING_LABEL}=${volumeBinding}`,
    LOCAL_POSTGRES_IMAGE,
  ]
}

export function openLocalBrowser(
  url,
  {
    spawnImpl = spawn,
    timeoutMs = LOCAL_BROWSER_OPEN_TIMEOUT_MS,
  } = {},
) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd.exe'
      : 'xdg-open'
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url]
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      detached: false,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill?.('SIGKILL')
      } catch {
        // The timeout remains the public failure even if the helper exited
        // between the deadline and the kill attempt.
      }
      reject(new Error(
        `${command} did not finish opening the browser within ${timeoutMs}ms.`,
      ))
    }, timeoutMs)
    timer.unref?.()
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish(resolve)
        return
      }
      finish(reject, new Error(
        signal
          ? `${command} exited with ${signal} before opening the browser.`
          : `${command} exited with code ${code ?? 'unknown'} before opening the browser.`,
      ))
    })
  })
}

async function readDotEnvFile(filePath) {
  try {
    return parseDotEnv(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function writeFileAtomically(
  filePath,
  contents,
  {
    makeDirectory = mkdir,
    openFile = open,
    removeFile = rm,
    renameFile = rename,
  } = {},
) {
  await makeDirectory(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(12).toString('hex')}`
  let handle
  try {
    handle = await openFile(temporaryPath, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameFile(temporaryPath, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await handle?.close().catch(() => {})
    await removeFile(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function writeDotEnvFile(
  filePath,
  values,
  header,
  dependencies,
) {
  await writeFileAtomically(
    filePath,
    serializeDotEnv(values, header),
    dependencies,
  )
}

async function readFileSnapshot(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function restoreFileSnapshot(filePath, snapshot) {
  if (snapshot === null) {
    await rm(filePath, { force: true })
    return
  }
  await writeFileAtomically(filePath, snapshot)
}

async function acquireLocalEnvLock(root, {
  makeDirectory = mkdir,
  removeDirectory = rm,
} = {}) {
  const lockPath = path.join(root, LOCAL_ENV_LOCK_DIRECTORY)
  await makeDirectory(path.dirname(lockPath), { recursive: true })
  try {
    await makeDirectory(lockPath, { mode: 0o700 })
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(
        `Another local WebChess setup owns ${LOCAL_ENV_LOCK_DIRECTORY}. No configuration was changed. If no setup is running, inspect and remove that stale lock manually.`,
        { cause: error },
      )
    }
    throw error
  }

  let released = false
  return async () => {
    if (released) return
    released = true
    await removeDirectory(lockPath, { recursive: true })
  }
}

export async function ensureLocalEnvFiles({
  root,
  generatePassword = generatePostgresPassword,
  generateHmac = generateSecret,
  readEnv = readDotEnvFile,
  writeEnv = writeDotEnvFile,
} = {}) {
  if (!nonBlank(root)) {
    throw new Error('A repository root is required for local WebChess setup.')
  }
  const releaseLock = await acquireLocalEnvLock(root)
  let releaseLockOnExit = true
  let snapshots
  let writesStarted = false
  try {
    const composeEnvPath = path.join(root, LOCAL_COMPOSE_ENV_FILE)
    const appEnvPath = path.join(root, LOCAL_APP_ENV_FILE)
    snapshots = {
      app: await readFileSnapshot(appEnvPath),
      compose: await readFileSnapshot(composeEnvPath),
    }
    const rootEnv = await readEnv(path.join(root, '.env'))
    const existingDotLocal = await readEnv(path.join(root, '.env.local'))
    const existingCompose = await readEnv(composeEnvPath)
    const existingApp = await readEnv(appEnvPath)

    const postgresPassword = nonBlank(existingCompose.WEBCHESS_LOCAL_POSTGRES_PASSWORD)
      ? existingCompose.WEBCHESS_LOCAL_POSTGRES_PASSWORD.trim()
      : generatePassword()

    const hmacSecret = nonBlank(existingApp.WEBCHESS_HMAC_SECRET)
      ? existingApp.WEBCHESS_HMAC_SECRET
      : generateHmac()
    const deletionHmacSecret = nonBlank(existingApp.WEBCHESS_DELETION_HMAC_SECRET)
      ? existingApp.WEBCHESS_DELETION_HMAC_SECRET
      : generateHmac()
    const localSessionSecret = nonBlank(existingApp[LOCAL_SESSION_SECRET_NAME])
      ? existingApp[LOCAL_SESSION_SECRET_NAME]
      : generateHmac()

    validateLocalHostedSecrets({
      WEBCHESS_DELETION_HMAC_SECRET: deletionHmacSecret,
      WEBCHESS_HMAC_SECRET: hmacSecret,
      [LOCAL_SESSION_SECRET_NAME]: localSessionSecret,
    })

    const composeEnv = {
      WEBCHESS_LOCAL_POSTGRES_PASSWORD: postgresPassword,
    }
    const appEnv = buildLocalAppEnv({
      deletionHmacSecret,
      existing: existingApp,
      hmacSecret,
      localSessionSecret,
      postgresPassword,
    })

    writesStarted = true
    await writeEnv(
      composeEnvPath,
      composeEnv,
      '# Generated by npm run local:setup. Do not commit this file.',
    )
    await writeEnv(
      appEnvPath,
      appEnv,
      '# Generated by npm run local:setup. Intentional secrets are preserved; unrelated settings are removed.',
    )

    return {
      appEnv,
      appEnvPath,
      composeEnv,
      composeEnvPath,
      postgresPassword,
      rootEnv: combinedEnvironment(rootEnv, existingDotLocal),
    }
  } catch (error) {
    if (writesStarted && snapshots) {
      try {
        await restoreFileSnapshot(
          path.join(root, LOCAL_COMPOSE_ENV_FILE),
          snapshots.compose,
        )
        await restoreFileSnapshot(
          path.join(root, LOCAL_APP_ENV_FILE),
          snapshots.app,
        )
      } catch (rollbackError) {
        releaseLockOnExit = false
        throw new Error(
          `Local WebChess configuration could not be rolled back safely. ${LOCAL_ENV_LOCK_DIRECTORY} was preserved; inspect the two generated env files before removing it.`,
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    if (releaseLockOnExit) await releaseLock()
  }
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      spawnImpl = spawn,
      timeoutMs = DOCKER_MUTATION_TIMEOUT_MS,
      ...spawnOptions
    } = options
    const child = spawnImpl(command, args, {
      stdio: 'inherit',
      ...spawnOptions,
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill?.('SIGKILL')
      reject(new Error(`${command} did not finish within ${timeoutMs}ms.`))
    }, timeoutMs)
    timer.unref?.()
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish(resolve)
        return
      }
      finish(reject, new Error(
        signal
          ? `${command} exited with ${signal}`
          : `${command} exited with code ${code ?? 'unknown'}`,
      ))
    })
  })
}

export function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      spawnImpl = spawn,
      timeoutMs = DOCKER_CAPTURE_TIMEOUT_MS,
      ...spawnOptions
    } = options
    const child = spawnImpl(command, args, {
      ...spawnOptions,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill?.('SIGKILL')
      reject(new Error(`${command} did not finish within ${timeoutMs}ms.`))
    }, timeoutMs)
    timer.unref?.()
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    child.once('error', (error) => finish(reject, error))
    child.once('exit', (code) => {
      finish(resolve, {
        code: code ?? 1,
        stderr,
        stdout,
      })
    })
  })
}

function postgresInspectArgs(container = LOCAL_POSTGRES_CONTAINER) {
  return [
    'inspect',
    '-f',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
    container,
  ]
}

function existingPostgresInspectArgs() {
  return ['inspect', LOCAL_POSTGRES_CONTAINER]
}

function localPostgresVolumeInspectArgs() {
  return ['volume', 'inspect', LOCAL_POSTGRES_VOLUME]
}

function isMissingContainerResult(result) {
  return /No such (?:container|object)/iu.test(
    `${result.stdout}\n${result.stderr}`,
  )
}

function isMissingVolumeResult(result) {
  return /No such volume/iu.test(`${result.stdout}\n${result.stderr}`)
}

export function assertLocalPostgresVolumeConfiguration(
  inspectionText,
  { allowUnlabeled = false } = {},
) {
  let inspected
  try {
    const payload = JSON.parse(inspectionText)
    inspected = Array.isArray(payload) ? payload[0] : null
  } catch {
    inspected = null
  }
  const labels = inspected?.Labels
  const owner = labels?.[LOCAL_POSTGRES_VOLUME_OWNER_LABEL]
  const hasNoLabels =
    labels === null ||
    labels === undefined ||
    (
      typeof labels === 'object' &&
      !Array.isArray(labels) &&
      Object.keys(labels).length === 0
    )
  const options = inspected?.Options
  const exactOptions =
    options === null ||
    (typeof options === 'object' &&
      !Array.isArray(options) && Object.keys(options).length === 0)
  const managed = owner === LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE
  const explicitlyAdopted = hasNoLabels && allowUnlabeled

  if (
    !inspected ||
    inspected.Name !== LOCAL_POSTGRES_VOLUME ||
    inspected.Driver !== 'local' ||
    inspected.Scope !== 'local' ||
    !nonBlank(inspected.Mountpoint) ||
    !exactOptions ||
    (!managed && !explicitlyAdopted)
  ) {
    throw new Error(
      `The existing ${LOCAL_POSTGRES_VOLUME} volume is not an owned, default local WebChess volume. It was not mounted or changed. Preserve and inspect any data before resolving the name collision.`,
    )
  }
  return {
    mountpoint: inspected.Mountpoint,
    volumeBinding: managed
      ? LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE
      : LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE,
  }
}

export async function ensureLocalPostgresVolume({
  adoptUnlabeled = false,
  capture = runCapture,
  createIfMissing = true,
  run = runCommand,
} = {}) {
  let inspect = await capture('docker', localPostgresVolumeInspectArgs())
  if (inspect.code !== 0 && isMissingVolumeResult(inspect)) {
    if (!createIfMissing) {
      throw new Error(
        `The ${LOCAL_POSTGRES_VOLUME} volume attached to the owned local WebChess container is missing. Nothing was changed.`,
      )
    }
    await run('docker', [
      'volume',
      'create',
      '--label',
      `${LOCAL_POSTGRES_VOLUME_OWNER_LABEL}=${LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE}`,
      LOCAL_POSTGRES_VOLUME,
    ])
    inspect = await capture('docker', localPostgresVolumeInspectArgs())
  }
  if (inspect.code !== 0) {
    throw new Error(
      inspect.stderr.trim() ||
      `Could not inspect ${LOCAL_POSTGRES_VOLUME} safely.`,
    )
  }
  return assertLocalPostgresVolumeConfiguration(inspect.stdout, {
    allowUnlabeled: adoptUnlabeled,
  })
}

export function assertExistingLocalPostgresConfiguration(
  inspectionText,
  password,
  { requireOwnership = true } = {},
) {
  let inspected
  try {
    const payload = JSON.parse(inspectionText)
    inspected = Array.isArray(payload) ? payload[0] : null
  } catch {
    inspected = null
  }

  const hostConfig = inspected?.HostConfig
  const config = inspected?.Config
  const portBindingEntries = Object.entries(hostConfig?.PortBindings ?? {})
  const portBindings = hostConfig?.PortBindings?.['5432/tcp']
  const exactPortBinding =
    portBindingEntries.length === 1 &&
    Array.isArray(portBindings) &&
    portBindings.length === 1 &&
    portBindings[0]?.HostIp === LOCAL_HOSTNAME &&
    portBindings[0]?.HostPort === String(LOCAL_POSTGRES_PORT)
  const mounts = inspected?.Mounts
  const exactVolume =
    Array.isArray(mounts) &&
    mounts.length === 1 &&
    mounts[0]?.Type === 'volume' &&
    mounts[0]?.Name === LOCAL_POSTGRES_VOLUME &&
    mounts[0]?.Destination === '/var/lib/postgresql/data' &&
    mounts[0]?.RW !== false
  const environmentEntries = Array.isArray(config?.Env) ? config.Env : []
  const parsedEnvironment = new Map()
  let validEnvironmentEntries = true
  for (const entry of environmentEntries) {
    if (typeof entry !== 'string') {
      validEnvironmentEntries = false
      continue
    }
    const separator = entry.indexOf('=')
    if (separator <= 0) {
      validEnvironmentEntries = false
      continue
    }
    const name = entry.slice(0, separator)
    if (parsedEnvironment.has(name)) {
      validEnvironmentEntries = false
    }
    parsedEnvironment.set(name, entry.slice(separator + 1))
  }
  const expectedPassword = nonBlank(password)
    ? password
    : null
  const expectedEnvironmentNames = new Set([
    ...Object.keys(PINNED_POSTGRES_ENVIRONMENT),
    'POSTGRES_DB',
    'POSTGRES_PASSWORD',
    'POSTGRES_USER',
  ])
  const exactEnvironment =
    validEnvironmentEntries &&
    parsedEnvironment.size === expectedEnvironmentNames.size &&
    [...parsedEnvironment.keys()].every((name) => (
      expectedEnvironmentNames.has(name)
    )) &&
    Object.entries(PINNED_POSTGRES_ENVIRONMENT).every(([name, value]) => (
      parsedEnvironment.get(name) === value
    )) &&
    parsedEnvironment.get('POSTGRES_DB') === LOCAL_POSTGRES_DATABASE &&
    parsedEnvironment.get('POSTGRES_USER') === LOCAL_POSTGRES_USER &&
    nonBlank(parsedEnvironment.get('POSTGRES_PASSWORD')) &&
    (expectedPassword === null ||
      parsedEnvironment.get('POSTGRES_PASSWORD') === expectedPassword)
  const healthcheck = config?.Healthcheck
  const exactHealthcheck =
    JSON.stringify(healthcheck?.Test) === JSON.stringify([
      'CMD-SHELL',
      'pg_isready --username=webchess --dbname=webchess',
    ]) &&
    healthcheck?.Interval === 5_000_000_000 &&
    healthcheck?.Timeout === 5_000_000_000 &&
    healthcheck?.Retries === 12 &&
    (healthcheck?.StartPeriod === undefined || healthcheck.StartPeriod === 0) &&
    (healthcheck?.StartInterval === undefined || healthcheck.StartInterval === 0) &&
    healthcheck?.Disable !== true
  const emptyList = (value) => (
    value === null || value === undefined ||
    (Array.isArray(value) && value.length === 0)
  )
  const networkMode = hostConfig?.NetworkMode
  const isolatedNetwork =
    networkMode === 'default' ||
    networkMode === 'bridge' ||
    networkMode === 'webchess-local_default'
  const expectedNetworkName = networkMode === 'default'
    ? 'bridge'
    : networkMode
  const networkNames = Object.keys(inspected?.NetworkSettings?.Networks ?? {})
  const exactNetworkAttachment =
    networkNames.length === 1 && networkNames[0] === expectedNetworkName
  const exactCommand =
    JSON.stringify(config?.Entrypoint) === JSON.stringify(['docker-entrypoint.sh']) &&
    JSON.stringify(config?.Cmd) === JSON.stringify(['postgres']) &&
    (config?.User === '' || config?.User === undefined)
  const constrainedRuntime =
    hostConfig?.AutoRemove === false &&
    hostConfig?.Privileged === false &&
    hostConfig?.PublishAllPorts === false &&
    hostConfig?.ReadonlyRootfs === false &&
    emptyList(hostConfig?.CapAdd) &&
    emptyList(hostConfig?.Devices) &&
    emptyList(hostConfig?.DeviceRequests) &&
    emptyList(hostConfig?.SecurityOpt)
  const exactNamespaces =
    hostConfig?.PidMode === '' &&
    hostConfig?.IpcMode === 'private' &&
    hostConfig?.UTSMode === '' &&
    hostConfig?.UsernsMode === '' &&
    hostConfig?.CgroupnsMode === 'private'
  const owned =
    config?.Labels?.[LOCAL_POSTGRES_OWNER_LABEL] ===
      LOCAL_POSTGRES_OWNER_LABEL_VALUE
  const volumeBinding = config?.Labels?.[LOCAL_POSTGRES_VOLUME_BINDING_LABEL]
  const exactVolumeBinding = [
    LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE,
    LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
  ].includes(volumeBinding)
  const containerId = inspected?.Id
  const exactContainerId =
    typeof containerId === 'string' && /^[a-f0-9]{64}$/u.test(containerId)

  if (
    !inspected ||
    config?.Image !== LOCAL_POSTGRES_IMAGE ||
    (requireOwnership && (!owned || !exactVolumeBinding)) ||
    !exactContainerId ||
    !exactPortBinding ||
    !exactVolume ||
    hostConfig?.RestartPolicy?.Name !== 'unless-stopped' ||
    !exactEnvironment ||
    !exactHealthcheck ||
    !isolatedNetwork ||
    !exactNetworkAttachment ||
    !exactCommand ||
    !constrainedRuntime ||
    !exactNamespaces
  ) {
    throw new Error(
      `The existing ${LOCAL_POSTGRES_CONTAINER} container is not an owned, exact local WebChess database (pinned image, isolated network, loopback port, single persistent volume, constrained runtime, healthcheck, restart policy, command, and PostgreSQL credentials). It was not changed; preserve any data and resolve the name conflict manually.`,
    )
  }
  return { containerId, volumeBinding }
}

function legacyContainerAdoptionError(cause) {
  return new Error(
    `The existing ${LOCAL_POSTGRES_CONTAINER} matches the hardened local database configuration but predates its immutable WebChess ownership label. It was not changed. To adopt it without deleting database data: inspect or back up ${LOCAL_POSTGRES_VOLUME}, run "docker stop ${LOCAL_POSTGRES_CONTAINER}", run "docker rm ${LOCAL_POSTGRES_CONTAINER}", then run "npm run local:setup -- --adopt-volume". Those commands recreate only the container and explicitly adopt the named volume; never run "docker volume rm" for this adoption.`,
    { cause },
  )
}

function assertOwnedLocalPostgresConfiguration(inspectionText, password) {
  try {
    return assertExistingLocalPostgresConfiguration(inspectionText, password)
  } catch (error) {
    try {
      assertExistingLocalPostgresConfiguration(
        inspectionText,
        password,
        { requireOwnership: false },
      )
    } catch {
      throw error
    }
    throw legacyContainerAdoptionError(error)
  }
}

export async function waitForLocalPostgres({
  capture = runCapture,
  container = LOCAL_POSTGRES_CONTAINER,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms)
  }),
  timeoutMs = LOCAL_POSTGRES_READY_TIMEOUT_MS,
} = {}) {
  const deadline = now() + timeoutMs
  while (now() <= deadline) {
    const inspect = await capture('docker', postgresInspectArgs(container))
    const status = inspect.stdout.trim()
    if (status === 'healthy') {
      return
    }
    if (status === 'exited' || status === 'dead') {
      throw new Error(
        'The local WebChess PostgreSQL container exited before it became ready.',
      )
    }
    await sleep(1_000)
  }
  throw new Error(
    'Timed out waiting for local WebChess PostgreSQL to become ready.',
  )
}

export async function verifyLocalPostgresCredentials({
  clientFactory = (configuration) => new PostgresClient(configuration),
  containerId,
  password,
} = {}) {
  if (!/^[a-f0-9]{64}$/u.test(containerId ?? '') || !nonBlank(password)) {
    throw new Error('Exact local PostgreSQL identity and credentials are required.')
  }
  const client = clientFactory({
    connectionTimeoutMillis: 5_000,
    database: LOCAL_POSTGRES_DATABASE,
    host: LOCAL_HOSTNAME,
    password,
    port: LOCAL_POSTGRES_PORT,
    query_timeout: 5_000,
    ssl: false,
    statement_timeout: 5_000,
    user: LOCAL_POSTGRES_USER,
  })
  try {
    await client.connect()
    const result = await client.query('SELECT 1 AS ready')
    if (
      result?.rowCount !== 1 ||
      result.rows?.[0]?.ready !== 1
    ) {
      throw new Error('The PostgreSQL credential probe returned an invalid result.')
    }
  } catch (error) {
    throw new Error(
      `The owned local PostgreSQL container became healthy, but the generated local credentials could not authenticate through ${LOCAL_HOSTNAME}:${LOCAL_POSTGRES_PORT}, the exact endpoint used by WebChess. The credential check did not alter or delete ${LOCAL_POSTGRES_VOLUME}; the owned container may remain running, so reconcile the original password or use local:down before retrying.`,
      { cause: error },
    )
  } finally {
    await client.end().catch(() => {})
  }
}

export async function startLocalPostgres({
  adoptUnlabeledVolume = false,
  password,
  run = runCommand,
  capture = runCapture,
  now = Date.now,
  verifyCredentials = verifyLocalPostgresCredentials,
  sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms)
  }),
} = {}) {
  if (!nonBlank(password)) {
    throw new Error('A local PostgreSQL password is required.')
  }
  const inspect = await capture('docker', existingPostgresInspectArgs())
  let containerId
  if (inspect.code === 0) {
    const existing = assertOwnedLocalPostgresConfiguration(
      inspect.stdout,
      password,
    )
    const volume = await ensureLocalPostgresVolume({
      adoptUnlabeled:
        existing.volumeBinding === LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE,
      capture,
      createIfMissing: false,
      run,
    })
    if (volume.volumeBinding !== existing.volumeBinding) {
      throw new Error(
        'The owned local PostgreSQL container and its persistent volume have conflicting ownership metadata. Nothing was changed.',
      )
    }
    containerId = existing.containerId
    await run('docker', ['start', containerId])
  } else if (isMissingContainerResult(inspect)) {
    const volume = await ensureLocalPostgresVolume({
      adoptUnlabeled: adoptUnlabeledVolume,
      capture,
      run,
    })
    await run('docker', localPostgresRunArgs({
      volumeBinding: volume.volumeBinding,
    }), {
      env: {
        ...process.env,
        POSTGRES_PASSWORD: password,
      },
    })
    const created = await capture('docker', existingPostgresInspectArgs())
    if (created.code !== 0) {
      throw new Error(
        created.stderr.trim() ||
        `Could not verify the newly created ${LOCAL_POSTGRES_CONTAINER} safely.`,
      )
    }
    const createdConfiguration = assertOwnedLocalPostgresConfiguration(
      created.stdout,
      password,
    )
    if (createdConfiguration.volumeBinding !== volume.volumeBinding) {
      throw new Error(
        'The newly created local PostgreSQL container did not retain the validated volume ownership. Nothing else was changed.',
      )
    }
    containerId = createdConfiguration.containerId
  } else {
    throw new Error(
      inspect.stderr.trim() ||
      `Could not inspect ${LOCAL_POSTGRES_CONTAINER} safely.`,
    )
  }
  await waitForLocalPostgres({
    capture,
    container: containerId,
    now,
    sleep,
  })
  await verifyCredentials({
    containerId,
    password,
  })
}

export async function stopLocalPostgres({
  capture = runCapture,
} = {}) {
  const inspect = await capture('docker', existingPostgresInspectArgs())
  if (inspect.code !== 0 && isMissingContainerResult(inspect)) {
    return false
  }
  if (inspect.code !== 0) {
    throw new Error(
      inspect.stderr.trim() ||
      `Could not inspect ${LOCAL_POSTGRES_CONTAINER} safely before stopping it.`,
    )
  }
  const existing = assertOwnedLocalPostgresConfiguration(inspect.stdout)

  const result = await capture('docker', ['stop', existing.containerId])
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || 'Could not stop the local WebChess PostgreSQL container.',
    )
  }
  return true
}

export function parseLaunchOptions(argv) {
  const args = argv.slice(2)
  const command = args[0] ?? 'dev'
  if (!['setup', 'dev', 'down'].includes(command)) {
    throw new Error('Usage: node scripts/local-hosted.mjs <setup|dev|down> [--adopt-volume] [--no-open] [--port <n>]')
  }

  let adoptVolume = false
  let openBrowser = true
  let port = LOCAL_PORT
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--adopt-volume') {
      adoptVolume = true
      continue
    }
    if (argument === '--no-open') {
      openBrowser = false
      continue
    }
    if (argument === '--port') {
      const portText = args[index + 1]
      index += 1
      port = Number(portText)
      continue
    }
    throw new Error(`Unknown local WebChess option: ${argument}`)
  }

  if (adoptVolume && command !== 'setup') {
    throw new Error('--adopt-volume is allowed only with local:setup.')
  }
  validateLocalPort(port)
  return { adoptVolume, command, openBrowser, port }
}

const NEXT_READY_PATTERN = /\bReady in \d+(?:\.\d+)?(?:ms|s)\b/u

function observeChild(child, {
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  let ready = false
  let outputTail = ''
  let resolveServerReady
  const serverReady = new Promise((resolve) => {
    resolveServerReady = resolve
  })
  const inspectOutput = (target) => (chunk) => {
    target?.write?.(chunk)
    outputTail = `${outputTail}${String(chunk)}`.slice(-512)
    if (!ready && NEXT_READY_PATTERN.test(outputTail)) {
      ready = true
      resolveServerReady(true)
    }
  }
  child.stdout?.on('data', inspectOutput(stdout))
  child.stderr?.on('data', inspectOutput(stderr))

  const outcome = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (!ready) resolveServerReady(false)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (!ready) resolveServerReady(false)
      resolve({ command: 'dev', code, signal })
    })
  })
  return { outcome, serverReady }
}

export function assertLocalAppPortAvailable({
  createServerImpl = createServer,
  hostname = LOCAL_HOSTNAME,
  port,
} = {}) {
  validateLocalPort(port)
  return new Promise((resolve, reject) => {
    const server = createServerImpl()
    const fail = (error) => {
      server.removeAllListeners?.()
      reject(new Error(
        error?.code === 'EADDRINUSE'
          ? `Local WebChess cannot start because ${hostname}:${port} is already in use.`
          : `Local WebChess could not reserve ${hostname}:${port}: ${error?.message ?? 'unknown error'}.`,
      ))
    }
    server.once('error', fail)
    server.once('listening', () => {
      server.removeListener('error', fail)
      server.close((error) => {
        if (error) fail(error)
        else resolve()
      })
    })
    server.listen({ exclusive: true, host: hostname, port })
  })
}

export function signalOwnedProcessGroup(
  child,
  signal,
  {
    killProcess = process.kill,
    platform = process.platform,
  } = {},
) {
  if (platform !== 'win32' && Number.isInteger(child?.pid) && child.pid > 0) {
    try {
      killProcess(-child.pid, signal)
      return true
    } catch (error) {
      if (error?.code === 'ESRCH') return false
      throw error
    }
  }
  if (typeof child?.kill === 'function') {
    return child.kill(signal)
  }
  return false
}

function ownedProcessGroupExists(child, {
  killProcess = process.kill,
  platform = process.platform,
} = {}) {
  if (platform === 'win32' || !Number.isInteger(child?.pid) || child.pid <= 0) {
    return false
  }
  try {
    killProcess(-child.pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

export async function terminateOwnedProcessGroup(
  child,
  {
    graceMs = 2_000,
    killProcess = process.kill,
    now = Date.now,
    platform = process.platform,
    signal = 'SIGTERM',
    sleep = (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
  } = {},
) {
  const sent = signalOwnedProcessGroup(child, signal, {
    killProcess,
    platform,
  })
  if (!sent || platform === 'win32') return

  const deadline = now() + graceMs
  while (now() < deadline) {
    if (!ownedProcessGroupExists(child, { killProcess, platform })) return
    await sleep(Math.min(100, Math.max(1, deadline - now())))
  }
  if (ownedProcessGroupExists(child, { killProcess, platform })) {
    signalOwnedProcessGroup(child, 'SIGKILL', { killProcess, platform })
  }
}

export async function waitForLocalApp({
  childOutcome,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms)
  }),
  probes,
  serverReady = Promise.resolve(true),
  timeoutMs = LOCAL_APP_READY_TIMEOUT_MS,
}) {
  const deadline = now() + timeoutMs
  const deadlineSignal = AbortSignal.timeout(Math.max(1, timeoutMs))
  const timedOut = new Promise((resolve) => {
    deadlineSignal.addEventListener(
      'abort',
      () => resolve({ kind: 'timed-out' }),
      { once: true },
    )
  })
  const stopped = childOutcome.then(
    (result) => ({ kind: 'stopped', result }),
    (error) => ({ error, kind: 'failed' }),
  )
  const announcement = await Promise.race([
    serverReady.then((announced) => ({ announced, kind: 'announced' })),
    stopped,
    timedOut,
  ])
  if (announcement.kind === 'timed-out') {
    throw new Error('Timed out waiting for local WebChess to become ready.')
  }
  if (announcement.kind === 'stopped') {
    throw new Error(
      announcement.result.signal
        ? `Local WebChess exited with ${announcement.result.signal} before it became ready.`
        : `Local WebChess exited with code ${announcement.result.code ?? 'unknown'} before it became ready.`,
    )
  }
  if (announcement.kind === 'failed') throw announcement.error
  if (!announcement.announced) {
    throw new Error('Local WebChess exited before Next.js announced readiness.')
  }

  const readinessProbes = probes ?? []
  if (readinessProbes.length === 0) {
    throw new Error('Local WebChess readiness requires an expected response identity.')
  }

  while (now() <= deadline) {
    const remaining = Math.max(1, deadline - now())
    const probe = Promise.resolve().then(async () => {
      try {
        for (const expected of readinessProbes) {
          const response = await fetchImpl(expected.url, {
            cache: 'no-store',
            redirect: 'manual',
            signal: AbortSignal.timeout(Math.min(5_000, remaining)),
          })
          const contentType = response.headers.get('content-type') ?? ''
          if (
            response.status !== 200 ||
            response.redirected ||
            !contentType.toLowerCase().startsWith('text/html')
          ) {
            return { kind: 'probe-failed' }
          }
          const body = await response.text()
          if (!expected.bodyMarkers.every((marker) => body.includes(marker))) {
            return { kind: 'probe-failed' }
          }
        }
        return { kind: 'probe' }
      } catch {
        return { kind: 'probe-failed' }
      }
    })
    const outcome = await Promise.race([probe, stopped, timedOut])
    if (outcome.kind === 'timed-out') {
      throw new Error('Timed out waiting for local WebChess to become ready.')
    }
    if (outcome.kind === 'stopped') {
      throw new Error(
        outcome.result.signal
          ? `Local WebChess exited with ${outcome.result.signal} before it became ready.`
          : `Local WebChess exited with code ${outcome.result.code ?? 'unknown'} before it became ready.`,
      )
    }
    if (outcome.kind === 'failed') {
      throw outcome.error
    }
    if (
      outcome.kind === 'probe'
    ) {
      return
    }

    const pause = await Promise.race([
      sleep(250).then(() => ({ kind: 'pause' })),
      stopped,
      timedOut,
    ])
    if (pause.kind === 'timed-out') {
      throw new Error('Timed out waiting for local WebChess to become ready.')
    }
    if (pause.kind === 'stopped') {
      throw new Error(
        pause.result.signal
          ? `Local WebChess exited with ${pause.result.signal} before it became ready.`
          : `Local WebChess exited with code ${pause.result.code ?? 'unknown'} before it became ready.`,
      )
    }
    if (pause.kind === 'failed') {
      throw pause.error
    }
  }

  throw new Error('Timed out waiting for local WebChess to become ready.')
}

export async function runLocalHosted(argv, dependencies = {}) {
  const {
    assertPortAvailable = assertLocalAppPortAvailable,
    environment = process.env,
    logger = console,
    openBrowser: openBrowserFn = openLocalBrowser,
    ensureEnv = ensureLocalEnvFiles,
    startPostgres = startLocalPostgres,
    stopPostgres = stopLocalPostgres,
    spawnDev = (command, args, options) => spawn(command, args, options),
    terminateChild = terminateOwnedProcessGroup,
    waitForApp = waitForLocalApp,
    root = process.cwd(),
    signalTarget = process,
  } = dependencies
  const options = parseLaunchOptions(argv)

  if (options.command === 'down') {
    const stopped = await stopPostgres({ root })
    logger.log(
      stopped === false
        ? 'No owned local WebChess PostgreSQL container is present.'
        : 'Stopped the owned local WebChess PostgreSQL container.',
    )
    return { command: 'down' }
  }

  const files = await ensureEnv({ root })
  parseLoopbackPostgresUrl(files.appEnv.DATABASE_URL)

  const resolved = combinedEnvironment(
    environment,
    files.rootEnv ?? {},
    files.appEnv,
  )
  const authMode = resolveLocalAuthMode(resolved)
  const missing = missingLocalHostedSecrets(resolved)
  if (missing.length > 0) {
    logger.error(`Local WebChess is missing: ${missing.join(', ')}.`)
    if (options.command === 'setup') {
      await startPostgres({
        adoptUnlabeledVolume: options.adoptVolume,
        password: files.postgresPassword,
        root,
      })
      logger.log(`PostgreSQL is running on ${LOCAL_HOSTNAME}:${LOCAL_POSTGRES_PORT}.`)
      return { authMode, command: 'setup', missing, ready: false }
    }
    throw new Error('Local WebChess is not fully configured.')
  }
  validateLocalHostedSecrets(resolved)

  if (options.command === 'dev') {
    await assertPortAvailable({
      hostname: LOCAL_HOSTNAME,
      port: options.port,
    })
  }

  await startPostgres({
    adoptUnlabeledVolume: options.adoptVolume,
    password: files.postgresPassword,
    root,
  })

  const origin = `http://localhost:${options.port}`
  logger.log(`Local PostgreSQL is ready on ${LOCAL_HOSTNAME}:${LOCAL_POSTGRES_PORT}.`)
  if (options.command === 'setup') {
    logger.log(
      authMode === 'clerk'
        ? `Clerk development sign-in will be available at ${origin}/sign-in after starting npm run local:dev.`
        : `A signed loopback session will be available at ${origin}/sign-in after starting npm run local:dev.`,
    )
    return { authMode, command: 'setup', missing: [], ready: true }
  }

  const url = `${origin}/play`
  logger.log(`Starting local WebChess at ${url}`)

  const child = spawnDev(
    'npm',
    localDevArgs(options.port),
    {
      cwd: root,
      env: buildChildEnvironment({
        ...resolved,
        NEXT_PUBLIC_SITE_URL: origin,
      }),
      detached: process.platform !== 'win32',
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  )
  const observedChild = observeChild(child)
  const childOutcome = observedChild.outcome

  let termination
  const stopChild = (signal = 'SIGTERM') => {
    termination ??= Promise.resolve(terminateChild(child, { signal }))
    return termination
  }
  const stopForSigint = () => {
    void stopChild('SIGINT')
  }
  const stopForSigterm = () => {
    void stopChild('SIGTERM')
  }
  const stopForSighup = () => {
    void stopChild('SIGHUP')
  }
  signalTarget.once('SIGHUP', stopForSighup)
  signalTarget.once('SIGINT', stopForSigint)
  signalTarget.once('SIGTERM', stopForSigterm)

  try {
    await waitForApp({
      childOutcome,
      probes: [
        {
          bodyMarkers: [
            'Every question arrives wrapped in its first frame.',
            'Board events generate',
          ],
          url: `http://${LOCAL_HOSTNAME}:${options.port}/`,
        },
        {
          bodyMarkers: authMode === 'clerk'
            ? ['WebChess', 'Sign in to play.']
            : ['WebChess', 'Continue on this computer.'],
          url: `http://${LOCAL_HOSTNAME}:${options.port}/sign-in`,
        },
      ],
      serverReady: observedChild.serverReady,
    })
    logger.log(
      authMode === 'clerk'
        ? `Local WebChess is ready with Clerk development authentication at ${url}`
        : `Local WebChess is ready with a signed loopback session at ${url}`,
    )
    if (options.openBrowser) {
      await openBrowserFn(url)
    }
    return await childOutcome
  } finally {
    signalTarget.removeListener('SIGHUP', stopForSighup)
    signalTarget.removeListener('SIGINT', stopForSigint)
    signalTarget.removeListener('SIGTERM', stopForSigterm)
    await stopChild('SIGTERM')
  }
}

async function run() {
  try {
    const result = await runLocalHosted(process.argv)
    if (result.command === 'dev' && result.code && result.code !== 0) {
      process.exitCode = result.code
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await run()
}

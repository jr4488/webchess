import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  cp,
  mkdtemp,
  rm,
  symlink,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 3210
// A cold staged Next.js compile and OpenClaw provider/database health check can
// legitimately exceed one minute on a busy local machine. Keep each probe
// bounded while giving the foreground launcher enough time to become ready.
const STARTUP_TIMEOUT_MS = 120_000
const READINESS_REQUEST_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const RUNTIME_ENTRIES = [
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'db',
  'docs',
  'INSTALL.md',
  'LICENSE',
  'next.config.ts',
  'package.json',
  'public',
  'README.md',
  'SECURITY.md',
  'src',
  'SUPPORT.md',
  'tsconfig.json',
] as const

export interface WebChessLaunchOptions {
  openBrowser: boolean
  port: number
}

export interface SpawnedServer {
  exitCode: number | null
  kill(signal?: NodeJS.Signals): boolean
  killed: boolean
  off(event: 'error', listener: (error: Error) => void): this
  off(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this
  once(event: 'error', listener: (error: Error) => void): this
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this
  pid?: number
  signalCode: NodeJS.Signals | null
}

export interface LauncherDependencies {
  environment: NodeJS.ProcessEnv
  fetch: typeof globalThis.fetch
  openBrowser: (url: string) => void
  removeRuntime: (root: string) => Promise<void>
  shutdownTimeoutMs: number
  spawnServer: (
    command: string,
    args: readonly string[],
    options: {
      cwd: string
      detached: boolean
      env: NodeJS.ProcessEnv
      stdio: 'inherit'
    },
  ) => SpawnedServer
  stageRuntime: (sourceRoot: string, nextBinary: string) => Promise<string>
  startupTimeoutMs: number
}

export interface NextLaunchSpec {
  args: readonly string[]
  command: string
  cwd: string
  detached: boolean
  env: NodeJS.ProcessEnv
  readinessUrl: string
  url: string
}

function optionString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseLaunchOptions(
  raw: Record<string, unknown>,
): WebChessLaunchOptions {
  const portText = optionString(raw.port) ?? String(DEFAULT_PORT)
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('WebChess --port must be an integer from 1024 through 65535.')
  }

  return {
    openBrowser: raw.open !== false,
    port,
  }
}

export function resolveWebChessRoot(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('../../', moduleUrl))
}

export function resolveNextBinary(moduleUrl: string = import.meta.url): string {
  return createRequire(moduleUrl).resolve('next/dist/bin/next')
}

export function nodeModulesRootForNextBinary(nextBinary: string): string {
  return path.resolve(path.dirname(nextBinary), '../../..')
}

function dedicatedDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const value = environment.WEBCHESS_OPENCLAW_DATABASE_URL?.trim()
  if (!value) {
    throw new Error(
      'WEBCHESS_OPENCLAW_DATABASE_URL is required and must point to a dedicated loopback PostgreSQL database.',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('WEBCHESS_OPENCLAW_DATABASE_URL is not a valid URL.')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(hostname)
  ) {
    throw new Error(
      'WEBCHESS_OPENCLAW_DATABASE_URL must use PostgreSQL on a loopback host.',
    )
  }
  return value
}

function installationOwnerId(
  environment: NodeJS.ProcessEnv,
  installationRoot: string,
): string {
  const configured = environment.WEBCHESS_OPENCLAW_OWNER_ID?.trim()
  if (configured) {
    if (!/^openclaw_[a-z0-9_-]{8,80}$/u.test(configured)) {
      throw new Error(
        'WEBCHESS_OPENCLAW_OWNER_ID must start with openclaw_ and contain only lowercase letters, numbers, underscores, or hyphens.',
      )
    }
    return configured
  }
  const digest = createHash('sha256')
    .update(`webchess-openclaw-owner-v2\0${path.resolve(installationRoot)}`)
    .digest('hex')
    .slice(0, 32)
  return `openclaw_${digest}`
}

function installationSecret(
  environment: NodeJS.ProcessEnv,
  name: 'WEBCHESS_HMAC_SECRET' | 'WEBCHESS_DELETION_HMAC_SECRET',
  purpose: string,
  installationRoot: string,
): string {
  const configured = environment[name]?.trim()
  if (configured) {
    if (Buffer.byteLength(configured, 'utf8') < 32) {
      throw new Error(`${name} must contain at least 32 bytes.`)
    }
    return configured
  }
  return createHash('sha512')
    .update(`webchess-openclaw-${purpose}-v2\0${path.resolve(installationRoot)}`)
    .digest('hex')
}

async function stageWebChessRuntime(
  sourceRoot: string,
  nextBinary: string,
): Promise<string> {
  const runtimeRoot = await mkdtemp(
    path.join(tmpdir(), 'webchess-openclaw-runtime-'),
  )
  try {
    await Promise.all(
      RUNTIME_ENTRIES.map((entry) =>
        cp(
          path.join(sourceRoot, entry),
          path.join(runtimeRoot, entry),
          { recursive: true },
        )),
    )
    await symlink(
      nodeModulesRootForNextBinary(nextBinary),
      path.join(runtimeRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    return runtimeRoot
  } catch (error) {
    await rm(runtimeRoot, { force: true, recursive: true })
    throw error
  }
}

export function buildNextLaunchSpec(
  root: string,
  options: WebChessLaunchOptions,
  environment: NodeJS.ProcessEnv = process.env,
  nextBinary: string = resolveNextBinary(),
  installationRoot: string = root,
): NextLaunchSpec {
  const url = `http://127.0.0.1:${options.port}/openclaw`
  const origin = `http://127.0.0.1:${options.port}`
  const localDatabaseUrl = dedicatedDatabaseUrl(environment)
  const localEnvironment = { ...environment }
  for (const name of [
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_TARGET_ENV',
    'VERCEL_URL',
  ]) {
    delete localEnvironment[name]
  }
  Object.assign(localEnvironment, {
    CLERK_SECRET_KEY: '',
    DATABASE_URL: '',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
    NEXT_PUBLIC_SITE_URL: origin,
    NODE_ENV: 'development',
    OPENAI_API_KEY: '',
    WEBCHESS_DAILY_GAME_LIMIT:
      environment.WEBCHESS_DAILY_GAME_LIMIT ?? '1000',
    WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT:
      environment.WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT ?? '10000',
    WEBCHESS_DAILY_MODEL_REQUEST_LIMIT:
      environment.WEBCHESS_DAILY_MODEL_REQUEST_LIMIT ?? '10000',
    WEBCHESS_DELETION_HMAC_SECRET: installationSecret(
      environment,
      'WEBCHESS_DELETION_HMAC_SECRET',
      'deletion-hmac',
      installationRoot,
    ),
    WEBCHESS_HMAC_SECRET: installationSecret(
      environment,
      'WEBCHESS_HMAC_SECRET',
      'usage-hmac',
      installationRoot,
    ),
    WEBCHESS_HOURLY_GAME_START_LIMIT:
      environment.WEBCHESS_HOURLY_GAME_START_LIMIT ?? '1000',
    WEBCHESS_HOURLY_IP_GAME_START_LIMIT:
      environment.WEBCHESS_HOURLY_IP_GAME_START_LIMIT ?? '1000',
    WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT:
      environment.WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT ?? '1000',
    WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT:
      environment.WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT ?? '1000',
    WEBCHESS_OPENCLAW_DATABASE_URL: localDatabaseUrl,
    WEBCHESS_OPENCLAW_ENABLED: 'true',
    WEBCHESS_OPENCLAW_OWNER_ID: installationOwnerId(
      environment,
      installationRoot,
    ),
    WEBCHESS_OPENCLAW_TIMEOUT_MS:
      environment.WEBCHESS_OPENCLAW_TIMEOUT_MS ?? '150000',
    WEBCHESS_OPENCLAW_TRANSPORT: 'local',
  })
  return {
    args: [
      nextBinary,
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(options.port),
    ],
    command: process.execPath,
    cwd: root,
    detached: process.platform !== 'win32',
    env: localEnvironment,
    readinessUrl: `${origin}/api/openclaw/status`,
    url,
  }
}

function defaultOpenBrowser(url: string): void {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd.exe'
      : 'xdg-open'
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url]
  const child = spawn(command, args, {
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', () => {
    // The URL was already printed; a missing platform opener is non-fatal.
  })
  child.unref()
}

const defaultDependencies: LauncherDependencies = {
  environment: process.env,
  fetch: globalThis.fetch,
  openBrowser: defaultOpenBrowser,
  removeRuntime: (root) => rm(root, { force: true, recursive: true }),
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  spawnServer: (command, args, options) =>
    spawn(command, [...args], {
      ...options,
      shell: false,
    }),
  stageRuntime: stageWebChessRuntime,
  startupTimeoutMs: STARTUP_TIMEOUT_MS,
}

function signalServerTree(
  server: SpawnedServer,
  signal: NodeJS.Signals,
): void {
  if (hasServerExited(server)) return
  if (process.platform !== 'win32' && server.pid) {
    try {
      process.kill(-server.pid, signal)
      return
    } catch {
      // Fall back to the direct child below.
    }
  }
  server.kill(signal)
}

function hasServerExited(server: SpawnedServer): boolean {
  return server.exitCode !== null || server.signalCode !== null
}

async function waitForServer(
  url: string,
  server: SpawnedServer,
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hasServerExited(server)) {
      throw new Error('The local WebChess process exited before it became ready.')
    }
    try {
      const response = await fetcher(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(
          Math.min(
            READINESS_REQUEST_TIMEOUT_MS,
            Math.max(1, deadline - Date.now()),
          ),
        ),
      })
      if (response.ok) {
        const status = await response.json() as {
          available?: unknown
          database?: { available?: unknown }
          lifecycle?: unknown
        }
        if (
          status.available === true &&
          status.database?.available === true &&
          status.lifecycle === 'webchess-2.0'
        ) {
          return
        }
      }
    } catch {
      // The local server is still compiling or starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `The local WebChess process did not become ready within ${String(
      Math.ceil(timeoutMs / 1_000),
    )} seconds.`,
  )
}

function waitForExit(
  server: SpawnedServer,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (hasServerExited(server)) {
    return Promise.resolve({
      code: server.exitCode,
      signal: server.signalCode,
    })
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function waitForExitWithin(
  server: SpawnedServer,
  timeoutMs: number,
): Promise<boolean> {
  if (hasServerExited(server)) return true
  return new Promise((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer)
      server.off('error', onError)
      server.off('exit', onExit)
      resolve(exited)
    }
    const onError = () => finish(hasServerExited(server))
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    server.once('error', onError)
    server.once('exit', onExit)
  })
}

export async function terminateServerAndWait(
  server: SpawnedServer,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  if (hasServerExited(server)) return
  signalServerTree(server, 'SIGTERM')
  if (await waitForExitWithin(server, timeoutMs)) return

  signalServerTree(server, 'SIGKILL')
  if (await waitForExitWithin(server, timeoutMs)) return
  throw new Error(
    'The local WebChess process could not be stopped; its temporary working directory was preserved.',
  )
}

export async function launchWebChess(
  options: WebChessLaunchOptions,
  dependencies: LauncherDependencies = defaultDependencies,
): Promise<void> {
  const sourceRoot = resolveWebChessRoot()
  const nextBinary = resolveNextBinary()
  await access(nextBinary)
  const runtimeRoot = await dependencies.stageRuntime(sourceRoot, nextBinary)
  let server: SpawnedServer | null = null
  try {
    const spec = buildNextLaunchSpec(
      runtimeRoot,
      options,
      dependencies.environment,
      nextBinary,
      sourceRoot,
    )
    const spawnedServer = dependencies.spawnServer(spec.command, spec.args, {
      cwd: spec.cwd,
      detached: spec.detached,
      env: spec.env,
      stdio: 'inherit',
    })
    server = spawnedServer
    let stopping = false
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null

    const stop = () => {
      if (stopping) return
      stopping = true
      signalServerTree(spawnedServer, 'SIGTERM')
      forceKillTimer = setTimeout(() => {
        signalServerTree(spawnedServer, 'SIGKILL')
      }, dependencies.shutdownTimeoutMs)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    try {
      await waitForServer(
        spec.readinessUrl,
        spawnedServer,
        dependencies.fetch,
        dependencies.startupTimeoutMs,
      )
      console.log(`WebChess is ready at ${spec.url}`)
      console.log(
        'Game history and WebChess 2.0 lifecycle data stay in the dedicated local PostgreSQL database. Model requests use your configured OpenClaw provider, which may be remote.',
      )
      if (options.openBrowser) dependencies.openBrowser(spec.url)

      const result = await waitForExit(spawnedServer)
      if (!stopping && result.code !== 0) {
        throw new Error(
          `The local WebChess process exited with code ${String(result.code)}.`,
        )
      }
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      if (forceKillTimer) clearTimeout(forceKillTimer)
    }
  } finally {
    if (server && !hasServerExited(server)) {
      await terminateServerAndWait(server, dependencies.shutdownTimeoutMs)
    }
    await dependencies.removeRuntime(runtimeRoot)
  }
}

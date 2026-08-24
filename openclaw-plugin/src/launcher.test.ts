import { EventEmitter } from 'node:events'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildNextLaunchSpec,
  launchWebChess,
  loadOrCreateRuntimeIdentity,
  nodeModulesRootForNextBinary,
  parseLaunchOptions,
  resolveNextBinary,
  resolveRuntimeIdentityPath,
  resolveWebChessBuildIdentity,
  resolveWebChessRoot,
  WEBCHESS_LOCAL_DATA_NOTICE,
  type LauncherDependencies,
  type SpawnedServer,
} from './launcher.js'
import type { OpenClawBridgeApi, WebChessBridge } from './bridge.js'

const BRIDGE: Pick<WebChessBridge, 'token' | 'url'> = {
  token: 'b'.repeat(43),
  url: 'http://127.0.0.1:44123',
}

const IDENTITY = {
  deletionHmacSecret: 'd'.repeat(48),
  hmacSecret: 'h'.repeat(48),
  ownerId: 'openclaw_test_installation',
} as const

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { force: true, recursive: true })
  }
})

const API = {
  config: {},
  runtime: {
    version: '2026.7.1-2',
    agent: {},
    webSearch: {},
  },
} as unknown as OpenClawBridgeApi

class FakeServer extends EventEmitter implements SpawnedServer {
  exitCode: number | null = null
  killed = false
  readonly signals: NodeJS.Signals[] = []
  signalCode: NodeJS.Signals | null = null

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = true
    this.signals.push(signal)
    if (signal === 'SIGTERM') {
      setTimeout(() => {
        this.signalCode = 'SIGTERM'
        this.emit('exit', null, 'SIGTERM')
      }, 5)
    }
    return true
  }
}

describe('OpenClaw WebChess launcher', () => {
  it('distinguishes the software release from the lifecycle schema in launcher copy', () => {
    expect(WEBCHESS_LOCAL_DATA_NOTICE).toContain(
      'WebChess software 2.2.0-rc.1',
    )
    expect(WEBCHESS_LOCAL_DATA_NOTICE).toContain(
      'webchess-2.0 lifecycle schema',
    )
  })

  it('defaults to a foreground loopback launch using local inference', () => {
    expect(parseLaunchOptions({})).toEqual({
      openBrowser: true,
      port: 3210,
    })

    const spec = buildNextLaunchSpec(
      '/plugin/webchess',
      parseLaunchOptions({}),
      {
        AWS_ACCESS_KEY_ID: 'must-not-reach-next',
        AWS_SECRET_ACCESS_KEY: 'must-not-reach-next',
        CLERK_WEBHOOK_SIGNING_SECRET: 'must-not-reach-next',
        DATABASE_URL: 'postgresql://hosted.example/production',
        GITHUB_TOKEN: 'must-not-reach-next',
        MIGRATION_DATABASE_URL: 'postgresql://owner.example/production',
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'user-owned-provider-key',
        OPENCLAW_GATEWAY_TOKEN: 'must-stay-in-openclaw',
        PATH: '/usr/bin',
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        VERCEL_TARGET_ENV: 'preview',
        VERCEL_URL: 'inherited-preview.vercel.app',
        WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
        WEBCHESS_HMAC_SECRET: 'h'.repeat(48),
        WEBCHESS_OPENCLAW_DATABASE_URL:
          'postgresql://webchess:test@127.0.0.1:55432/webchess',
        WEBCHESS_OPENCLAW_OWNER_ID: 'openclaw_test_installation',
      },
      '/managed/node_modules/next/dist/bin/next',
      IDENTITY,
      BRIDGE,
      {
        sourceCommit: 'a'.repeat(40),
        runtimeArtifactSha256: 'b'.repeat(64),
      },
    )
    expect(spec.cwd).toBe('/plugin/webchess')
    expect(spec.url).toBe('http://127.0.0.1:3210/openclaw')
    expect(spec.readinessUrl).toBe(
      'http://127.0.0.1:3210/api/openclaw/status',
    )
    expect(spec.args).toEqual([
      '/managed/node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3210',
    ])
    expect(spec.env).toMatchObject({
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3210',
      NODE_ENV: 'development',
      PATH: '/usr/bin',
      WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
      WEBCHESS_HMAC_SECRET: 'h'.repeat(48),
      WEBCHESS_OPENCLAW_DATABASE_URL:
        'postgresql://webchess:test@127.0.0.1:55432/webchess',
      WEBCHESS_OPENCLAW_ENABLED: 'true',
      WEBCHESS_OPENCLAW_BRIDGE_TOKEN: BRIDGE.token,
      WEBCHESS_OPENCLAW_BRIDGE_URL: BRIDGE.url,
      WEBCHESS_OPENCLAW_OWNER_ID: 'openclaw_test_installation',
      WEBCHESS_OPENCLAW_TIMEOUT_MS: '150000',
      WEBCHESS_OPENCLAW_TRANSPORT: 'local',
      WEBCHESS_RELEASE_SHA: 'a'.repeat(40),
      WEBCHESS_RUNTIME_ARTIFACT_SHA256: 'b'.repeat(64),
    })
    expect(spec.env).not.toHaveProperty('VERCEL')
    expect(spec.env).not.toHaveProperty('VERCEL_ENV')
    expect(spec.env).not.toHaveProperty('VERCEL_TARGET_ENV')
    expect(spec.env).not.toHaveProperty('VERCEL_URL')
    for (const forbidden of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'CLERK_SECRET_KEY',
      'CLERK_WEBHOOK_SIGNING_SECRET',
      'DATABASE_URL',
      'GITHUB_TOKEN',
      'MIGRATION_DATABASE_URL',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'OPENAI_API_KEY',
      'OPENCLAW_GATEWAY_TOKEN',
    ]) {
      expect(spec.env).not.toHaveProperty(forbidden)
    }

    const withoutProviderEnvironment = buildNextLaunchSpec(
      '/plugin/webchess',
      parseLaunchOptions({}),
      {
        NODE_ENV: 'development',
        WEBCHESS_OPENCLAW_DATABASE_URL:
          'postgresql://webchess:test@127.0.0.1:55432/webchess',
      },
      '/managed/node_modules/next/dist/bin/next',
      IDENTITY,
      BRIDGE,
    )
    expect(withoutProviderEnvironment.env).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('persists one random private runtime identity and refuses permissive files', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'webchess-openclaw-identity-test-'),
    )
    temporaryRoots.push(temporaryRoot)
    const environment = {
      HOME: temporaryRoot,
      WEBCHESS_OPENCLAW_STATE_DIR: path.join(temporaryRoot, 'state'),
    }

    const first = await loadOrCreateRuntimeIdentity(environment)
    const second = await loadOrCreateRuntimeIdentity(environment)
    const filename = resolveRuntimeIdentityPath(environment)
    const info = await lstat(filename)

    expect(second).toEqual(first)
    expect(first.ownerId).toMatch(/^openclaw_[a-f0-9]{32}$/u)
    expect(Buffer.byteLength(first.hmacSecret, 'utf8')).toBeGreaterThanOrEqual(32)
    expect(Buffer.byteLength(first.deletionHmacSecret, 'utf8'))
      .toBeGreaterThanOrEqual(32)
    expect(first.hmacSecret).not.toBe(first.deletionHmacSecret)
    if (process.platform !== 'win32') {
      expect(info.mode & 0o777).toBe(0o600)
      await chmod(filename, 0o700)
      await expect(loadOrCreateRuntimeIdentity(environment)).rejects.toThrow(
        /mode 0600/u,
      )
    }
  })

  it('refuses a permissive existing state directory without changing it', async () => {
    if (process.platform === 'win32') return
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'webchess-openclaw-directory-mode-test-'),
    )
    temporaryRoots.push(temporaryRoot)
    const stateRoot = path.join(temporaryRoot, 'state')
    await mkdir(stateRoot, { mode: 0o755 })
    await chmod(stateRoot, 0o755)
    await expect(loadOrCreateRuntimeIdentity({
      HOME: temporaryRoot,
      WEBCHESS_OPENCLAW_STATE_DIR: stateRoot,
    })).rejects.toThrow(/mode 0700/u)
    expect((await lstat(stateRoot)).mode & 0o777).toBe(0o755)
  })

  it('honors partial overrides and refuses a symlink identity file', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'webchess-openclaw-partial-identity-test-'),
    )
    temporaryRoots.push(temporaryRoot)
    const stateRoot = path.join(temporaryRoot, 'state')
    const environment = {
      HOME: temporaryRoot,
      WEBCHESS_HMAC_SECRET: 'configured-hmac-secret-'.repeat(2),
      WEBCHESS_OPENCLAW_STATE_DIR: stateRoot,
    }
    const identity = await loadOrCreateRuntimeIdentity(environment)
    expect(identity.hmacSecret).toBe('configured-hmac-secret-'.repeat(2))

    const symlinkRoot = await mkdtemp(
      path.join(tmpdir(), 'webchess-openclaw-symlink-identity-test-'),
    )
    temporaryRoots.push(symlinkRoot)
    const symlinkState = path.join(symlinkRoot, 'state')
    const symlinkEnvironment = {
      HOME: symlinkRoot,
      WEBCHESS_OPENCLAW_STATE_DIR: symlinkState,
    }
    await loadOrCreateRuntimeIdentity(symlinkEnvironment)
    const filename = resolveRuntimeIdentityPath(symlinkEnvironment)
    const target = path.join(symlinkRoot, 'identity-target')
    await rename(filename, target)
    await symlink(target, filename)
    await expect(loadOrCreateRuntimeIdentity(symlinkEnvironment)).rejects
      .toThrow(/regular file, not a symlink/u)
  })

  it('uses complete explicit identity overrides without creating a state file', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), 'webchess-openclaw-explicit-identity-test-'),
    )
    temporaryRoots.push(temporaryRoot)
    const environment = {
      WEBCHESS_DELETION_HMAC_SECRET: IDENTITY.deletionHmacSecret,
      WEBCHESS_HMAC_SECRET: IDENTITY.hmacSecret,
      WEBCHESS_OPENCLAW_OWNER_ID: IDENTITY.ownerId,
      WEBCHESS_OPENCLAW_STATE_DIR: path.join(temporaryRoot, 'state'),
    }

    await expect(loadOrCreateRuntimeIdentity(environment)).resolves.toEqual(
      IDENTITY,
    )
    await expect(lstat(resolveRuntimeIdentityPath(environment))).rejects
      .toMatchObject({ code: 'ENOENT' })
  })

  it('accepts bounded display overrides and rejects invalid ports', () => {
    expect(parseLaunchOptions({
      open: false,
      port: '4312',
    })).toEqual({
      openBrowser: false,
      port: 4312,
    })
    expect(() => parseLaunchOptions({ port: '80' })).toThrow(/1024/u)
    expect(() => parseLaunchOptions({ port: 'not-a-port' })).toThrow(/integer/u)
  })

  it('resolves both source and built entry locations to the bundled app root', () => {
    expect(
      resolveWebChessRoot('file:///plugin/webchess/openclaw-plugin/dist/launcher.js'),
    ).toBe('/plugin/webchess/')
    expect(
      resolveWebChessRoot('file:///plugin/webchess/openclaw-plugin/src/launcher.ts'),
    ).toBe('/plugin/webchess/')
    expect(resolveNextBinary()).toMatch(
      /node_modules\/next\/dist\/bin\/next$/u,
    )
    expect(
      nodeModulesRootForNextBinary(
        '/managed/project/node_modules/next/dist/bin/next',
      ),
    ).toBe('/managed/project/node_modules')
  })

  it('derives a staged-runtime digest without inventing a dirty source commit', async () => {
    const identity = await resolveWebChessBuildIdentity(resolveWebChessRoot())

    expect(identity.runtimeArtifactSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(
      identity.sourceCommit === null || /^[0-9a-f]{40}$/u.test(identity.sourceCommit),
    ).toBe(true)
  })

  it('waits for a failed-startup child to stop before removing staging', async () => {
    const server = new FakeServer()
    const sequence: string[] = []
    server.once('exit', () => sequence.push('exit'))
    const dependencies: LauncherDependencies = {
      environment: {
        NODE_ENV: 'test',
        WEBCHESS_DELETION_HMAC_SECRET: IDENTITY.deletionHmacSecret,
        WEBCHESS_HMAC_SECRET: IDENTITY.hmacSecret,
        WEBCHESS_OPENCLAW_DATABASE_URL:
          'postgresql://webchess:test@127.0.0.1:55432/webchess',
        WEBCHESS_OPENCLAW_OWNER_ID: IDENTITY.ownerId,
      },
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as
        unknown as typeof globalThis.fetch,
      openBrowser: vi.fn(),
      removeRuntime: vi.fn(async () => {
        expect(server.exitCode).toBeNull()
        expect(server.signalCode).toBe('SIGTERM')
        sequence.push('remove')
      }),
      resolveBuildIdentity: vi.fn(async () => ({
        sourceCommit: 'a'.repeat(40),
        runtimeArtifactSha256: 'b'.repeat(64),
      })),
      shutdownTimeoutMs: 25,
      spawnServer: vi.fn(() => server),
      startBridge: vi.fn(async () => ({
        ...BRIDGE,
        close: vi.fn(async () => undefined),
      })),
      stageRuntime: vi.fn(async () => '/tmp/staged-webchess-test'),
      startupTimeoutMs: 1,
    }

    await expect(
      launchWebChess(
        { openBrowser: false, port: 4312 },
        dependencies,
        API,
      ),
    ).rejects.toThrow(/did not become ready/u)

    expect(server.signals).toEqual(['SIGTERM'])
    expect(sequence).toEqual(['exit', 'remove'])
    expect(dependencies.removeRuntime).toHaveBeenCalledWith(
      '/tmp/staged-webchess-test',
    )
  })
})

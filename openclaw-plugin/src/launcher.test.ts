import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  buildNextLaunchSpec,
  launchWebChess,
  nodeModulesRootForNextBinary,
  parseLaunchOptions,
  resolveNextBinary,
  resolveWebChessRoot,
  type LauncherDependencies,
  type SpawnedServer,
} from './launcher.js'

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
  it('defaults to a foreground loopback launch using local inference', () => {
    expect(parseLaunchOptions({})).toEqual({
      openBrowser: true,
      port: 3210,
    })

    const spec = buildNextLaunchSpec(
      '/plugin/webchess',
      parseLaunchOptions({}),
      {
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'user-owned-provider-key',
        PATH: '/usr/bin',
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        VERCEL_TARGET_ENV: 'preview',
        VERCEL_URL: 'inherited-preview.vercel.app',
      },
      '/managed/node_modules/next/dist/bin/next',
    )
    expect(spec.cwd).toBe('/plugin/webchess')
    expect(spec.url).toBe('http://127.0.0.1:3210/openclaw')
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
      CLERK_SECRET_KEY: '',
      DATABASE_URL: '',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3210',
      NODE_ENV: 'development',
      OPENAI_API_KEY: 'user-owned-provider-key',
      PATH: '/usr/bin',
      WEBCHESS_OPENCLAW_ENABLED: 'true',
      WEBCHESS_OPENCLAW_TRANSPORT: 'local',
    })
    expect(spec.env).not.toHaveProperty('VERCEL')
    expect(spec.env).not.toHaveProperty('VERCEL_ENV')
    expect(spec.env).not.toHaveProperty('VERCEL_TARGET_ENV')
    expect(spec.env).not.toHaveProperty('VERCEL_URL')

    const withoutProviderEnvironment = buildNextLaunchSpec(
      '/plugin/webchess',
      parseLaunchOptions({}),
      { NODE_ENV: 'development' },
      '/managed/node_modules/next/dist/bin/next',
    )
    expect(withoutProviderEnvironment.env.OPENAI_API_KEY).toBe('')
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

  it('waits for a failed-startup child to stop before removing staging', async () => {
    const server = new FakeServer()
    const sequence: string[] = []
    server.once('exit', () => sequence.push('exit'))
    const dependencies: LauncherDependencies = {
      fetch: vi.fn(async () => new Response(null, { status: 503 })) as
        unknown as typeof globalThis.fetch,
      openBrowser: vi.fn(),
      removeRuntime: vi.fn(async () => {
        expect(server.exitCode).toBeNull()
        expect(server.signalCode).toBe('SIGTERM')
        sequence.push('remove')
      }),
      shutdownTimeoutMs: 25,
      spawnServer: vi.fn(() => server),
      stageRuntime: vi.fn(async () => '/tmp/staged-webchess-test'),
      startupTimeoutMs: 1,
    }

    await expect(
      launchWebChess(
        { openBrowser: false, port: 4312 },
        dependencies,
      ),
    ).rejects.toThrow(/did not become ready/u)

    expect(server.signals).toEqual(['SIGTERM'])
    expect(sequence).toEqual(['exit', 'remove'])
    expect(dependencies.removeRuntime).toHaveBeenCalledWith(
      '/tmp/staged-webchess-test',
    )
  })
})

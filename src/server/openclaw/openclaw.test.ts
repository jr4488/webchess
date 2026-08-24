// @vitest-environment node

import type { ExecFileException } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { composeProblemParts } from '@/lib/division'
import { getLegalMoves } from '@/lib/game'
import {
  acceptMoveCommand,
  createReplayState,
} from '@/lib/game-replay'
import type { ReplayState } from '@/lib/game-contract'

import {
  createOpenClawExecutor,
  getOpenClawStatus,
  modelAttribution,
  OpenClawCliError,
  parseModelRunEnvelope,
  runOpenClawModel,
  type ExecFileInvoker,
  type OpenClawExecutor,
} from './cli'
import {
  isOpenClawLocalModeEnabled,
  resolveOpenClawConfig,
  type OpenClawConfig,
} from './config'
import {
  generateOpenClawAnswer,
  parseStructuredModelOutput,
} from './generation'
import {
  handleOpenClawAnswerRequest,
  handleOpenClawDivideRequest,
  handleOpenClawStatusRequest,
} from './handlers'
import {
  assertOpenClawLocalRequest,
  isLoopbackHostname,
  MAX_OPENCLAW_JSON_BODY_BYTES,
  readBoundedJson,
} from './request-guard'
import { OpenClawDatabaseReadinessError } from './services'

const PROBLEM =
  'How should I choose a reversible next step while the available evidence is incomplete?'
const SEED = '7a33b7d3-9ff0-4ec0-b8d4-13e30373593a'
const DEV_ENVIRONMENT = {
  NODE_ENV: 'development',
  WEBCHESS_OPENCLAW_ENABLED: 'true',
} as const

function alphabeticCode(value: number): string {
  const first = String.fromCharCode(97 + Math.floor((value - 1) / 26))
  const second = String.fromCharCode(97 + ((value - 1) % 26))
  return `x${first}${second}`
}

function validFacets() {
  return Array.from({ length: 64 }, (_, index) => {
    const id = index + 1
    const code = alphabeticCode(id)
    return {
      id,
      title: `Signal title${code}`,
      focus: `Examine the distinct focus${code} condition influencing this concrete choice.`,
      question: `Which observation about question${code} would change the next step?`,
      keyword: `Marker key${code}`,
    }
  })
}

function words(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(' ')
}

function validAnswerSections() {
  return {
    answer: `Take one reversible step now. Reassess the evidence before expanding the commitment.\n\n${words('context', 80)}`,
    what_the_conflicts_emphasized: words('conflict', 100),
    the_tension_to_hold: words('tension', 90),
    three_next_moves: [
      words('observe', 40),
      words('compare', 40),
      words('revisit', 40),
    ],
    what_could_change_the_answer: words('condition', 90),
  }
}

function modelEnvelope(
  output: unknown,
  transport: 'local' | 'gateway' = 'local',
) {
  return JSON.stringify({
    ok: true,
    capability: 'model.run',
    transport,
    provider: 'test-provider',
    model: 'test-model',
    attempts: [],
    outputs: [{
      text: typeof output === 'string' ? output : JSON.stringify(output),
      mediaUrl: null,
    }],
  })
}

function config(
  overrides: Partial<OpenClawConfig> = {},
): OpenClawConfig {
  return {
    binary: 'openclaw',
    maxOutputBytes: 4 * 1024 * 1024,
    timeoutMs: 130_000,
    transport: 'local',
    ...overrides,
  }
}

function localRequest(
  path: string,
  options: {
    body?: unknown
    fetchSite?: string | null
    host?: string
    method?: string
    origin?: string | null
    urlHost?: string
  } = {},
): Request {
  const method = options.method ?? 'POST'
  const host = options.host ?? 'localhost:3000'
  const headers = new Headers({ host })
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  if (options.origin !== null && method !== 'GET') {
    headers.set('origin', options.origin ?? 'http://localhost:3000')
  }
  if (options.fetchSite !== null) {
    headers.set('sec-fetch-site', options.fetchSite ?? 'same-origin')
  }
  return new Request(`http://${options.urlHost ?? 'localhost:3000'}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function completeGameEvents(): ReplayState {
  const parts = composeProblemParts(validFacets(), SEED)
  let state = createReplayState()

  while (!state.outcome && state.completedPlies < 256) {
    const movingPiece = state.pieces.find((piece) =>
      piece.side === state.turn && getLegalMoves(piece, state.pieces).length > 0)
    if (!movingPiece) {
      throw new Error('Expected a legal move while building the terminal fixture.')
    }
    const destination = getLegalMoves(movingPiece, state.pieces)[0]
    if (!destination) throw new Error('Expected a legal destination.')
    state = acceptMoveCommand(
      state,
      {
        expectedPly: state.completedPlies + 1,
        pieceId: movingPiece.id,
        to: destination,
      },
      parts,
    ).state
  }

  if (!state.outcome) throw new Error('Expected a terminal fixture.')
  return state
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenClaw local configuration and request boundary', () => {
  it('requires an explicit opt-in and is always disabled on Vercel', () => {
    expect(isOpenClawLocalModeEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(isOpenClawLocalModeEnabled({
      NODE_ENV: 'production',
      WEBCHESS_OPENCLAW_ENABLED: 'true',
    })).toBe(true)
    for (const marker of [
      { VERCEL: '1' },
      { VERCEL_ENV: 'preview' },
      { VERCEL_TARGET_ENV: 'preview' },
      { VERCEL_URL: 'webchess-preview.vercel.app' },
    ]) {
      expect(isOpenClawLocalModeEnabled({
        NODE_ENV: 'development',
        WEBCHESS_OPENCLAW_ENABLED: 'true',
        ...marker,
      })).toBe(false)
    }
    expect(isOpenClawLocalModeEnabled({ NODE_ENV: 'production' })).toBe(false)
  })

  it('defaults to local transport and rejects unsafe configuration values', () => {
    expect(resolveOpenClawConfig({})).toMatchObject({
      binary: 'openclaw',
      timeoutMs: 130_000,
      transport: 'local',
    })
    expect(resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BIN: '/opt/openclaw/bin/openclaw',
      WEBCHESS_OPENCLAW_TRANSPORT: 'gateway',
      WEBCHESS_OPENCLAW_TIMEOUT_MS: '90000',
    })).toMatchObject({
      binary: '/opt/openclaw/bin/openclaw',
      timeoutMs: 90_000,
      transport: 'gateway',
    })
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_TRANSPORT: 'remote',
    })).toThrow(/local or gateway/u)
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_TIMEOUT_MS: '0',
    })).toThrow(/must be an integer/u)
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BIN: 'open\0claw',
    })).toThrow(/invalid character/u)
  })

  it('accepts only exact loopback hosts and exact same-origin mutations', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('localhost.example')).toBe(false)

    expect(() => assertOpenClawLocalRequest(
      localRequest('/api/openclaw/divide', { body: { problem: PROBLEM } }),
      { environment: DEV_ENVIRONMENT, mutation: true },
    )).not.toThrow()
    expect(() => assertOpenClawLocalRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        urlHost: 'localhost:3000',
      }),
      { environment: DEV_ENVIRONMENT, mutation: true },
    )).not.toThrow()

    for (const request of [
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        host: 'attacker.example',
      }),
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        urlHost: 'attacker.example',
      }),
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        origin: 'http://127.0.0.1:3000',
      }),
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        origin: null,
      }),
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        fetchSite: 'cross-site',
      }),
    ]) {
      expect(() => assertOpenClawLocalRequest(request, {
        environment: DEV_ENVIRONMENT,
        mutation: true,
      })).toThrow()
    }
  })

  it('fails closed for disabled mode, missing hosts, and malformed or oversized JSON', async () => {
    const request = localRequest('/api/openclaw/divide', {
      body: { problem: PROBLEM },
    })
    expect(() => assertOpenClawLocalRequest(request, {
      environment: { NODE_ENV: 'production' },
      mutation: true,
    })).toThrow(/not enabled/u)

    expect(() => assertOpenClawLocalRequest(
      new Request('http://localhost:3000/api/openclaw/status'),
      { environment: DEV_ENVIRONMENT },
    )).toThrow(/loopback/u)

    await expect(readBoundedJson(new Request(
      'http://localhost:3000/api/openclaw/divide',
      { method: 'POST', body: '{}' },
    ))).rejects.toMatchObject({ status: 415 })

    await expect(readBoundedJson(new Request(
      'http://localhost:3000/api/openclaw/divide',
      {
        method: 'POST',
        headers: {
          'content-length': String(MAX_OPENCLAW_JSON_BODY_BYTES + 1),
          'content-type': 'application/json',
        },
        body: '{}',
      },
    ))).rejects.toMatchObject({ status: 413 })

    await expect(readBoundedJson(new Request(
      'http://localhost:3000/api/openclaw/divide',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: '{not-json',
      },
    ))).rejects.toMatchObject({ status: 400 })
  })
})

describe('OpenClaw process and response boundary', () => {
  it('uses execFile arguments with no shell and force-terminates timed-out work', async () => {
    vi.useFakeTimers()
    let callback:
      | ((
        error: ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void)
      | undefined
    const kill = vi.fn(() => true)
    const invoke: ExecFileInvoker = vi.fn((_file, _args, options, next) => {
      expect(options).toMatchObject({
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      })
      callback = next
      return { kill }
    })
    const execute = createOpenClawExecutor(invoke)
    const pending = execute(['--version'], config({ timeoutMs: 10 }))
    const rejection = expect(pending).rejects.toMatchObject({ kind: 'timeout' })

    await vi.advanceTimersByTimeAsync(10)
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    callback?.(
      Object.assign(new Error('private stderr must not escape'), {
        killed: true,
        signal: 'SIGTERM',
      }) as ExecFileException,
      '',
      '',
    )
    await rejection
  })

  it('classifies not-found, aborted, and generic process failures without exposing details', async () => {
    const cases = [
      {
        error: Object.assign(new Error('private path'), { code: 'ENOENT' }),
        expected: 'not-found',
        signal: undefined,
      },
      {
        error: Object.assign(new Error('private abort'), { code: 'ABORT_ERR' }),
        expected: 'aborted',
        signal: AbortSignal.abort(),
      },
      {
        error: Object.assign(new Error('private stderr'), { code: 1 }),
        expected: 'failed',
        signal: undefined,
      },
    ] as const

    for (const testCase of cases) {
      const invoke: ExecFileInvoker = vi.fn((_file, _args, _options, next) => {
        queueMicrotask(() => next(
          testCase.error as ExecFileException,
          '',
          '',
        ))
        return { kill: vi.fn(() => true) }
      })
      const execute = createOpenClawExecutor(invoke)
      await expect(execute(
        ['--version'],
        config(),
        { signal: testCase.signal },
      )).rejects.toMatchObject({ kind: testCase.expected })
    }
  })

  it('classifies OpenClaw hosted-search aborts as timeouts without exposing stderr', async () => {
    const invoke: ExecFileInvoker = vi.fn((_file, _args, _options, next) => {
      queueMicrotask(() => next(
        Object.assign(new Error('private process details'), { code: 1 }),
        '',
        'Error: codex app-server hosted search turn aborted',
      ))
      return { kill: vi.fn(() => true) }
    })

    const pending = createOpenClawExecutor(invoke)(
      ['infer', 'web', 'search'],
      config(),
    )
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    await expect(pending).rejects.not.toThrow(/private process details/u)
  })

  it('resolves successful execFile output and supports the explicit gateway transport', async () => {
    const invoke: ExecFileInvoker = vi.fn((_file, _args, _options, next) => {
      queueMicrotask(() => next(null, 'successful output', ''))
      return { kill: vi.fn(() => true) }
    })
    await expect(createOpenClawExecutor(invoke)(
      ['--version'],
      config(),
    )).resolves.toBe('successful output')

    const execute = vi.fn<OpenClawExecutor>(async () =>
      modelEnvelope({ answer: 'gateway fixture' }, 'gateway'))
    await expect(runOpenClawModel(
      'gateway prompt',
      config({ transport: 'gateway' }),
      { execute },
    )).resolves.toMatchObject({ transport: 'gateway' })
    expect(execute.mock.calls[0]?.[0]).toContain('--gateway')
  })

  it('inherits configured model/auth without browser model selection and requests canonical medium reasoning', async () => {
    const execute = vi.fn<OpenClawExecutor>(async () =>
      modelEnvelope({ answer: 'fixture' }))

    const result = await runOpenClawModel('bounded prompt', config(), { execute })

    expect(result).toMatchObject({
      provider: 'test-provider',
      model: 'test-model',
      outputText: JSON.stringify({ answer: 'fixture' }),
      transport: 'local',
    })
    const args = execute.mock.calls[0]?.[0] ?? []
    expect(args).toEqual([
      '--no-color',
      'infer',
      'model',
      'run',
      '--local',
      '--json',
      '--thinking',
      'medium',
      '--prompt',
      'bounded prompt',
    ])
    expect(args).not.toContain('--model')
    expect(args).toContain('--thinking')
  })

  it('strictly parses the envelope and creates safe provider/model attribution', () => {
    expect(parseModelRunEnvelope(
      modelEnvelope('```json\n{}\n```'),
      'local',
    )).toMatchObject({
      outputText: '```json\n{}\n```',
      provider: 'test-provider',
    })
    expect(() => parseModelRunEnvelope(
      modelEnvelope({}, 'gateway'),
      'local',
    )).toThrow(/unexpected model response/u)
    expect(modelAttribution('anthropic', 'claude-test')).toBe(
      'anthropic/claude-test',
    )
    expect(modelAttribution('anthropic', 'anthropic/claude-test')).toBe(
      'anthropic/claude-test',
    )
    expect(modelAttribution('provider', '\u202Ehidden')).toBe(
      'configured OpenClaw model',
    )
  })

  it('returns only sanitized readiness fields from auth status', async () => {
    const execute = vi.fn<OpenClawExecutor>(async (args) => {
      if (args.includes('--version')) return 'OpenClaw 2026.7.1-2\n'
      return JSON.stringify({
        resolvedDefault: 'provider/configured-model',
        configPath: '/private/user/config.json',
        auth: {
          missingProvidersInUse: [],
          accounts: [{ label: 'private-account-label', token: 'secret' }],
        },
      })
    })

    const status = await getOpenClawStatus(config(), { execute })
    expect(status).toEqual({
      available: true,
      model: 'provider/configured-model',
      transport: 'local',
      version: 'OpenClaw 2026.7.1-2',
    })
    expect(JSON.stringify(status)).not.toMatch(
      /private|account-label|configPath|token|secret/u,
    )
  })

  it('reports unconfigured and unavailable auth states without returning auth records', async () => {
    const notConfigured = vi.fn<OpenClawExecutor>(async (args) => {
      if (args.includes('--version')) return 'OpenClaw fixture\n'
      return JSON.stringify({
        resolvedDefault: {
          provider: 'provider',
          model: 'configured-model',
        },
        auth: {
          missingProvidersInUse: ['provider'],
          accounts: [{ token: 'never-return-this' }],
        },
      })
    })
    await expect(getOpenClawStatus(config(), {
      execute: notConfigured,
    })).resolves.toEqual({
      available: false,
      message: 'Configure a usable default model in OpenClaw, then try again.',
      model: 'provider/configured-model',
      reason: 'not-configured',
      transport: 'local',
      version: 'OpenClaw fixture',
    })

    const unavailable = vi.fn<OpenClawExecutor>(async (args) => {
      if (args.includes('--version')) return 'OpenClaw fixture\n'
      throw new OpenClawCliError('failed', 'private auth details')
    })
    const status = await getOpenClawStatus(config(), { execute: unavailable })
    expect(status).toMatchObject({
      available: false,
      reason: 'unavailable',
      version: 'OpenClaw fixture',
    })
    expect(JSON.stringify(status)).not.toContain('private auth details')
  })

  it('accepts exact JSON or one JSON fence but rejects surrounding prose', () => {
    expect(parseStructuredModelOutput('{"ok":true}')).toEqual({ ok: true })
    expect(parseStructuredModelOutput('```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    })
    expect(() => parseStructuredModelOutput(
      'Here is the answer:\n```json\n{"ok":true}\n```',
    )).toThrow(/valid structured JSON/u)
  })
})

describe('OpenClaw route handlers', () => {
  it('reports a missing local CLI as sanitized, non-cacheable readiness state', async () => {
    const execute = vi.fn<OpenClawExecutor>(async () => {
      throw new OpenClawCliError(
        'not-found',
        'private executable lookup details',
      )
    })
    const response = await handleOpenClawStatusRequest(
      localRequest('/api/openclaw/status', { method: 'GET' }),
      {
        ensureServices: async () => ({
          available: true,
          engine: 'PostgreSQL',
          majorVersion: 17,
          scope: 'dedicated-local',
          serverVersion: '17.6',
        }),
        environment: DEV_ENVIRONMENT,
        execute,
      },
    )

    expect(response.status).toBe(503)
    expect(await responseJson(response)).toEqual({
      available: false,
      database: {
        available: true,
        engine: 'PostgreSQL',
        majorVersion: 17,
        scope: 'dedicated-local',
        serverVersion: '17.6',
      },
      lifecycle: 'webchess-2.0',
      model: {
        checked: 'configuration',
        configurationReady: false,
        message: 'Install OpenClaw locally or configure the plugin with its executable path.',
        reason: 'cli-not-found',
        transport: 'local',
      },
      search: {
        available: null,
        checked: false,
        reason: 'not-probed',
        requiredForLaunch: false,
      },
    })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('reports independently checked model configuration and PostgreSQL 17 readiness', async () => {
    const execute = vi.fn<OpenClawExecutor>(async (args) => {
      if (args.includes('--version')) return 'OpenClaw fixture\n'
      return JSON.stringify({
        auth: { missingProvidersInUse: [] },
        resolvedDefault: { model: 'fixture-model', provider: 'fixture-provider' },
      })
    })
    const response = await handleOpenClawStatusRequest(
      localRequest('/api/openclaw/status', { method: 'GET' }),
      {
        ensureServices: async () => ({
          available: true,
          engine: 'PostgreSQL',
          majorVersion: 17,
          scope: 'dedicated-local',
          serverVersion: '17.10',
        }),
        environment: DEV_ENVIRONMENT,
        execute,
      },
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toEqual({
      available: true,
      database: {
        available: true,
        engine: 'PostgreSQL',
        majorVersion: 17,
        scope: 'dedicated-local',
        serverVersion: '17.10',
      },
      lifecycle: 'webchess-2.0',
      model: {
        checked: 'configuration',
        configurationReady: true,
        configuredModel: 'fixture-provider/fixture-model',
        transport: 'local',
        version: 'OpenClaw fixture',
      },
      search: {
        available: null,
        checked: false,
        reason: 'not-probed',
        requiredForLaunch: false,
      },
    })
  })

  it('reports an unsupported database without claiming model or search failure', async () => {
    const execute = vi.fn<OpenClawExecutor>(async (args) => {
      if (args.includes('--version')) return 'OpenClaw fixture\n'
      return JSON.stringify({
        auth: { missingProvidersInUse: [] },
        resolvedDefault: { model: 'fixture-model', provider: 'fixture-provider' },
      })
    })
    const response = await handleOpenClawStatusRequest(
      localRequest('/api/openclaw/status', { method: 'GET' }),
      {
        ensureServices: async () => {
          throw new OpenClawDatabaseReadinessError(
            'unsupported-version',
            'private database detail',
            {
              detectedMajorVersion: 16,
              detectedServerVersion: '16.10',
            },
          )
        },
        environment: DEV_ENVIRONMENT,
        execute,
      },
    )

    expect(response.status).toBe(503)
    expect(await responseJson(response)).toMatchObject({
      available: false,
      database: {
        available: false,
        detectedMajorVersion: 16,
        detectedServerVersion: '16.10',
        reason: 'unsupported-version',
      },
      model: {
        configurationReady: true,
      },
      search: {
        available: null,
        checked: false,
      },
    })
  })

  it('rejects a cross-site status probe before launching OpenClaw', async () => {
    const execute = vi.fn<OpenClawExecutor>()
    const response = await handleOpenClawStatusRequest(
      localRequest('/api/openclaw/status', {
        fetchSite: 'cross-site',
        method: 'GET',
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('divides locally with validated facets, a server seed, and no credentials', async () => {
    const execute = vi.fn<OpenClawExecutor>(async () =>
      modelEnvelope({ facets: validFacets().reverse() }))
    const response = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
      }),
      {
        environment: DEV_ENVIRONMENT,
        execute,
        seed: () => SEED,
      },
    )

    expect(response.status).toBe(201)
    expect(await responseJson(response)).toMatchObject({
      division: {
        facets: expect.arrayContaining([
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 64 }),
        ]),
        model: 'test-provider/test-model',
        parts: expect.any(Array),
        prompt: expect.stringContaining(PROBLEM),
        seed: SEED,
      },
    })
    const args = execute.mock.calls[0]?.[0] ?? []
    expect(args).not.toContain('--model')
    expect(args).toContain('--thinking')
    expect(args.join(' ')).not.toMatch(/api[_-]?key|authorization|credential/iu)
  })

  it('rejects cross-origin and unsupported credential/model fields before execution', async () => {
    const execute = vi.fn<OpenClawExecutor>()
    const crossOrigin = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        origin: 'https://attacker.example',
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )
    expect(crossOrigin.status).toBe(403)

    const unsupported = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: {
          problem: PROBLEM,
          apiKey: 'must-not-be-accepted',
          model: 'must-not-be-selected',
        },
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )
    expect(unsupported.status).toBe(400)

    const missingProblem = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', { body: {} }),
      { environment: DEV_ENVIRONMENT, execute },
    )
    expect(missingProblem.status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not expose CLI failures or stderr to the browser', async () => {
    const execute = vi.fn<OpenClawExecutor>(async () => {
      throw new OpenClawCliError(
        'failed',
        'token=private-value stderr=/private/config',
      )
    })
    const response = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )
    const body = await response.text()

    expect(response.status).toBe(502)
    expect(body).toContain('Check your local default model and authentication')
    expect(body).not.toMatch(/private-value|private\/config|stderr|token=/u)
  })

  it('rejects forged or incomplete histories before making a final model call', async () => {
    const execute = vi.fn<OpenClawExecutor>()
    const response = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', {
        body: {
          problem: PROBLEM,
          division: { seed: SEED, facets: validFacets() },
          events: [{
            version: 1,
            type: 'move',
            ply: 1,
            side: 'white',
            pieceId: 'white-pawn-1',
            from: { ring: 4, sector: 0 },
            to: { ring: 5, sector: 0 },
          }],
        },
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: { code: 'INVALID_GAME_REPLAY' },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires a terminal canonical replay before invoking the answer model', async () => {
    const execute = vi.fn<OpenClawExecutor>()
    const response = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', {
        body: {
          problem: PROBLEM,
          division: { seed: SEED, facets: validFacets() },
          events: [],
        },
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )

    expect(response.status).toBe(409)
    expect(await responseJson(response)).toMatchObject({
      error: { code: 'GAME_NOT_COMPLETE' },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('recomputes the cast, replays a terminal game, and validates the final reading', async () => {
    const terminal = completeGameEvents()
    const execute = vi.fn<OpenClawExecutor>(async () =>
      modelEnvelope(validAnswerSections()))
    const body = {
      problem: PROBLEM,
      division: { seed: SEED, facets: validFacets() },
      events: [...terminal.events],
    }

    const generated = await generateOpenClawAnswer(
      body,
      config(),
      { execute },
    )
    expect(generated).toMatchObject({
      answer: {
        answer: expect.stringContaining('Three next moves\n\n1. '),
        model: 'test-provider/test-model',
        prompt: expect.stringContaining('"game_evidence"'),
      },
    })

    const routeResponse = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', { body }),
      { environment: DEV_ENVIRONMENT, execute },
    )
    expect(routeResponse.status).toBe(200)
    expect(await responseJson(routeResponse)).toMatchObject({
      answer: {
        answer: expect.stringContaining('What could change the answer'),
        model: 'test-provider/test-model',
      },
    })
  })

  it('does not accept browser-composed problem parts as answer authority', async () => {
    const execute = vi.fn<OpenClawExecutor>()
    const response = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', {
        body: {
          problem: PROBLEM,
          division: { seed: SEED, facets: validFacets() },
          events: [],
          parts: composeProblemParts(validFacets(), 'browser-selected-seed'),
        },
      }),
      { environment: DEV_ENVIRONMENT, execute },
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    })
    expect(execute).not.toHaveBeenCalled()
  })
})

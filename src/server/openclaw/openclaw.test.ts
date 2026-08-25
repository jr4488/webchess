// @vitest-environment node

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { composeProblemParts } from '@/lib/division'
import { getLegalMoves } from '@/lib/game'
import {
  acceptMoveCommand,
  createReplayState,
} from '@/lib/game-replay'
import type { ReplayState } from '@/lib/game-contract'

import {
  createOpenClawBridgeRequester,
  getOpenClawStatus,
  modelAttribution,
  OpenClawCliError,
  parseModelRunEnvelope,
  runOpenClawModel,
  type OpenClawBridgeRequester,
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
const requesterTestServers: Server[] = []

async function listenRequesterTestServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler)
  requesterTestServers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP loopback test address.')
  }
  return `http://127.0.0.1:${String(address.port)}`
}

function configuredSearchReadiness(available = true) {
  return {
    available,
    checked: 'live-readiness-probe' as const,
    configurationReady: available,
    oauthReady: available,
    provider: 'codex' as const,
    providerReady: available,
    queryExecuted: available,
    requiredForLaunch: true as const,
  }
}

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
  transport = 'local',
  input = '',
) {
  return JSON.stringify({
    ok: true,
    capability: 'model.run',
    transport,
    provider: 'test-provider',
    model: 'test-model',
    attempts: [],
    inputBytes: Buffer.byteLength(input, 'utf8'),
    inputSha256: createHash('sha256').update(input, 'utf8').digest('hex'),
    outputs: [{
      text: typeof output === 'string' ? output : JSON.stringify(output),
      mediaUrl: null,
    }],
  })
}

function modelRequester(
  output: unknown,
) {
  return vi.fn<OpenClawBridgeRequester>(async (path, body) => {
    expect(path).toBe('/v1/model/run')
    const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
    return modelEnvelope(output, 'local', prompt)
  })
}

function sequentialModelRequester(...outputs: unknown[]) {
  let index = 0
  return vi.fn<OpenClawBridgeRequester>(async (path, body) => {
    expect(path).toBe('/v1/model/run')
    const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
    const output = outputs[index]
    index += 1
    return modelEnvelope(output, 'local', prompt)
  })
}

function config(
  overrides: Partial<OpenClawConfig> = {},
): OpenClawConfig {
  return {
    binary: 'openclaw',
    bridgeToken: 't'.repeat(43),
    bridgeUrl: 'http://127.0.0.1:44123',
    maxOutputBytes: 4 * 1024 * 1024,
    searchTimeoutMs: 300_000,
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

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(requesterTestServers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }))
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

  it('defaults to local transport and rejects every alternate label', () => {
    expect(resolveOpenClawConfig({})).toMatchObject({
      binary: 'openclaw',
      searchTimeoutMs: 300_000,
      timeoutMs: 150_000,
      transport: 'local',
    })
    expect(resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BIN: '/opt/openclaw/bin/openclaw',
      WEBCHESS_OPENCLAW_SEARCH_TIMEOUT_MS: '240000',
      WEBCHESS_OPENCLAW_TRANSPORT: 'local',
      WEBCHESS_OPENCLAW_TIMEOUT_MS: '90000',
    })).toMatchObject({
      binary: '/opt/openclaw/bin/openclaw',
      searchTimeoutMs: 240_000,
      timeoutMs: 90_000,
      transport: 'local',
    })
    for (const transport of ['gateway', 'remote']) {
      expect(() => resolveOpenClawConfig({
        WEBCHESS_OPENCLAW_TRANSPORT: transport,
      })).toThrow(/must be local/u)
    }
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_TIMEOUT_MS: '0',
    })).toThrow(/must be an integer/u)
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_SEARCH_TIMEOUT_MS: '300001',
    })).toThrow(/SEARCH_TIMEOUT_MS must be an integer/u)
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BIN: 'open\0claw',
    })).toThrow(/invalid character/u)
    expect(resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BRIDGE_TOKEN: 't'.repeat(43),
      WEBCHESS_OPENCLAW_BRIDGE_URL: 'http://127.0.0.1:43123',
    })).toMatchObject({
      bridgeToken: 't'.repeat(43),
      bridgeUrl: 'http://127.0.0.1:43123',
    })
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BRIDGE_TOKEN: 't'.repeat(43),
    })).toThrow(/configured together/u)
    expect(() => resolveOpenClawConfig({
      WEBCHESS_OPENCLAW_BRIDGE_TOKEN: 't'.repeat(43),
      WEBCHESS_OPENCLAW_BRIDGE_URL: 'http://localhost:43123',
    })).toThrow(/127\.0\.0\.1/u)
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
  it('uses authenticated loopback JSON and never places the prompt in a URL or header', async () => {
    const prompt = `${'x'.repeat(131_072)}\nlarge prompt tail`
    const origin = await listenRequesterTestServer((incoming, response) => {
      expect(incoming.url).toBe('/v1/model/run')
      expect(incoming.url).not.toContain(prompt)
      expect(incoming.headers).toMatchObject({
        authorization: `Bearer ${'t'.repeat(43)}`,
        'content-type': 'application/json',
      })
      expect(JSON.stringify(incoming.headers)).not.toContain(prompt)
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          prompt: string
          turnId: string
        }
        expect(body.prompt).toBe(prompt)
        expect(body.turnId).toBe('stable-model-turn')
        response.end(modelEnvelope('ok', 'local', prompt))
      })
    })
    const request = createOpenClawBridgeRequester()

    await expect(runOpenClawModel(prompt, config({ bridgeUrl: origin }), {
      idempotencyKey: 'stable-model-turn',
      request,
    }))
      .resolves.toMatchObject({ outputText: 'ok' })
  })

  it('rejects malformed or oversized model turn identities before transport', async () => {
    let requests = 0
    const origin = await listenRequesterTestServer((_incoming, response) => {
      requests += 1
      response.end('not reached')
    })
    const request = createOpenClawBridgeRequester()

    for (const idempotencyKey of [
      '',
      'contains whitespace',
      'contains\nnewline',
      'x'.repeat(256),
    ]) {
      await expect(runOpenClawModel('bounded prompt', config({ bridgeUrl: origin }), {
        idempotencyKey,
        request,
      })).rejects.toBeInstanceOf(RangeError)
    }
    expect(requests).toBe(0)
  })

  it('runs the provider-start hook only after local model transport validation', async () => {
    const onRequestStart = vi.fn(async () => undefined)

    await expect(runOpenClawModel('bounded prompt', config({
      bridgeToken: null,
      bridgeUrl: null,
    }), {
      idempotencyKey: 'stable-model-turn',
      onRequestStart,
    })).rejects.toMatchObject({ kind: 'not-found' })
    expect(onRequestStart).not.toHaveBeenCalled()

    const request = modelRequester({ answer: 'fixture' })
    await expect(runOpenClawModel('bounded prompt', config(), {
      idempotencyKey: 'invalid turn id',
      onRequestStart,
      request,
    })).rejects.toBeInstanceOf(RangeError)
    expect(onRequestStart).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()

    const order: string[] = []
    const orderedRequest = vi.fn<OpenClawBridgeRequester>(async (_path, body) => {
      order.push('request')
      const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
      return modelEnvelope({ answer: 'fixture' }, 'local', prompt)
    })
    await expect(runOpenClawModel('bounded prompt', config(), {
      idempotencyKey: 'stable-model-turn',
      onRequestStart: async () => {
        order.push('hook')
      },
      request: orderedRequest,
    })).resolves.toMatchObject({ outputText: JSON.stringify({ answer: 'fixture' }) })
    expect(order).toEqual(['hook', 'request'])
  })

  it('bounds bridge time and output without exposing transport details', async () => {
    const hangingOrigin = await listenRequesterTestServer(() => undefined)
    const timedRequest = createOpenClawBridgeRequester()
    await expect(timedRequest(
      '/v1/status',
      null,
      config({ bridgeUrl: hangingOrigin, timeoutMs: 5 }),
    )).rejects.toMatchObject({ kind: 'timeout' })

    const oversizedOrigin = await listenRequesterTestServer((_incoming, response) => {
      response.end('x'.repeat(1_025))
    })
    const oversizedRequest = createOpenClawBridgeRequester()
    await expect(oversizedRequest(
      '/v1/status',
      null,
      config({ bridgeUrl: oversizedOrigin, maxOutputBytes: 1_024 }),
    )).rejects.toMatchObject({ kind: 'invalid-output' })
  })

  it('rejects a non-local model envelope from a loopback bridge', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async (path, body) => {
      expect(path).toBe('/v1/model/run')
      const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
      return modelEnvelope({ answer: 'fixture' }, 'gateway', prompt)
    })
    await expect(runOpenClawModel(
      'local prompt',
      config(),
      { request },
    )).rejects.toMatchObject({ kind: 'invalid-output' })
  })

  it('inherits configured model/auth without browser model selection and requests canonical medium reasoning', async () => {
    const request = modelRequester({ answer: 'fixture' })

    const result = await runOpenClawModel('bounded prompt', config(), {
      idempotencyKey: 'stable-model-turn',
      request,
    })

    expect(result).toMatchObject({
      provider: 'test-provider',
      model: 'test-model',
      outputText: JSON.stringify({ answer: 'fixture' }),
      transport: 'local',
    })
    expect(request.mock.calls[0]?.[1]).toEqual({
      prompt: 'bounded prompt',
      thinking: 'medium',
      timeoutMs: 130_000,
      version: 1,
    })
    expect(request.mock.calls[0]?.[3]).toEqual({
      idempotencyKey: 'stable-model-turn',
      requestTimeoutMs: 305_000,
      signal: undefined,
    })
  })

  it('strictly parses the envelope and creates safe provider/model attribution', () => {
    expect(parseModelRunEnvelope(
      modelEnvelope('```json\n{}\n```'),
    )).toMatchObject({
      outputText: '```json\n{}\n```',
      provider: 'test-provider',
    })
    expect(() => parseModelRunEnvelope(
      modelEnvelope({}, 'gateway'),
    )).toThrow(/unexpected model response/u)
    expect(() => parseModelRunEnvelope(
      modelEnvelope('ok', 'local', 'different prompt'),
      'expected prompt',
    )).toThrow(/exact prompt transport/u)
    expect(modelAttribution('anthropic', 'claude-test')).toBe(
      'anthropic/claude-test',
    )
    expect(modelAttribution('anthropic', 'anthropic/claude-test')).toBe(
      'anthropic/claude-test',
    )
    expect(modelAttribution('provider', '\u202Ehidden')).toBe(
      'selected OpenAI account model',
    )
  })

  it('returns only sanitized readiness fields from the plugin bridge', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => JSON.stringify({
      available: true,
      model: 'provider/configured-model',
      protocolVersion: 1,
      search: configuredSearchReadiness(),
      transport: 'local',
      version: '2026.7.1-2',
    }))

    const statusConfig = config({ timeoutMs: 150_000 })
    const status = await getOpenClawStatus(statusConfig, { request })
    expect(status).toEqual({
      available: true,
      model: 'provider/configured-model',
      search: configuredSearchReadiness(),
      transport: 'local',
      version: '2026.7.1-2',
    })
    expect(JSON.stringify(status)).not.toMatch(
      /private|account-label|configPath|token|secret/u,
    )
    expect(request).toHaveBeenCalledWith(
      '/v1/status',
      null,
      statusConfig,
      { requestTimeoutMs: 155_000, signal: undefined },
    )
  })

  it('rejects a non-local readiness label from a loopback bridge', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => JSON.stringify({
      available: true,
      model: 'provider/configured-model',
      protocolVersion: 1,
      search: configuredSearchReadiness(),
      transport: 'gateway',
      version: '2026.7.1-2',
    }))

    await expect(getOpenClawStatus(config(), { request })).resolves.toEqual({
      available: false,
      message: 'The authenticated OpenClaw plugin bridge is not ready.',
      reason: 'unavailable',
      search: configuredSearchReadiness(false),
      transport: 'local',
    })
  })

  it('reports unconfigured and unavailable bridge states without returning details', async () => {
    const notConfigured = vi.fn<OpenClawBridgeRequester>(async () =>
      JSON.stringify({
        available: true,
        model: null,
        protocolVersion: 1,
        search: configuredSearchReadiness(),
        transport: 'local',
        version: 'OpenClaw fixture',
      }))
    await expect(getOpenClawStatus(config(), {
      request: notConfigured,
    })).resolves.toEqual({
      available: false,
      message: 'Configure a usable default model and authentication in OpenClaw, then try again.',
      reason: 'not-configured',
      search: configuredSearchReadiness(),
      transport: 'local',
      version: 'OpenClaw fixture',
    })

    const unavailable = vi.fn<OpenClawBridgeRequester>(async () => {
      throw new OpenClawCliError('failed', 'private auth details')
    })
    const status = await getOpenClawStatus(config(), { request: unavailable })
    expect(status).toMatchObject({
      available: false,
      reason: 'unavailable',
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
  it('reports a missing plugin bridge as sanitized, non-cacheable readiness state', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => {
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
        request,
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
        checked: 'live-readiness-probe',
        configurationReady: false,
        message: 'Launch WebChess through the installed OpenClaw plugin.',
        reason: 'cli-not-found',
        probeExecuted: false,
        transport: 'local',
      },
      search: {
        ...configuredSearchReadiness(false),
      },
    })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('reports independently checked model configuration and PostgreSQL 17 readiness', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => JSON.stringify({
      available: true,
      model: 'fixture-provider/fixture-model',
      protocolVersion: 1,
      search: configuredSearchReadiness(),
      transport: 'local',
      version: 'OpenClaw fixture',
    }))
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
        request,
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
        checked: 'live-readiness-probe',
        configurationReady: true,
        configuredModel: 'fixture-provider/fixture-model',
        probeExecuted: true,
        transport: 'local',
        version: 'OpenClaw fixture',
      },
      search: {
        ...configuredSearchReadiness(),
      },
    })
  })

  it('reports an unsupported database without claiming model or search failure', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => JSON.stringify({
      available: true,
      model: 'fixture-provider/fixture-model',
      protocolVersion: 1,
      search: configuredSearchReadiness(),
      transport: 'local',
      version: 'OpenClaw fixture',
    }))
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
        request,
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
        ...configuredSearchReadiness(),
      },
    })
  })

  it('rejects a cross-site status probe before launching OpenClaw', async () => {
    const request = vi.fn<OpenClawBridgeRequester>()
    const response = await handleOpenClawStatusRequest(
      localRequest('/api/openclaw/status', {
        fetchSite: 'cross-site',
        method: 'GET',
      }),
      { environment: DEV_ENVIRONMENT, request },
    )

    expect(response.status).toBe(403)
    expect(request).not.toHaveBeenCalled()
  })

  it('divides locally with validated facets, a server seed, and no credentials', async () => {
    const request = modelRequester({ facets: validFacets().reverse() })
    const response = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
      }),
      {
        environment: DEV_ENVIRONMENT,
        request,
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
    expect(request.mock.calls[0]?.[0]).toBe('/v1/model/run')
    const bridgeBody = request.mock.calls[0]?.[1]
    expect(bridgeBody).toMatchObject({ thinking: 'medium' })
    expect(JSON.stringify(bridgeBody)).not.toMatch(
      /api[_-]?key|authorization|credential/iu,
    )
  })

  it('rejects cross-origin and unsupported credential/model fields before execution', async () => {
    const request = vi.fn<OpenClawBridgeRequester>()
    const crossOrigin = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
        origin: 'https://attacker.example',
      }),
      { environment: DEV_ENVIRONMENT, request },
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
      { environment: DEV_ENVIRONMENT, request },
    )
    expect(unsupported.status).toBe(400)

    const missingProblem = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', { body: {} }),
      { environment: DEV_ENVIRONMENT, request },
    )
    expect(missingProblem.status).toBe(400)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not expose CLI failures or stderr to the browser', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => {
      throw new OpenClawCliError(
        'failed',
        'token=private-value stderr=/private/config',
      )
    })
    const response = await handleOpenClawDivideRequest(
      localRequest('/api/openclaw/divide', {
        body: { problem: PROBLEM },
      }),
      { environment: DEV_ENVIRONMENT, request },
    )
    const body = await response.text()

    expect(response.status).toBe(502)
    expect(body).toContain('Check your local default model and authentication')
    expect(body).not.toMatch(/private-value|private\/config|stderr|token=/u)
  })

  it('rejects forged or incomplete histories before making a final model call', async () => {
    const request = vi.fn<OpenClawBridgeRequester>()
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
      { environment: DEV_ENVIRONMENT, request },
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: { code: 'INVALID_GAME_REPLAY' },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('requires a terminal canonical replay before invoking the answer model', async () => {
    const request = vi.fn<OpenClawBridgeRequester>()
    const response = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', {
        body: {
          problem: PROBLEM,
          division: { seed: SEED, facets: validFacets() },
          events: [],
        },
      }),
      { environment: DEV_ENVIRONMENT, request },
    )

    expect(response.status).toBe(409)
    expect(await responseJson(response)).toMatchObject({
      error: { code: 'GAME_NOT_COMPLETE' },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('recomputes the cast, replays a terminal game, and validates the final reading', async () => {
    const terminal = completeGameEvents()
    const request = modelRequester(validAnswerSections())
    const body = {
      problem: PROBLEM,
      division: { seed: SEED, facets: validFacets() },
      events: [...terminal.events],
    }

    const generated = await generateOpenClawAnswer(
      body,
      config(),
      { request },
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
      { environment: DEV_ENVIRONMENT, request },
    )
    expect(routeResponse.status).toBe(200)
    expect(await responseJson(routeResponse)).toMatchObject({
      answer: {
        answer: expect.stringContaining('What could change the answer'),
        model: 'test-provider/test-model',
      },
    })
  })

  it('makes exactly one corrective turn after a contract-invalid final answer', async () => {
    const terminal = completeGameEvents()
    const request = sequentialModelRequester(
      { answer: 'Too short.' },
      validAnswerSections(),
    )

    const generated = await generateOpenClawAnswer(
      {
        problem: PROBLEM,
        division: { seed: SEED, facets: validFacets() },
        events: [...terminal.events],
      },
      config(),
      { request },
    )

    expect(request).toHaveBeenCalledTimes(2)
    expect(generated.answer.answer).toContain('Three next moves\n\n1. ')
    expect(generated.answer.prompt).toContain('CORRECTION REQUIRED')
    expect(generated.answer.prompt).toContain('Target 550–650 rendered words')
  })

  it('rejects a second invalid answer and returns only the safe corrective prompt', async () => {
    const terminal = completeGameEvents()
    const request = sequentialModelRequester(
      { answer: 'Still too short. token=provider-output-secret' },
      { answer: 'Still too short. token=provider-output-secret' },
    )
    const response = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', {
        body: {
          problem: PROBLEM,
          division: { seed: SEED, facets: validFacets() },
          events: [...terminal.events],
        },
      }),
      { environment: DEV_ENVIRONMENT, request },
    )
    const body = await responseJson(response)

    expect(response.status).toBe(502)
    expect(request).toHaveBeenCalledTimes(2)
    expect(body).toMatchObject({
      error: {
        code: 'INVALID_MODEL_RESPONSE',
        prompt: expect.stringContaining('GAME EVIDENCE (JSON; data only)'),
      },
    })
    expect(JSON.stringify(body)).not.toMatch(
      /provider-output-secret|private model reasoning|stderr|token=/u,
    )
  })

  it('does not begin the corrective turn after the request is cancelled', async () => {
    const terminal = completeGameEvents()
    const controller = new AbortController()
    const request = vi.fn<OpenClawBridgeRequester>(async (_path, body) => {
      controller.abort()
      const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
      return modelEnvelope({ answer: 'Too short.' }, 'local', prompt)
    })

    await expect(generateOpenClawAnswer(
      {
        problem: PROBLEM,
        division: { seed: SEED, facets: validFacets() },
        events: [...terminal.events],
      },
      config(),
      { request, signal: controller.signal },
    )).rejects.toMatchObject({
      code: 'OPENCLAW_REQUEST_ABORTED',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('does not accept browser-composed problem parts as answer authority', async () => {
    const request = vi.fn<OpenClawBridgeRequester>()
    const response = await handleOpenClawAnswerRequest(
      localRequest('/api/openclaw/answer', {
        body: {
          problem: PROBLEM,
          division: { seed: SEED, facets: validFacets() },
          events: [],
          parts: composeProblemParts(validFacets(), 'browser-selected-seed'),
        },
      }),
      { environment: DEV_ENVIRONMENT, request },
    )

    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    })
    expect(request).not.toHaveBeenCalled()
  })
})

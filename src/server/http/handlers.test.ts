import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleAccountExportRequest,
  handleAbandonRequest,
  handleAnswerRequest,
  handleClerkWebhookRequest,
  handleCurrentGameRequest,
  handleDeleteAccountRequest,
  handleDivisionIntentRequest,
  handleDivideRequest,
  handleGetGameRequest,
  handleMoveRequest,
  handleReplayRequest,
  handleStartGameRequest,
} from './handlers'
import { ApiError } from './errors'
import type {
  DurableGameDto,
  HttpDependencies,
  WebChessApiServices,
} from './ports'

const GAME_ID = '243af8b3-32f4-471c-a1f8-93a9d3f1501d'
const IDEMPOTENCY_KEY = '0dcfe214-2779-4476-85e6-12c4fab504ea'
const GAME: DurableGameDto = {
  id: GAME_ID,
  sourceGameId: null,
  revision: 3,
  status: 'playing',
  problem: 'Which project should I choose?',
  division: null,
  state: null,
  answer: null,
}

function request(
  path: string,
  options: {
    body?: unknown
    idempotencyKey?: string | null
    method?: string
    origin?: string | null
  } = {},
): Request {
  const headers = new Headers()
  const method = options.method ?? 'POST'

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  if (options.idempotencyKey !== null) {
    headers.set('idempotency-key', options.idempotencyKey ?? IDEMPOTENCY_KEY)
  }
  if (options.origin !== null && method !== 'GET') {
    headers.set('origin', options.origin ?? 'https://webchess.test')
  }

  return new Request(`https://webchess.test${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function createServices(): WebChessApiServices {
  return {
    divide: vi.fn(async () => GAME),
    getCurrentGame: vi.fn(async () => GAME),
    getGame: vi.fn(async () => GAME),
    getDivisionIntent: vi.fn(async () => GAME),
    startGame: vi.fn(async () => GAME),
    move: vi.fn(async () => GAME),
    answer: vi.fn(async () => ({
      game: GAME,
      answer: {
        answer: 'A server-derived reading.',
        model: 'gpt-5.6-sol',
        prompt: 'server-only prompt',
      },
    })),
    getLifecycle: vi.fn(async () => { throw new Error('not used') }),
    runPortia: vi.fn(async () => { throw new Error('not used') }),
    retryLifecycle: vi.fn(async () => { throw new Error('not used') }),
    runCharlotte: vi.fn(async () => { throw new Error('not used') }),
    getProvenance: vi.fn(async () => { throw new Error('not used') }),
    createWilburAction: vi.fn(async () => { throw new Error('not used') }),
    updateWilburAction: vi.fn(async () => { throw new Error('not used') }),
    appendWilburObservation: vi.fn(async () => { throw new Error('not used') }),
    replay: vi.fn(async () => ({
      ...GAME,
      id: 'ee1ab515-b049-40c3-9ac5-6e869479fb05',
      revision: 0,
    })),
    abandon: vi.fn(async () => ({
      ...GAME,
      status: 'abandoned' as const,
    })),
    getAccountUsage: vi.fn(async () => ({
      period: {
        startsAt: '2026-07-26T00:00:00.000Z',
        endsAt: '2026-07-27T00:00:00.000Z',
      },
      modelOperations: {
        used: 1,
        reserved: 0,
        limit: 100,
        remaining: 99,
      },
      gameStarts: {
        used: 1,
        reserved: 0,
        limit: 2,
        remaining: 1,
      },
      activeModelRequests: 0,
    })),
    exportAccount: vi.fn(async () => ({
      games: [GAME],
    })),
    deleteAccountData: vi.fn(async () => undefined),
    handleClerkUserDeleted: vi.fn(async () => undefined),
  }
}

function createDependencies(services = createServices()): HttpDependencies {
  return {
    authenticate: vi.fn(async () => ({
      userId: 'user_test',
      source: 'clerk' as const,
    })),
    verifySameOrigin: vi.fn(() => null),
    services,
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('authenticated API handlers', () => {
  let services: WebChessApiServices
  let dependencies: HttpDependencies

  beforeEach(() => {
    services = createServices()
    dependencies = createDependencies(services)
  })

  it('creates a durable game from only a bounded problem and server context', async () => {
    const divideRequest = request('/api/divide', {
      body: { problem: '  Which project should I choose?  ' },
    })
    divideRequest.headers.set('x-forwarded-for', '203.0.113.17')
    const response = await handleDivideRequest(
      divideRequest,
      dependencies,
    )

    expect(response.status).toBe(201)
    expect(await responseJson(response)).toEqual({ game: GAME })
    expect(services.divide).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user_test',
        problem: 'Which project should I choose?',
        idempotencyKey: IDEMPOTENCY_KEY,
        ipAddress: '203.0.113.17',
        requestId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('does not load or call services when authentication fails', async () => {
    dependencies.authenticate = vi.fn(async () =>
      Response.json({ error: { code: 'AUTHENTICATION_REQUIRED' } }, { status: 401 }),
    )

    const response = await handleDivideRequest(
      request('/api/divide', { body: { problem: 'Question' } }),
      dependencies,
    )

    expect(response.status).toBe(401)
    expect(services.divide).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('checks same-origin before parsing or performing a mutation', async () => {
    dependencies.verifySameOrigin = vi.fn(() =>
      Response.json({ error: { code: 'CROSS_ORIGIN_REQUEST' } }, { status: 403 }),
    )

    const response = await handleMoveRequest(
      request(`/api/games/${GAME_ID}/moves`, {
        body: {
          expectedRevision: 3,
          pieceId: 'white-pawn-0',
          to: { ring: 5, sector: 0 },
        },
        origin: 'https://attacker.example',
      }),
      GAME_ID,
      dependencies,
    )

    expect(response.status).toBe(403)
    expect(services.move).not.toHaveBeenCalled()
  })

  it('rejects visitor keys and model selection as unknown divide fields', async () => {
    const response = await handleDivideRequest(
      request('/api/divide', {
        body: {
          problem: 'Question',
          apiKey: 'visitor-key',
          model: 'visitor-model',
        },
      }),
      dependencies,
    )

    expect(response.status).toBe(400)
    expect(services.divide).not.toHaveBeenCalled()
  })

  it('accepts only revision, piece identity, and destination for moves', async () => {
    const response = await handleMoveRequest(
      request(`/api/games/${GAME_ID}/moves`, {
        body: {
          expectedRevision: 3,
          pieceId: 'white-pawn-0',
          to: { ring: 5, sector: 0 },
        },
      }),
      GAME_ID,
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toEqual({ game: GAME })
    expect(services.move).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user_test',
        gameId: GAME_ID,
        expectedRevision: 3,
        pieceId: 'white-pawn-0',
        to: { ring: 5, sector: 0 },
      }),
    )
  })

  it.each(['pieces', 'captures', 'outcome', 'resonance', 'apiKey', 'model'])(
    'rejects client-supplied authoritative move field %s',
    async (field) => {
      const response = await handleMoveRequest(
        request(`/api/games/${GAME_ID}/moves`, {
          body: {
            expectedRevision: 3,
            pieceId: 'white-pawn-0',
            to: { ring: 5, sector: 0 },
            [field]: [],
          },
        }),
        GAME_ID,
        dependencies,
      )

      expect(response.status).toBe(400)
      expect(services.move).not.toHaveBeenCalled()
    },
  )

  it('rejects client game evidence on answer generation', async () => {
    const response = await handleAnswerRequest(
      request(`/api/games/${GAME_ID}/answer`, {
        body: {
          expectedRevision: 3,
          captures: [],
          outcome: { winner: 'white' },
        },
      }),
      GAME_ID,
      dependencies,
    )

    expect(response.status).toBe(400)
    expect(services.answer).not.toHaveBeenCalled()
  })

  it('forwards a durable terminal-game abandon through the authenticated API', async () => {
    const terminalGame: DurableGameDto = {
      ...GAME,
      status: 'answered',
    }
    services.abandon = vi.fn(async () => ({
      ...terminalGame,
      revision: terminalGame.revision + 1,
      status: 'abandoned' as const,
    }))

    const response = await handleAbandonRequest(
      request(`/api/games/${GAME_ID}/abandon`, {
        body: { expectedRevision: terminalGame.revision },
      }),
      GAME_ID,
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(services.abandon).toHaveBeenCalledWith(expect.objectContaining({
      gameId: GAME_ID,
      expectedRevision: terminalGame.revision,
      idempotencyKey: IDEMPOTENCY_KEY,
    }))
    expect(await responseJson(response)).toMatchObject({
      game: {
        status: 'abandoned',
        revision: terminalGame.revision + 1,
      },
    })
  })

  it('returns the current-game null sentinel without a 204 ambiguity', async () => {
    services.getCurrentGame = vi.fn(async () => null)

    const response = await handleCurrentGameRequest(
      request('/api/games/current', { method: 'GET' }),
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toEqual({ game: null })
  })

  it('returns 404 for malformed identifiers before an owner-scoped lookup', async () => {
    const response = await handleGetGameRequest(
      request('/api/games/not-a-uuid', { method: 'GET' }),
      'not-a-uuid',
      dependencies,
    )

    expect(response.status).toBe(404)
    expect(services.getGame).not.toHaveBeenCalled()
  })

  it('recovers a division intent through an authenticated read without origin checks', async () => {
    dependencies.verifySameOrigin = vi.fn(() => {
      throw new Error('GET recovery must not require an Origin header.')
    })

    const response = await handleDivisionIntentRequest(
      request(`/api/division-intents/${IDEMPOTENCY_KEY}`, {
        method: 'GET',
        origin: null,
      }),
      IDEMPOTENCY_KEY,
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toEqual({ game: GAME })
    expect(services.getDivisionIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user_test',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(dependencies.verifySameOrigin).not.toHaveBeenCalled()
  })

  it('rejects a malformed division intent before its owner-scoped lookup', async () => {
    const response = await handleDivisionIntentRequest(
      request('/api/division-intents/not-a-uuid', { method: 'GET' }),
      'not-a-uuid',
      dependencies,
    )

    expect(response.status).toBe(404)
    expect(services.getDivisionIntent).not.toHaveBeenCalled()
  })

  it('preserves an owner-scoped service not-found response', async () => {
    services.getGame = vi.fn(async () => {
      throw new ApiError('GAME_NOT_FOUND', 404, 'Game not found.')
    })

    const response = await handleGetGameRequest(
      request(`/api/games/${GAME_ID}`, { method: 'GET' }),
      GAME_ID,
      dependencies,
    )

    expect(response.status).toBe(404)
    expect(await responseJson(response)).toMatchObject({
      error: {
        code: 'GAME_NOT_FOUND',
      },
    })
  })

  it('requires a UUID idempotency key on every game mutation', async () => {
    const response = await handleStartGameRequest(
      request(`/api/games/${GAME_ID}/start`, {
        body: { expectedRevision: 3 },
        idempotencyKey: null,
      }),
      GAME_ID,
      dependencies,
    )

    expect(response.status).toBe(400)
    expect(services.startGame).not.toHaveBeenCalled()
  })

  it('returns consistent replay and answer envelopes', async () => {
    const replayResponse = await handleReplayRequest(
      request(`/api/games/${GAME_ID}/replay`, {
        body: { expectedRevision: 3 },
      }),
      GAME_ID,
      dependencies,
    )
    const answerResponse = await handleAnswerRequest(
      request(`/api/games/${GAME_ID}/answer`, {
        body: { expectedRevision: 3 },
      }),
      GAME_ID,
      dependencies,
    )

    expect(replayResponse.status).toBe(201)
    expect(await responseJson(replayResponse)).toHaveProperty('game')
    expect(await responseJson(answerResponse)).toEqual({
      game: GAME,
      answer: {
        answer: 'A server-derived reading.',
        model: 'gpt-5.6-sol',
        prompt: 'server-only prompt',
      },
    })
  })

  it('exports account data as a private JSON attachment', async () => {
    const exportRequest = request('/api/account/export', { method: 'POST' })
    exportRequest.headers.set('x-forwarded-for', '203.0.113.22')
    const response = await handleAccountExportRequest(
      exportRequest,
      dependencies,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="webchess-export-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(JSON.parse(await response.text())).toEqual({ games: [GAME] })
    expect(dependencies.services.exportAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user_test',
        ipAddress: '203.0.113.22',
      }),
    )
    expect(dependencies.verifySameOrigin).toHaveBeenCalledWith(exportRequest)
  })

  it('requires an explicit phrase before deleting WebChess account data', async () => {
    const rejected = await handleDeleteAccountRequest(
      request('/api/account', {
        method: 'DELETE',
        body: { confirmation: 'DELETE' },
      }),
      dependencies,
    )
    const accepted = await handleDeleteAccountRequest(
      request('/api/account', {
        method: 'DELETE',
        body: { confirmation: 'DELETE MY WEBCHESS DATA' },
      }),
      dependencies,
    )

    expect(rejected.status).toBe(400)
    expect(accepted.status).toBe(204)
    expect(services.deleteAccountData).toHaveBeenCalledTimes(1)
  })
})

describe('Clerk webhook handler', () => {
  it('rejects an invalid signature without touching data', async () => {
    const services = createServices()
    const response = await handleClerkWebhookRequest(
      request('/api/webhooks/clerk', {
        body: { type: 'user.deleted' },
        idempotencyKey: null,
      }),
      {
        verify: vi.fn(async () => {
          throw new Error('bad signature')
        }),
        services,
      },
    )

    expect(response.status).toBe(400)
    expect(services.handleClerkUserDeleted).not.toHaveBeenCalled()
  })

  it('processes a verified user.deleted event idempotently by Svix ID', async () => {
    const services = createServices()
    const webhookRequest = request('/api/webhooks/clerk', {
      body: { type: 'user.deleted' },
      idempotencyKey: null,
    })
    webhookRequest.headers.set('svix-id', 'msg_verified_delete')

    const response = await handleClerkWebhookRequest(webhookRequest, {
      verify: vi.fn(async () => ({
        type: 'user.deleted',
        data: { id: 'user_deleted' },
      })),
      services,
    })

    expect(response.status).toBe(200)
    expect(services.handleClerkUserDeleted).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: 'user_deleted',
        webhookEventId: 'msg_verified_delete',
        requestId: expect.any(String),
      }),
    )
  })

  it('acknowledges unrelated verified Clerk events without loading user data', async () => {
    const services = createServices()
    const response = await handleClerkWebhookRequest(
      request('/api/webhooks/clerk', {
        body: { type: 'session.created' },
        idempotencyKey: null,
      }),
      {
        verify: vi.fn(async () => ({
          type: 'session.created',
          data: {},
        })),
        services,
      },
    )

    expect(response.status).toBe(200)
    expect(services.handleClerkUserDeleted).not.toHaveBeenCalled()
  })
})

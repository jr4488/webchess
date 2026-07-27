import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  abandonGame,
  createIdempotencyKey,
  divideProblem,
  getCurrentGame,
  getOwnedGame,
  isWebChessApiError,
  recoverDivisionIntent,
  replayGame,
  requestGameAnswer,
  startGame,
  submitMove,
  WebChessApiError,
} from './webchess-api'
import type { DurableGame } from './webchess-api'

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000'
const IDEMPOTENCY_KEYS = [
  '018f47b2-4b0c-7b9e-8f24-123456789001',
  '018f47b2-4b0c-7b9e-8f24-123456789002',
  '018f47b2-4b0c-7b9e-8f24-123456789003',
  '018f47b2-4b0c-7b9e-8f24-123456789004',
  '018f47b2-4b0c-7b9e-8f24-123456789005',
] as const

const GAME: DurableGame = {
  id: GAME_ID,
  sourceGameId: null,
  revision: 4,
  status: 'playing',
  problem: 'How should this project move forward?',
  division: null,
  state: null,
  answer: null,
}

const ANSWER = {
  answer: 'Proceed deliberately.',
  model: 'gpt-5.6-sol',
  prompt: 'Canonical answer prompt',
}

const FULL_GAME = {
  ...GAME,
  sourceGameId: '223e4567-e89b-42d3-a456-426614174000',
  division: {
    seed: 'durable-seed',
    facets: [],
    parts: [],
    model: 'gpt-5.6-sol',
    prompt: 'Canonical division prompt',
  },
  state: {
    versions: {
      event: 1,
      rules: 'circular-chess-v1',
      engine: 'engine-v2',
      cast: 'cast-v1',
    },
    pieces: [],
    events: [],
    captures: [],
    turn: 'white',
    completedPlies: 0,
    quietPlies: 0,
    lastMove: null,
    outcome: null,
  },
  answer: ANSWER,
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

function requestInit(fetchMock: ReturnType<typeof vi.fn>, call: number): RequestInit {
  return fetchMock.mock.calls[call][1] as RequestInit
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
  const init = requestInit(fetchMock, call)
  return JSON.parse(String(init.body)) as unknown
}

async function gameFailure(game: unknown): Promise<unknown> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ game })),
  )
  return getOwnedGame(GAME_ID).catch((error: unknown) => error)
}

describe('durable WebChess browser API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('creates a browser UUID and sends only the problem when dividing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ game: GAME }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(
      divideProblem('What deserves attention now?', { signal: controller.signal }),
    ).resolves.toEqual(GAME)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/divide')
    expect(requestInit(fetchMock, 0)).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    expect(requestBody(fetchMock, 0)).toEqual({
      problem: 'What deserves attention now?',
    })
    const headers = new Headers(requestInit(fetchMock, 0).headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(headers.get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('loads the current game, an owned game, and a division intent without request bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ game: null }))
      .mockResolvedValueOnce(jsonResponse({ game: GAME }))
      .mockResolvedValueOnce(jsonResponse({ game: GAME }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCurrentGame()).resolves.toBeNull()
    await expect(getOwnedGame(GAME_ID)).resolves.toEqual(GAME)
    await expect(
      recoverDivisionIntent(IDEMPOTENCY_KEYS[0]),
    ).resolves.toEqual(GAME)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/games/current',
      `/api/games/${GAME_ID}`,
      `/api/division-intents/${IDEMPOTENCY_KEYS[0]}`,
    ])
    for (let call = 0; call < 3; call += 1) {
      expect(requestInit(fetchMock, call)).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      expect(requestInit(fetchMock, call)).not.toHaveProperty('body')
      expect(new Headers(requestInit(fetchMock, call).headers).get('Idempotency-Key')).toBeNull()
    }
  })

  it('sends revision-only bodies for start, answer, replay, and abandon', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ game: GAME }))
      .mockResolvedValueOnce(jsonResponse({ game: GAME, answer: ANSWER }))
      .mockResolvedValueOnce(jsonResponse({ game: GAME }))
      .mockResolvedValueOnce(jsonResponse({ game: GAME }))
    vi.stubGlobal('fetch', fetchMock)

    await startGame(GAME_ID, { expectedRevision: 4 }, { idempotencyKey: IDEMPOTENCY_KEYS[0] })
    await requestGameAnswer(
      GAME_ID,
      { expectedRevision: 5 },
      { idempotencyKey: IDEMPOTENCY_KEYS[1] },
    )
    await replayGame(
      GAME_ID,
      { expectedRevision: 6 },
      { idempotencyKey: IDEMPOTENCY_KEYS[2] },
    )
    await abandonGame(
      GAME_ID,
      { expectedRevision: 7 },
      { idempotencyKey: IDEMPOTENCY_KEYS[3] },
    )

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/games/${GAME_ID}/start`,
      `/api/games/${GAME_ID}/answer`,
      `/api/games/${GAME_ID}/replay`,
      `/api/games/${GAME_ID}/abandon`,
    ])
    expect(fetchMock.mock.calls.map((_, call) => requestBody(fetchMock, call))).toEqual([
      { expectedRevision: 4 },
      { expectedRevision: 5 },
      { expectedRevision: 6 },
      { expectedRevision: 7 },
    ])
    expect(
      fetchMock.mock.calls.map((_, call) =>
        new Headers(requestInit(fetchMock, call).headers).get('Idempotency-Key'),
      ),
    ).toEqual(IDEMPOTENCY_KEYS.slice(0, 4))
  })

  it('sends only a piece, destination, and expected revision for a move', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ game: GAME }))
    vi.stubGlobal('fetch', fetchMock)

    await submitMove(
      GAME_ID,
      {
        expectedRevision: 4,
        pieceId: 'white-pawn-4',
        to: { ring: 4, sector: 3 },
      },
      { idempotencyKey: IDEMPOTENCY_KEYS[4] },
    )

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/${GAME_ID}/moves`)
    expect(requestBody(fetchMock, 0)).toEqual({
      pieceId: 'white-pawn-4',
      to: { ring: 4, sector: 3 },
      expectedRevision: 4,
    })
    const body = requestBody(fetchMock, 0) as Record<string, unknown>
    expect(body).not.toHaveProperty('problem')
    expect(body).not.toHaveProperty('pieces')
    expect(body).not.toHaveProperty('captures')
    expect(body).not.toHaveProperty('outcome')
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('apiKey')
  })

  it.each([
    [401, 'authentication-required'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
    [429, 'rate-limited'],
  ] as const)('normalizes HTTP %i as a %s error', async (status, kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'server-code',
              message: 'Server explanation',
            },
          },
          status,
          { 'Retry-After': '12' },
        ),
      ),
    )

    const failure = await getOwnedGame(GAME_ID).catch((error: unknown) => error)
    expect(isWebChessApiError(failure)).toBe(true)
    expect(failure).toMatchObject({
      name: 'WebChessApiError',
      kind,
      status,
      serverCode: 'server-code',
      retryAfterSeconds: 12,
      message: 'Server explanation',
    })
  })

  it('normalizes an HTTP-date Retry-After value', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: 'Wait for capacity.' },
          429,
          { 'Retry-After': 'Sun, 26 Jul 2026 12:00:07 GMT' },
        ),
      ),
    )

    await expect(getOwnedGame(GAME_ID)).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterSeconds: 7,
    })
  })

  it('preserves an AbortError instead of presenting it as a server failure', async () => {
    const abortError = new DOMException('Cancelled', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    await expect(getCurrentGame()).rejects.toBe(abortError)
  })

  it('turns malformed successful JSON into a typed invalid-response error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(getCurrentGame()).rejects.toEqual(
      expect.objectContaining({
        kind: 'invalid-response',
        status: null,
      }),
    )
  })

  it('rejects unsafe mutation metadata before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(() =>
      startGame(
        GAME_ID,
        { expectedRevision: 0 },
        { idempotencyKey: 'not-a-uuid' },
      ),
    ).toThrow(/canonical UUID/i)
    expect(() =>
      submitMove(GAME_ID, {
        expectedRevision: -1,
        pieceId: 'white-pawn-4',
        to: { ring: 4, sector: 3 },
      }),
    ).toThrow(/revision/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parses a complete durable game returned by current-game lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ game: FULL_GAME })),
    )

    await expect(getCurrentGame()).resolves.toEqual(FULL_GAME)
  })

  it.each([
    ['response', null, 'Response must be an object.'],
    ['game', null, 'Game must be an object.'],
    ['status', { ...FULL_GAME, status: 'unknown' }, 'Unsupported game status'],
    ['source id', { ...FULL_GAME, sourceGameId: '' }, 'Game source id is invalid.'],
    ['id', { ...FULL_GAME, id: '' }, 'Game id must be a non-empty string.'],
    ['revision', { ...FULL_GAME, revision: -1 }, 'Game revision must be a non-negative integer.'],
    ['problem', { ...FULL_GAME, problem: ' ' }, 'Game problem must be a non-empty string.'],
  ])('rejects an invalid %s in a successful response', async (
    label,
    value,
    message,
  ) => {
    const failure = label === 'response'
      ? await (() => {
          vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(value)))
          return getOwnedGame(GAME_ID).catch((error: unknown) => error)
        })()
      : await gameFailure(value)

    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message: expect.stringContaining(message),
    })
  })

  it.each([
    ['array value', [], 'Game division must be an object.'],
    [
      'empty seed',
      { ...FULL_GAME.division, seed: '' },
      'Game division seed is invalid.',
    ],
    [
      'non-finite seed',
      { ...FULL_GAME.division, seed: Number.NaN },
      'Game division seed is invalid.',
    ],
    [
      'missing facets',
      { ...FULL_GAME.division, facets: null },
      'Game division is missing its facets or board parts.',
    ],
    [
      'missing parts',
      { ...FULL_GAME.division, parts: null },
      'Game division is missing its facets or board parts.',
    ],
    [
      'invalid prompt',
      { ...FULL_GAME.division, prompt: 42 },
      'Game division prompt is invalid.',
    ],
    [
      'empty model',
      { ...FULL_GAME.division, model: '' },
      'Game division model must be a non-empty string.',
    ],
  ])('rejects division data with an %s', async (_label, division, message) => {
    const failure = await gameFailure({ ...FULL_GAME, division })
    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message,
    })
  })

  it.each([
    ['versions', null],
    ['pieces', null],
    ['events', null],
    ['captures', null],
    ['turn', 'north'],
    ['completedPlies', 0.5],
    ['quietPlies', -0.5],
  ])('rejects a game state with invalid %s', async (field, value) => {
    const failure = await gameFailure({
      ...FULL_GAME,
      state: {
        ...FULL_GAME.state,
        [field]: value,
      },
    })
    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message: 'Game state is incomplete.',
    })
  })

  it('rejects malformed last-move, outcome, and answer data', async () => {
    await expect(gameFailure({
      ...FULL_GAME,
      state: { ...FULL_GAME.state, lastMove: 'invalid' },
    })).resolves.toMatchObject({
      kind: 'invalid-response',
      message: 'Game last move is invalid.',
    })
    await expect(gameFailure({
      ...FULL_GAME,
      state: { ...FULL_GAME.state, outcome: 'invalid' },
    })).resolves.toMatchObject({
      kind: 'invalid-response',
      message: 'Game outcome is invalid.',
    })

    for (const answer of [
      [],
      { ...ANSWER, answer: '' },
      { ...ANSWER, model: '' },
      { ...ANSWER, prompt: '' },
    ]) {
      const failure = await gameFailure({ ...FULL_GAME, answer })
      expect(failure).toMatchObject({ kind: 'invalid-response' })
    }
  })

  it('requires the separate answer envelope to contain an answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ game: FULL_GAME, answer: null })),
    )

    await expect(
      requestGameAnswer(
        GAME_ID,
        { expectedRevision: 4 },
        { idempotencyKey: IDEMPOTENCY_KEYS[0] },
      ),
    ).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'The answer response is incomplete.',
    })
  })

  it.each([
    [401, 'authentication-required', 'Sign in to continue.'],
    [403, 'forbidden', 'You do not have permission'],
    [404, 'not-found', 'requested game was not found'],
    [409, 'conflict', 'game changed before'],
    [429, 'rate-limited', 'Too many requests'],
    [500, 'http-error', 'could not complete this request'],
  ] as const)(
    'uses the safe default message for an empty HTTP %i response',
    async (status, kind, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status })),
      )

      await expect(getOwnedGame(GAME_ID)).rejects.toMatchObject({
        kind,
        status,
        serverCode: null,
        retryAfterSeconds: null,
        message: expect.stringMatching(new RegExp(message, 'i')),
      })
    },
  )

  it('ignores malformed error JSON and invalid Retry-After values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{', {
          status: 500,
          headers: { 'Retry-After': 'not-a-date' },
        }),
      ),
    )

    await expect(getOwnedGame(GAME_ID)).rejects.toMatchObject({
      kind: 'http-error',
      retryAfterSeconds: null,
      message: 'WebChess could not complete this request.',
    })
  })

  it('accepts top-level error details from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { message: 'Top-level detail', code: 'TOP_LEVEL_CODE' },
          500,
        ),
      ),
    )

    await expect(getOwnedGame(GAME_ID)).rejects.toMatchObject({
      message: 'Top-level detail',
      serverCode: 'TOP_LEVEL_CODE',
    })
  })

  it('normalizes transport failures but preserves caller cancellation', async () => {
    const transportCause = new Error('network unavailable')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(transportCause))
    await expect(getCurrentGame()).rejects.toMatchObject({
      kind: 'transport',
      status: null,
      cause: transportCause,
    })

    const controller = new AbortController()
    controller.abort()
    const cancellation = new Error('cancelled by caller')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cancellation))
    await expect(
      getCurrentGame({ signal: controller.signal }),
    ).rejects.toBe(cancellation)
  })

  it('rejects malformed commands and paths synchronously', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(() =>
      divideProblem(42 as unknown as string),
    ).toThrow(/problem is required/i)
    expect(() => getOwnedGame(' ')).toThrow(/game id is required/i)
    expect(() =>
      recoverDivisionIntent('not-a-uuid'),
    ).toThrow(/division idempotency key is required/i)
    expect(() =>
      startGame(GAME_ID, { expectedRevision: 1.5 }),
    ).toThrow(/revision/i)
    expect(() =>
      submitMove(GAME_ID, {
        expectedRevision: 0,
        pieceId: ' ',
        to: { ring: 1, sector: 1 },
      }),
    ).toThrow(/piece id/i)
    expect(() =>
      submitMove(GAME_ID, {
        expectedRevision: 0,
        pieceId: 'white-pawn-1',
        to: undefined as unknown as { ring: number; sector: number },
      }),
    ).toThrow(/destination/i)
    expect(() =>
      submitMove(GAME_ID, {
        expectedRevision: 0,
        pieceId: 'white-pawn-1',
        to: { ring: 1.5, sector: 1 },
      }),
    ).toThrow(/destination/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when secure browser UUID generation is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => createIdempotencyKey()).toThrow(/secure idempotency keys/i)
  })

  it('exposes stable typed error identity and nullable defaults', () => {
    const error = new WebChessApiError('failure', { kind: 'http-error' })
    expect(error).toMatchObject({
      name: 'WebChessApiError',
      status: null,
      serverCode: null,
      retryAfterSeconds: null,
    })
    expect(isWebChessApiError(error)).toBe(true)
    expect(isWebChessApiError(new Error('other'))).toBe(false)
  })
})

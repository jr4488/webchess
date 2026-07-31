import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { composeProblemParts } from './division'
import { getLegalMoves } from './game'
import {
  acceptMoveCommand,
  createReplayState,
  toGameView,
} from './game-replay'
import {
  abandonGame,
  divideProblem,
  getCurrentGame,
  OPENCLAW_GAME_STORAGE_KEY,
  replayGame,
  requestGameAnswer,
  startGame,
  submitMove,
} from './openclaw-webchess-api'
import type { DurableGame } from './webchess-api'
import { makeDivisionAnalysis } from '../test/fixtures'

const GAME_ID = '018f47b2-4b0c-7b9e-8f24-123456789001'
const REPLAY_ID = '018f47b2-4b0c-7b9e-8f24-123456789002'
const PROBLEM =
  'How should I choose a reversible next step while the evidence is incomplete?'
const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, String(value))
    },
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function divisionFixture() {
  const analysis = makeDivisionAnalysis('openclaw/local-division')
  return {
    division: {
      facets: analysis.facets,
      model: 'provider/configured-model',
      parts: composeProblemParts(analysis.facets, analysis.seed),
      prompt: analysis.prompt,
      seed: analysis.seed,
    },
  }
}

function terminalGame(): DurableGame {
  const generated = divisionFixture().division
  let replay = createReplayState()

  while (!replay.outcome && replay.completedPlies < 256) {
    const piece = replay.pieces.find(
      (candidate) =>
        candidate.side === replay.turn &&
        getLegalMoves(candidate, replay.pieces).length > 0,
    )
    if (!piece) throw new Error('Expected a legal terminal-fixture move.')
    const to = getLegalMoves(piece, replay.pieces)[0]
    if (!to) throw new Error('Expected a terminal-fixture destination.')
    replay = acceptMoveCommand(
      replay,
      {
        expectedPly: replay.completedPlies + 1,
        pieceId: piece.id,
        to,
      },
      generated.parts,
    ).state
  }
  if (!replay.outcome) throw new Error('Expected a terminal local game.')

  return {
    id: GAME_ID,
    sourceGameId: null,
    revision: 9,
    status: 'completed',
    problem: PROBLEM,
    division: generated,
    state: toGameView(replay),
    answer: null,
  }
}

function mockReadyStatus(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(jsonResponse({
    available: true,
    model: 'provider/configured-model',
    transport: 'local',
    version: 'OpenClaw test',
  }))
}

describe('browser-local OpenClaw WebChess runtime', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    })
  })

  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  afterAll(() => {
    if (originalLocalStorage) {
      Object.defineProperty(window, 'localStorage', originalLocalStorage)
    }
  })

  it('uses only local routes and persists a canonically replayed game', async () => {
    const fixture = divisionFixture()
    const fetchMock = vi.fn()
    mockReadyStatus(fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(fixture, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCurrentGame()).resolves.toBeNull()
    const mapped = await divideProblem(PROBLEM, { idempotencyKey: GAME_ID })
    const playing = await startGame(mapped.id, {
      expectedRevision: mapped.revision,
    })
    const piece = playing.state?.pieces.find(
      (candidate) =>
        candidate.side === 'white' &&
        getLegalMoves(candidate, playing.state?.pieces ?? []).length > 0,
    )
    if (!piece || !playing.state) throw new Error('Expected a movable white piece.')
    const to = getLegalMoves(piece, playing.state.pieces)[0]
    if (!to) throw new Error('Expected a legal move.')

    const moved = await submitMove(playing.id, {
      expectedRevision: playing.revision,
      pieceId: piece.id,
      to,
    })

    expect(moved.revision).toBe(playing.revision + 1)
    expect(moved.state?.events).toHaveLength(1)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/openclaw/status',
      '/api/openclaw/divide',
    ])
    const divideBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as Record<string, unknown>
    expect(divideBody).toEqual({ problem: PROBLEM })
    expect(divideBody).not.toHaveProperty('apiKey')
    expect(divideBody).not.toHaveProperty('model')

    const persisted = JSON.parse(
      String(window.localStorage.getItem(OPENCLAW_GAME_STORAGE_KEY)),
    ) as DurableGame
    if (!persisted.state) throw new Error('Expected persisted state.')
    persisted.state.pieces = []
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(persisted),
    )

    const restored = await getCurrentGame()
    expect(restored?.state?.pieces).toHaveLength(moved.state?.pieces.length ?? 0)
    expect(restored?.state?.events).toEqual(moved.state?.events)
  })

  it('restores a saved game even when the configured provider is unavailable', async () => {
    const game = terminalGame()
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(game),
    )
    const fetchMock = vi.fn().mockRejectedValue(
      new Error('The provider is temporarily unavailable.'),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCurrentGame()).resolves.toMatchObject({
      id: game.id,
      revision: game.revision,
      status: game.status,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a saved cast that no longer matches its facets and seed', async () => {
    const game = terminalGame()
    if (!game.division) throw new Error('Expected a division.')
    game.division.parts = [...game.division.parts].reverse()
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(game),
    )
    const fetchMock = vi.fn()
    mockReadyStatus(fetchMock)
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCurrentGame()).rejects.toThrow(
      /no longer matches its facets and seed/u,
    )
  })

  it('sends only the verified cast source and event log for the final answer', async () => {
    const game = terminalGame()
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(game),
    )
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      answer: {
        answer: 'A bounded five-section answer.',
        model: 'provider/configured-model',
        prompt: 'Canonical prompt from the verified local replay.',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestGameAnswer(game.id, {
      expectedRevision: game.revision,
    })

    expect(result.game.status).toBe('answered')
    expect(result.answer.model).toBe('provider/configured-model')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    expect(body).toEqual({
      problem: game.problem,
      division: {
        seed: game.division?.seed,
        facets: game.division?.facets,
      },
      events: game.state?.events,
    })
    expect(body).not.toHaveProperty('parts')
    expect(body).not.toHaveProperty('pieces')
    expect(body).not.toHaveProperty('captures')
    expect(body).not.toHaveProperty('credentials')
  })

  it('does not let a late answer overwrite a replay created in another tab', async () => {
    const game = terminalGame()
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(game),
    )
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => response.promise))

    const answering = requestGameAnswer(game.id, {
      expectedRevision: game.revision,
    })
    const replayed = await replayGame(
      game.id,
      { expectedRevision: game.revision },
      { idempotencyKey: REPLAY_ID },
    )
    response.resolve(jsonResponse({
      answer: {
        answer: 'A late answer that must not replace the replay.',
        model: 'provider/configured-model',
        prompt: 'Verified answer prompt.',
      },
    }))

    await expect(answering).rejects.toThrow(/requested local game was not found/iu)
    expect(
      JSON.parse(
        String(window.localStorage.getItem(OPENCLAW_GAME_STORAGE_KEY)),
      ),
    ).toMatchObject({
      id: replayed.id,
      revision: replayed.revision,
      status: 'mapped',
    })
  })

  it('does not let a late answer failure overwrite a replay from another tab', async () => {
    const game = terminalGame()
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(game),
    )
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => response.promise))

    const answering = requestGameAnswer(game.id, {
      expectedRevision: game.revision,
    })
    const replayed = await replayGame(
      game.id,
      { expectedRevision: game.revision },
      { idempotencyKey: REPLAY_ID },
    )
    response.reject(new Error('The provider request failed late.'))

    await expect(answering).rejects.toThrow(/requested local game was not found/iu)
    expect(
      JSON.parse(
        String(window.localStorage.getItem(OPENCLAW_GAME_STORAGE_KEY)),
      ),
    ).toMatchObject({
      id: replayed.id,
      revision: replayed.revision,
      status: 'mapped',
    })
  })

  it('replays the same cast under a new id and clears the local save on reset', async () => {
    const game = terminalGame()
    window.localStorage.setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(game),
    )

    const replayed = await replayGame(
      game.id,
      { expectedRevision: game.revision },
      { idempotencyKey: REPLAY_ID },
    )
    expect(replayed).toMatchObject({
      id: REPLAY_ID,
      sourceGameId: GAME_ID,
      status: 'mapped',
      problem: PROBLEM,
    })
    expect(replayed.division).toEqual(game.division)
    expect(replayed.state?.events).toEqual([])

    const abandoned = await abandonGame(replayed.id, {
      expectedRevision: replayed.revision,
    })
    expect(abandoned.status).toBe('abandoned')
    expect(window.localStorage.getItem(OPENCLAW_GAME_STORAGE_KEY)).toBeNull()
  })

  it('shows a setup error when the user configured no usable OpenClaw model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({
        available: false,
        message: 'Private details must not be surfaced.',
        reason: 'not-configured',
        transport: 'local',
      })),
    )

    await expect(getCurrentGame()).rejects.toThrow(
      /configure a default model and authentication/iu,
    )
  })
})

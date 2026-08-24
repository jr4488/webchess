import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  abandonGame,
  createIdempotencyKey,
  divideProblem,
  getCurrentGame,
  getGameLifecycle,
  getOwnedGame,
  getWebMemory,
  isWebChessApiError,
  recoverDivisionIntent,
  replayGame,
  requestGameAnswer,
  startGame,
  submitMove,
  WebChessApiError,
} from './webchess-api'
import type { DurableGame } from './webchess-api'
import { RESEARCH_CONSENT_VERSION } from './research/contracts'

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000'
const IDEMPOTENCY_KEYS = [
  '018f47b2-4b0c-7b9e-8f24-123456789001',
  '018f47b2-4b0c-7b9e-8f24-123456789002',
  '018f47b2-4b0c-7b9e-8f24-123456789003',
  '018f47b2-4b0c-7b9e-8f24-123456789004',
  '018f47b2-4b0c-7b9e-8f24-123456789005',
] as const

const RESEARCH_CONSENT = {
  version: RESEARCH_CONSENT_VERSION,
  decision: 'allow_search_and_page_fetch',
  recordedAt: '2026-08-02T18:00:00.000Z',
} as const

const GAME: DurableGame = {
  id: GAME_ID,
  sourceGameId: null,
  revision: 4,
  status: 'playing',
  problem: 'How should this project move forward?',
  researchConsent: RESEARCH_CONSENT,
  division: null,
  state: null,
  answer: null,
}

const ANSWER = {
  answer: 'Proceed deliberately.',
  model: 'gpt-5.6-sol',
  prompt: 'Canonical answer prompt',
}

const MEMORY_ACTION = {
  id: 'a1000000-0000-4000-8000-000000000003',
  lifecycleRunId: 'a1000000-0000-4000-8000-000000000004',
  charlotteActionIndex: 0,
  charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
  actor: 'The accountable owner',
  action: 'Run one limited observation without expanding the scope.',
  testedAssumption: 'A reversible trial can produce a useful signal safely.',
  expectedObservation: 'A measurable signal appears inside the review horizon.',
  decisionThreshold: 'Continue only when the declared signal appears.',
  reviewHorizon: 'Within fourteen days',
  followUpAt: '2026-08-16T19:00:00.000Z',
  status: 'completed',
  revision: 2,
  version: 'webchess-wilbur-v1',
  createdAt: '2026-08-01T18:00:00.000Z',
  updatedAt: '2026-08-16T18:00:00.000Z',
}

const MEMORY_OBSERVATION = {
  id: 'a1000000-0000-4000-8000-000000000001',
  actionId: MEMORY_ACTION.id,
  observedAt: '2026-08-16T18:00:00.000Z',
  observation: 'The signal improved while participants retained an opt-out.',
  evidenceClassification: 'Measured result',
  expectedEffect: 'A measurable signal appears inside the review horizon.',
  unexpectedEffect: 'One participant needed a longer explanation.',
  stakeholderResponse: 'Participants retained agency and reported no lasting harm.',
  assumptionResult: 'supported',
  nextDecision: 'Repeat once with broader stakeholder review before scaling.',
  version: 'webchess-wilbur-v1',
  createdAt: '2026-08-16T18:05:00.000Z',
}

const MEMORY_EVIDENCE = {
  observationId: MEMORY_OBSERVATION.id,
  sourceGameId: 'a1000000-0000-4000-8000-000000000002',
  sourceActionId: MEMORY_ACTION.id,
  sourceProblem: 'How can a bounded trial generate useful direct evidence?',
  action: MEMORY_ACTION.action,
  testedAssumption: MEMORY_ACTION.testedAssumption,
  expectedObservation: MEMORY_ACTION.expectedObservation,
  observedAt: MEMORY_OBSERVATION.observedAt,
  observation: MEMORY_OBSERVATION.observation,
  evidenceClassification: MEMORY_OBSERVATION.evidenceClassification,
  expectedEffect: MEMORY_OBSERVATION.expectedEffect,
  unexpectedEffect: MEMORY_OBSERVATION.unexpectedEffect,
  stakeholderResponse: MEMORY_OBSERVATION.stakeholderResponse,
  assumptionResult: MEMORY_OBSERVATION.assumptionResult,
  nextDecision: MEMORY_OBSERVATION.nextDecision,
  selectionOrdinal: 0,
  consentVersion: 'webchess-web-memory-consent-v1',
  attachedAt: '2026-08-17T18:00:00.000Z',
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

const CHARLOTTE_UNAVAILABLE_LIFECYCLE = {
  id: '72000000-0000-4000-8000-000000000001',
  rootRunId: '72000000-0000-4000-8000-000000000001',
  parentRunId: null,
  gameId: GAME_ID,
  state: 'charlotte_unavailable',
  revision: 12,
  fieldGeneration: 1,
  gameAttempt: 1,
  sameFieldRetryCount: 0,
  fieldRegenerationCount: 0,
  divisionSeed: 'division-seed',
  castSeed: 'cast-seed',
  trajectorySeed: 'trajectory-seed',
  retryReason: null,
  terminalFingerprint: 'f'.repeat(64),
  answerPromptDigest: 'd'.repeat(64),
  answerUserPrompt: null,
  answerUserPromptSha256: null,
  survivors: [],
  portiaActiveModelRequestId: null,
  portiaFailedAttemptCount: 0,
  portiaFailureLimit: 3,
  portiaProgress: {
    currentCandidateId: null,
    completedCandidateIds: [],
    completedAssessments: [],
  },
  portia: null,
  gate: null,
  charlotteActiveModelRequestId: null,
  charlotteFailedAttemptCount: 3,
  charlotteFailureLimit: 3,
  charlotte: null,
  charlotteRenderedAnswer: null,
  wilburActions: [],
  wilburObservations: [],
  webMemoryEvidence: [],
  activities: [],
  research: [],
  versions: {},
  createdAt: '2026-08-02T18:00:00.000Z',
  updatedAt: '2026-08-02T18:03:00.000Z',
}

const COMPLETED_CODEX_RESEARCH = {
  id: '81000000-0000-4000-8000-000000000001',
  lifecycleRunId: CHARLOTTE_UNAVAILABLE_LIFECYCLE.id,
  gameId: GAME_ID,
  stage: 'portia',
  requestedBy: 'research-policy',
  consent: RESEARCH_CONSENT,
  policyVersion: 'webchess-visible-research-v1',
  materiality: 'required',
  reason: 'The candidate prompt depends on a current external benchmark.',
  query: 'official LLM inference latency benchmark 2026',
  status: 'completed',
  provider: 'codex',
  transport: 'local',
  model: 'gpt-5.4-search',
  bounds: {
    invocationLimit: 1,
    resultLimit: 5,
    sourceLimit: 3,
    timeoutMs: 30_000,
    synthesisCharacterLimit: 4_000,
  },
  attemptCount: 1,
  executedQueries: ['official LLM inference latency benchmark 2026'],
  searchSynthesis: 'Current sources distinguish prefill latency from decode throughput.',
  directPageTextFetched: false,
  retrievedFacts: [],
  fetchFailures: [],
  sources: [{
    id: '82000000-0000-4000-8000-000000000001',
    citationId: 'source-1',
    ordinal: 1,
    title: 'NIST AI measurement guidance',
    url: 'https://www.nist.gov/example',
    hostname: 'www.nist.gov',
    trust: 'government_or_education',
    discoveredFrom: 'search_activity',
    createdAt: '2026-08-02T18:02:00.000Z',
  }],
  omittedSourceCount: 0,
  injectionSignalsDetected: ['instruction-like phrase removed'],
  contentDigest: 'a'.repeat(64),
  failureCode: null,
  startedAt: '2026-08-02T18:01:30.000Z',
  completedAt: '2026-08-02T18:02:00.000Z',
  createdAt: '2026-08-02T18:01:30.000Z',
  updatedAt: '2026-08-02T18:02:00.000Z',
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

async function lifecycleFailure(lifecycle: unknown): Promise<unknown> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ lifecycle })),
  )
  return getGameLifecycle(GAME_ID).catch((error: unknown) => error)
}

describe('durable WebChess browser API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('creates a browser UUID and sends only the problem and explicit research choice when dividing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ game: GAME }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(
      divideProblem('What deserves attention now?', {
        researchConsentDecision: 'allow_search_and_page_fetch',
        signal: controller.signal,
      }),
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
      researchConsent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: 'allow_search_and_page_fetch',
      },
    })
    const headers = new Headers(requestInit(fetchMock, 0).headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(headers.get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('sends only explicitly selected Web memory observation ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ game: GAME }))
    vi.stubGlobal('fetch', fetchMock)
    const observationId = 'a1000000-0000-4000-8000-000000000001'

    await divideProblem('What deserves attention now?', {
      memoryObservationIds: [observationId],
      researchConsentDecision: 'no_external_research',
    })

    expect(requestBody(fetchMock, 0)).toEqual({
      problem: 'What deserves attention now?',
      memoryObservationIds: [observationId],
      researchConsent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: 'no_external_research',
      },
    })
  })

  it('loads the durable owner-scoped Web memory index', async () => {
    const memory = { cases: [], carriedObservationIds: [] }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ memory }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWebMemory()).resolves.toEqual(memory)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/web-memory')
    expect(requestInit(fetchMock, 0)).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
  })

  it('validates nested owner-scoped Web memory records before exposing them', async () => {
    const memory = {
      cases: [{
        gameId: MEMORY_EVIDENCE.sourceGameId,
        problem: MEMORY_EVIDENCE.sourceProblem,
        isCurrent: false,
        createdAt: '2026-08-01T18:00:00.000Z',
        updatedAt: '2026-08-16T18:05:00.000Z',
        actions: [{
          action: MEMORY_ACTION,
          observations: [MEMORY_OBSERVATION],
        }],
      }],
      carriedObservationIds: [MEMORY_OBSERVATION.id],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ memory })),
    )

    await expect(getWebMemory()).resolves.toEqual(memory)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({
        memory: {
          ...memory,
          cases: [{
            ...memory.cases[0],
            actions: [{
              action: MEMORY_ACTION,
              observations: [{
                ...MEMORY_OBSERVATION,
                actionId: 'a1000000-0000-4000-8000-000000000099',
              }],
            }],
          }],
        },
      })),
    )

    await expect(getWebMemory()).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'Web memory observations contain a duplicate or mismatched action.',
    })
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
              prompt: 'Safe corrective prompt.',
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
      prompt: 'Safe corrective prompt.',
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

  it('accepts Charlotte bounded-terminal metadata from the lifecycle API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ lifecycle: CHARLOTTE_UNAVAILABLE_LIFECYCLE }),
      ),
    )

    await expect(getGameLifecycle(GAME_ID)).resolves.toEqual(
      CHARLOTTE_UNAVAILABLE_LIFECYCLE,
    )
  })

  it('accepts deeply validated durable Wilbur and selected Web memory records', async () => {
    const action = {
      ...MEMORY_ACTION,
      id: 'b1000000-0000-4000-8000-000000000001',
      lifecycleRunId: CHARLOTTE_UNAVAILABLE_LIFECYCLE.id,
    }
    const observation = {
      ...MEMORY_OBSERVATION,
      id: 'b1000000-0000-4000-8000-000000000002',
      actionId: action.id,
    }
    const lifecycle = {
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      wilburActions: [action],
      wilburObservations: [observation],
      webMemoryEvidence: [MEMORY_EVIDENCE],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ lifecycle })),
    )

    await expect(getGameLifecycle(GAME_ID)).resolves.toEqual(lifecycle)
  })

  it.each([
    [
      'missing evidence array',
      { webMemoryEvidence: null },
      'Lifecycle webMemoryEvidence must be an array.',
    ],
    [
      'wrong consent version',
      { webMemoryEvidence: [{
        ...MEMORY_EVIDENCE,
        consentVersion: 'obsolete-consent',
      }] },
      'Web memory consent version is invalid.',
    ],
    [
      'detached evidence',
      { webMemoryEvidence: [{ ...MEMORY_EVIDENCE, attachedAt: null }] },
      'Lifecycle Web memory contains a current-game, detached, or duplicate observation.',
    ],
    [
      'current-game source',
      { webMemoryEvidence: [{ ...MEMORY_EVIDENCE, sourceGameId: GAME_ID }] },
      'Lifecycle Web memory contains a current-game, detached, or duplicate observation.',
    ],
    [
      'ordinal gap',
      { webMemoryEvidence: [{ ...MEMORY_EVIDENCE, selectionOrdinal: 1 }] },
      'Web memory selection order is invalid.',
    ],
  ])('rejects lifecycle Web memory with %s', async (_label, override, message) => {
    const failure = await lifecycleFailure({
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      ...override,
    })

    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message,
    })
  })

  it('accepts the exact player-visible Answer prompt with Gate provenance', async () => {
    const lifecycle = {
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      state: 'gate_passed',
      answerUserPrompt: '{\n  "reviewed_prompt": "exact approved input"\n}',
      answerUserPromptSha256: 'e'.repeat(64),
      gate: { passed: true },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ lifecycle })),
    )

    await expect(getGameLifecycle(GAME_ID)).resolves.toEqual(lifecycle)
  })

  it.each([
    [
      'missing digest',
      { answerUserPrompt: '{"approved":true}', answerUserPromptSha256: null, gate: { passed: true } },
      'Lifecycle player-visible answer prompt provenance is incomplete.',
    ],
    [
      'failed Gate',
      { answerUserPrompt: '{"approved":true}', answerUserPromptSha256: 'e'.repeat(64), gate: { passed: false } },
      'Lifecycle player-visible answer prompt was not authorized by the Gate.',
    ],
  ])('rejects player-visible prompt provenance with %s', async (_label, overrides, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({
        lifecycle: {
          ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
          ...overrides,
        },
      })),
    )

    await expect(getGameLifecycle(GAME_ID)).rejects.toMatchObject({
      kind: 'invalid-response',
      message,
    })
  })

  it('accepts a completed, bounded Codex research record from the lifecycle API', async () => {
    const lifecycle = {
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      research: [COMPLETED_CODEX_RESEARCH],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ lifecycle })),
    )

    const parsed = await getGameLifecycle(GAME_ID)

    expect(parsed.research).toEqual([COMPLETED_CODEX_RESEARCH])
    expect(parsed.research[0]).toMatchObject({
      status: 'completed',
      provider: 'codex',
      model: 'gpt-5.4-search',
      directPageTextFetched: false,
      retrievedFacts: [],
      fetchFailures: [],
    })
  })

  it('reconstructs separately attributed direct-page evidence without unknown fields', async () => {
    const acceptedText = 'The retrieved page distinguishes prefill latency from throughput. 🕸️'
    const acceptedTextDigest = '2b360d59b7ef78fe6933c1ec77e9441664b0420f39463aff7e6d2a35664ad466'
    const secondSource = {
      ...COMPLETED_CODEX_RESEARCH.sources[0],
      id: '82000000-0000-4000-8000-000000000002',
      citationId: 'source-2',
      ordinal: 2,
      title: 'NIST measurement appendix',
      url: 'https://www.nist.gov/appendix',
      unknownSourceField: 'must not survive',
    }
    const directResearch = {
      ...COMPLETED_CODEX_RESEARCH,
      unknownResearchField: 'must not survive',
      consent: {
        ...COMPLETED_CODEX_RESEARCH.consent,
        unknownConsentField: 'must not survive',
      },
      bounds: {
        ...COMPLETED_CODEX_RESEARCH.bounds,
        unknownBoundsField: 'must not survive',
      },
      directPageTextFetched: true,
      retrievedFacts: [{
        citationId: 'source-1',
        requestedUrl: 'https://www.nist.gov/example',
        finalUrl: 'https://www.nist.gov/example',
        title: 'NIST AI measurement guidance',
        provider: 'webchess-direct-https',
        fetchVersion: 'webchess-direct-page-fetch-v1',
        retrievedAt: '2026-08-02T18:01:45.000Z',
        httpStatus: 200,
        contentType: 'text/html',
        extractor: 'webchess-readable-text-v1',
        rawByteLength: 900,
        rawContentDigest: 'b'.repeat(64),
        rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
        acceptedCharacterLength: acceptedText.length,
        contentDigest: acceptedTextDigest,
        digestAlgorithm: 'sha256-utf8-accepted-text-v1',
        redirectChain: ['https://www.nist.gov/example'],
        text: acceptedText,
        truncated: false,
        untrusted: true,
        contentKind: 'direct_page_text',
        unknownFactField: 'must not survive',
      }],
      fetchFailures: [{
        citationId: 'source-2',
        requestedUrl: 'https://www.nist.gov/appendix',
        finalUrl: null,
        status: 'timed_out',
        failureCode: 'page_timeout',
        httpStatus: null,
        fetchVersion: 'webchess-direct-page-fetch-v1',
        extractor: 'webchess-readable-text-v1',
        rawByteLength: 0,
        rawContentDigest: null,
        rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
        acceptedCharacterLength: 0,
        truncated: false,
        contentDigest: null,
        digestAlgorithm: 'sha256-utf8-accepted-text-v1',
        redirectChain: ['https://www.nist.gov/appendix'],
        injectionSignalsDetected: [],
        retrievedAt: '2026-08-02T18:02:00.000Z',
        unknownFailureField: 'must not survive',
      }],
      sources: [{
        ...COMPLETED_CODEX_RESEARCH.sources[0],
        unknownSourceField: 'must not survive',
      }, secondSource],
    }
    const lifecycle = {
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      research: [directResearch],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ lifecycle })),
    )

    const parsed = await getGameLifecycle(GAME_ID)

    expect(parsed.research[0]).toMatchObject({
      directPageTextFetched: true,
      retrievedFacts: [{
        provider: 'webchess-direct-https',
        text: acceptedText,
        contentDigest: acceptedTextDigest,
      }],
      fetchFailures: [{
        citationId: 'source-2',
        status: 'timed_out',
        failureCode: 'page_timeout',
      }],
    })
    expect(parsed.research[0]).not.toHaveProperty('unknownResearchField')
    expect(parsed.research[0].consent).not.toHaveProperty('unknownConsentField')
    expect(parsed.research[0].bounds).not.toHaveProperty('unknownBoundsField')
    expect(parsed.research[0].retrievedFacts[0]).not.toHaveProperty('unknownFactField')
    expect(parsed.research[0].fetchFailures[0]).not.toHaveProperty('unknownFailureField')
    expect(parsed.research[0].sources[0]).not.toHaveProperty('unknownSourceField')
    expect(parsed.research[0].sources[1]).not.toHaveProperty('unknownSourceField')

    const failure = await lifecycleFailure({
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      research: [{
        ...directResearch,
        retrievedFacts: [{
          ...directResearch.retrievedFacts[0],
          contentDigest: '0'.repeat(64),
        }],
      }],
    })
    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message: 'Research direct-page fact is invalid.',
    })

    const missingFinalUrlFailure = await lifecycleFailure({
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      research: [{
        ...directResearch,
        retrievedFacts: [{
          ...directResearch.retrievedFacts[0],
          finalUrl: null,
        }],
      }],
    })
    expect(missingFinalUrlFailure).toMatchObject({
      kind: 'invalid-response',
      message: 'Research direct-page fact is invalid.',
    })
  })

  it.each([
    [
      'status',
      { status: 'background_hidden' },
      'Lifecycle research stage or status is invalid.',
    ],
    [
      'provider',
      { provider: 'openai' },
      'Lifecycle research attribution is invalid.',
    ],
    [
      'unsafe source URL',
      {
        sources: [{
          ...COMPLETED_CODEX_RESEARCH.sources[0],
          url: 'http://127.0.0.1/private',
          hostname: '127.0.0.1',
        }],
      },
      'Lifecycle research source is unsafe or repeated.',
    ],
    [
      'invented retrieved facts',
      { retrievedFacts: ['This was not directly fetched.'] },
      'Lifecycle research evidence labels are invalid.',
    ],
  ])('rejects malformed research %s', async (_label, override, message) => {
    const failure = await lifecycleFailure({
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      research: [{ ...COMPLETED_CODEX_RESEARCH, ...override }],
    })

    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message,
    })
  })

  it.each([
    [
      'active request id',
      { charlotteActiveModelRequestId: 'not-a-uuid' },
      'Lifecycle active Charlotte request id is invalid.',
    ],
    [
      'negative failure count',
      { charlotteFailedAttemptCount: -1 },
      'Charlotte failed attempt count must be a non-negative integer.',
    ],
    [
      'zero failure limit',
      { charlotteFailureLimit: 0 },
      'Charlotte failure budget is invalid.',
    ],
    [
      'overspent failure budget',
      { charlotteFailedAttemptCount: 4 },
      'Charlotte failure budget is invalid.',
    ],
  ])('rejects invalid Charlotte %s metadata', async (_label, override, message) => {
    const failure = await lifecycleFailure({
      ...CHARLOTTE_UNAVAILABLE_LIFECYCLE,
      ...override,
    })

    expect(failure).toMatchObject({
      kind: 'invalid-response',
      message,
    })
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
      divideProblem(42 as unknown as string, {
        researchConsentDecision: 'no_external_research',
      }),
    ).toThrow(/problem is required/i)
    expect(() =>
      divideProblem('A sufficiently detailed problem', {
        researchConsentDecision: 'invalid' as 'no_external_research',
      }),
    ).toThrow(/choose whether/i)
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

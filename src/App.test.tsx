import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { AutoPlayEngine, EngineResult } from './lib/auto-play'
import { CURRENT_GAME_VERSIONS } from './lib/game-contract'
import type { ReplayState } from './lib/game-contract'
import { acceptMoveCommand, createReplayState, toGameView } from './lib/game-replay'
import type { EngineOptions } from './lib/engine'
import { composeProblemParts } from './lib/division'
import { WebChessApiError } from './lib/webchess-api'
import { PORTIA_ATTACK_TYPES } from './lib/lifecycle/contracts'
import type {
  LifecycleAggregate,
  WilburAction,
  WilburObservation,
} from './lib/lifecycle/contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from './lib/lifecycle/versions'
import type { ResearchRecord } from './lib/research'
import type {
  DurableGame,
  DurableGameStatus,
  AppendWilburObservationCommand,
  CreateWilburActionCommand,
  MoveGameCommand,
  RevisionCommand,
  UpdateWilburActionCommand,
} from './lib/webchess-api'
import { makeDivisionAnalysis } from './test/fixtures'
import type { CellCoord, GeneratedAnswer, Piece, Side } from './types'

interface DeferredEngineRequest {
  pieces: readonly Piece[]
  side: Side
  seed: string | number
  options: EngineOptions | undefined
  resolve: (result: EngineResult) => void
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

const engineHarness = vi.hoisted(() => ({
  deferred: false,
  pending: [] as DeferredEngineRequest[],
  chooseMove: vi.fn<AutoPlayEngine['chooseMove']>(),
  reset: vi.fn<AutoPlayEngine['reset']>(),
  dispose: vi.fn<AutoPlayEngine['dispose']>(),
}))

const apiHarness = vi.hoisted(() => ({
  abandonGame: vi.fn(),
  appendWilburObservation: vi.fn(),
  createWilburAction: vi.fn(),
  createIdempotencyKey: vi.fn(() => '018f47b2-4b0c-7b9e-8f24-123456789000'),
  divideProblem: vi.fn(),
  getCurrentGame: vi.fn(),
  getGameLifecycle: vi.fn(),
  getOwnedGame: vi.fn(),
  recoverDivisionIntent: vi.fn(),
  replayGame: vi.fn(),
  requestGameAnswer: vi.fn(),
  runCharlotte: vi.fn(),
  runPortia: vi.fn(),
  startGame: vi.fn(),
  submitMove: vi.fn(),
  updateWilburAction: vi.fn(),
}))

/**
 * App-level tests exercise the real Engine V2 move selector at depth one. The
 * engine's strength and worker protocol have their own suites; this harness
 * adds controllable deferred results for cancellation and stale-result tests.
 */
vi.mock('./lib/auto-play', async () => {
  const { findBestMove } = await import('./lib/engine')

  engineHarness.chooseMove.mockImplementation((pieces, side, seed, options) => {
    if (engineHarness.deferred) {
      return new Promise<EngineResult>((resolve) => {
        engineHarness.pending.push({ pieces, side, seed, options, resolve })
      })
    }

    return Promise.resolve({
      status: 'ok',
      move: findBestMove(pieces, side, seed, { ...(options ?? {}), depth: 1 }),
    })
  })

  return {
    createAutoPlayEngine: () => ({
      chooseMove: engineHarness.chooseMove,
      reset: engineHarness.reset,
      dispose: engineHarness.dispose,
    }),
  }
})

vi.mock('./lib/webchess-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/webchess-api')>()
  return {
    ...actual,
    abandonGame: apiHarness.abandonGame,
    appendWilburObservation: apiHarness.appendWilburObservation,
    createWilburAction: apiHarness.createWilburAction,
    createIdempotencyKey: apiHarness.createIdempotencyKey,
    divideProblem: apiHarness.divideProblem,
    getCurrentGame: apiHarness.getCurrentGame,
    getGameLifecycle: apiHarness.getGameLifecycle,
    getOwnedGame: apiHarness.getOwnedGame,
    recoverDivisionIntent: apiHarness.recoverDivisionIntent,
    replayGame: apiHarness.replayGame,
    requestGameAnswer: apiHarness.requestGameAnswer,
    runCharlotte: apiHarness.runCharlotte,
    runPortia: apiHarness.runPortia,
    startGame: apiHarness.startGame,
    submitMove: apiHarness.submitMove,
    updateWilburAction: apiHarness.updateWilburAction,
  }
})

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000'
const REPLAY_GAME_ID = '123e4567-e89b-42d3-a456-426614174001'
const WILBUR_ACTION_ID = '83000000-0000-4000-8000-000000000001'
const WILBUR_OBSERVATION_ID = '84000000-0000-4000-8000-000000000001'
const PROBLEM = 'How should this position move toward a useful next step?'
const ANSWER: GeneratedAnswer = {
  answer: 'Protect the purpose, then test the smallest reversible next step.',
  model: 'gpt-5.6-sol',
  prompt: 'Canonical answer prompt made from the server-verified replay.',
}

const AMBIGUOUS_WILBUR_FAILURES = [
  [
    'a transport failure',
    (message: string) => new WebChessApiError(message, { kind: 'transport' }),
  ],
  [
    'an HTTP 503 response',
    (message: string) => new WebChessApiError(message, {
      kind: 'http-error',
      status: 503,
    }),
  ],
  [
    'a malformed 2xx response',
    (message: string) => new WebChessApiError(message, {
      kind: 'invalid-response',
    }),
  ],
] as const

let serverGame: DurableGame | null

function makeMappedGame(
  problem = PROBLEM,
  id = GAME_ID,
  sourceGameId: string | null = null,
): DurableGame {
  const analysis = makeDivisionAnalysis(`division/${id}`)
  return {
    id,
    sourceGameId,
    revision: 1,
    status: 'mapped',
    problem,
    division: {
      seed: analysis.seed,
      facets: analysis.facets,
      parts: composeProblemParts(analysis.facets, String(analysis.seed)),
      model: analysis.model,
      prompt: analysis.prompt,
    },
    state: toGameView(createReplayState()),
    answer: null,
  }
}

function makePlayingGame(problem = PROBLEM): DurableGame {
  return {
    ...makeMappedGame(problem),
    revision: 2,
    status: 'playing',
  }
}

function makeDividingGame(): DurableGame {
  return {
    id: GAME_ID,
    sourceGameId: null,
    revision: 0,
    status: 'dividing',
    problem: PROBLEM,
    division: null,
    state: null,
    answer: null,
  }
}

function moveGame(
  game: DurableGame,
  pieceId: string,
  to: CellCoord,
): DurableGame {
  if (!game.state || !game.division) {
    throw new Error('A mapped game is required.')
  }

  const accepted = acceptMoveCommand(
    game.state,
    {
      expectedPly: game.state.completedPlies + 1,
      pieceId,
      to,
    },
    game.division.parts,
  )
  const status: DurableGameStatus = accepted.state.outcome ? 'completed' : 'playing'
  return {
    ...game,
    revision: game.revision + 1,
    status,
    state: toGameView(accepted.state),
  }
}

function terminalReadyState(): ReplayState {
  const pieces: Piece[] = [
    {
      id: 'white-king-1',
      side: 'white',
      kind: 'king',
      position: { ring: 7, sector: 0 },
      moved: false,
    },
    {
      id: 'white-rook-1',
      side: 'white',
      kind: 'rook',
      position: { ring: 1, sector: 4 },
      moved: true,
    },
    {
      id: 'black-king-1',
      side: 'black',
      kind: 'king',
      position: { ring: 0, sector: 4 },
      moved: false,
    },
  ]

  return {
    versions: CURRENT_GAME_VERSIONS,
    pieces,
    turn: 'white',
    completedPlies: 0,
    quietPlies: 0,
    events: [],
    captures: [],
    lastMove: null,
    outcome: null,
  }
}

function makeTerminalReadyGame(): DurableGame {
  return {
    ...makePlayingGame(),
    revision: 11,
    state: toGameView(terminalReadyState()),
  }
}

function makeAnsweredGame(): DurableGame {
  const completed = moveGame(
    makeTerminalReadyGame(),
    'white-rook-1',
    { ring: 0, sector: 4 },
  )
  return {
    ...completed,
    revision: completed.revision + 1,
    status: 'answered',
    answer: ANSWER,
  }
}

function makeAnswerFailedGame(): DurableGame {
  const completed = moveGame(
    makeTerminalReadyGame(),
    'white-rook-1',
    { ring: 0, sector: 4 },
  )
  return {
    ...completed,
    status: 'answer_failed',
    answer: null,
  }
}

function makeResearchRecord(
  status: 'searching' | 'completed',
  overrides: Partial<ResearchRecord> = {},
): ResearchRecord {
  return {
    id: '81000000-0000-4000-8000-000000000001',
    lifecycleRunId: '72000000-0000-4000-8000-000000000001',
    gameId: GAME_ID,
    stage: 'portia',
    requestedBy: 'research-policy',
    policyVersion: 'webchess-visible-research-v1',
    materiality: 'required',
    reason: 'The candidate prompt depends on a current external benchmark.',
    query: 'official LLM inference latency benchmark 2026',
    status,
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
    sources: [],
    omittedSourceCount: 0,
    injectionSignalsDetected: [],
    contentDigest: 'a'.repeat(64),
    failureCode: null,
    startedAt: '2026-08-02T18:01:30.000Z',
    completedAt: status === 'completed' ? '2026-08-02T18:02:00.000Z' : null,
    createdAt: '2026-08-02T18:01:30.000Z',
    updatedAt: status === 'completed'
      ? '2026-08-02T18:02:00.000Z'
      : '2026-08-02T18:01:30.000Z',
    ...overrides,
  }
}

function makeLifecycle(
  state: LifecycleAggregate['state'],
  options: {
    portia?: boolean
    gate?: boolean
    gatePassed?: boolean
    gateRecommendation?: 'answer' | 'retry_game' | 'retry_field' | 'insufficient_basis'
    charlotte?: boolean
    sameFieldRetryCount?: number
    fieldRegenerationCount?: number
  } = {},
): LifecycleAggregate {
  const candidateId = 'attempt-1:white-rook-1'
  const answerPromptDigest = 'd'.repeat(64)
  const portia = options.portia ? {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    reviewedAnswerPromptDigest: answerPromptDigest,
    promptDecision: 'permit',
    promptDecisionRationale:
      'The exact weighted board prompt is reasonable with the retained qualification.',
    runSummary: 'Portia tested every survivor and retained the bounded interpretation.',
    assessments: [{
      candidateId,
      disposition: 'preserved',
      survivingInterpretation: 'The protected outcome remains a useful constraint.',
      requiredQualification: null,
      redundancyClusterId: null,
      coverageTags: ['protected_outcome'],
      missingEvidence: ['A direct observation is still required.'],
      countercase: 'A contradictory observation would reverse the interpretation.',
      reversalCondition: 'Reverse if the declared observation contradicts it.',
      attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
        attackType,
        outcome: 'passed',
        severity: 'low',
        finding: `The ${attackType} check found no material defect in this signal.`,
        consequence: 'The signal may remain in the qualified candidate prompt.',
        requiredRevision: null,
      })),
    }],
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: ['What direct observation should come next?'],
    recommendedGateInputs: {
      tensionCandidatePairs: [],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  } : null
  const charlotte = options.charlotte ? {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    protectedOutcome: 'Protect the purpose while learning safely.',
    directAnswer: 'Run a bounded test before making the larger commitment.',
    supportingCandidateIds: [candidateId],
    qualificationsByCandidateId: {},
    centralTension: 'Learn promptly without exposing affected people to avoidable downside.',
    valueConstraints: ['Keep a stop path.'],
    stakeholderConsequences: ['The accountable player owns the test.'],
    recommendation: 'Run the smallest reversible experiment and decide from the observation.',
    communicationStrategy: 'State the assumption, signal, and stopping rule.',
    uncertainties: ['The observation is not yet known.'],
    whatCouldChangeTheAnswer: ['A contradictory observation.'],
    exactlyThreeNextActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Action ${index + 1}`,
      actor: 'The accountable player',
      assumptionBeingTested: 'A bounded action can produce useful evidence.',
      smallestAction: 'Run one limited observation without scaling.',
      expectedObservation: 'A direct signal appears inside the review horizon.',
      decisionThreshold: 'Continue only if the signal appears safely.',
      reviewHorizon: 'Within fourteen days',
      reversibility: 'Stop and restore the prior state.',
      risksOrAffectedParties: 'Stop if the protected outcome is threatened.',
      decisionRule: 'revise' as const,
    })),
  } : null
  return {
    id: '72000000-0000-4000-8000-000000000001',
    rootRunId: '72000000-0000-4000-8000-000000000001',
    parentRunId: null,
    gameId: GAME_ID,
    state,
    revision: 4,
    fieldGeneration: 1,
    gameAttempt: 1,
    sameFieldRetryCount: options.sameFieldRetryCount ?? 0,
    fieldRegenerationCount: options.fieldRegenerationCount ?? 0,
    divisionSeed: 'division-seed',
    castSeed: 'cast-seed',
    trajectorySeed: 'trajectory-seed',
    retryReason: null,
    terminalFingerprint: 'f'.repeat(64),
    answerPromptDigest: options.portia ? answerPromptDigest : null,
    answerUserPrompt: null,
    answerUserPromptSha256: null,
    survivors: [{
      candidateId,
      finalCoordinate: { ring: 0, sector: 4 },
    }],
    portiaAttemptCount: options.portia ? 1 : 0,
    portiaActiveModelRequestId: null,
    portiaFailedAttemptCount: 0,
    portiaFailureLimit: 3,
    portiaProgress: {
      currentCandidateId: null,
      completedCandidateIds: options.portia ? [candidateId] : [],
      completedAssessments: portia?.assessments ?? [],
    },
    portia,
    gate: options.gate ? {
      passed: options.gatePassed ?? true,
      usableCandidateCount: options.gatePassed === false ? 3 : 4,
      independentClusterCount: options.gatePassed === false ? 2 : 4,
      contradictionResults: { fatalUnaddressedIds: [], tensionCandidatePairs: [] },
      missingRequirements: options.gatePassed === false
        ? [
            'At least 4 preserved or wounded candidates are required.',
            'At least 3 independent candidate clusters are required.',
          ]
        : [],
      recommendedNextTransition: options.gateRecommendation ?? 'answer',
      explanation: options.gatePassed === false
        ? 'The Gate failed 2 sufficiency requirements; the bounded retry policy is exhausted.'
        : 'The deterministic evidence floor is met.',
    } : null,
    charlotteActiveModelRequestId: null,
    charlotteFailedAttemptCount: 0,
    charlotteFailureLimit: 3,
    charlotte,
    charlotteRenderedAnswer: options.charlotte
      ? 'Protect the purpose, run the smallest reversible test, and decide from the observation.'
      : null,
    wilburActions: [],
    wilburObservations: [],
    activities: [],
    research: [],
    versions: {},
    createdAt: '2026-08-01T20:00:00.000Z',
    updatedAt: '2026-08-01T20:00:00.000Z',
  } as unknown as LifecycleAggregate
}

function makeWilburAction(
  lifecycle: LifecycleAggregate,
  index = 0,
  overrides: Partial<WilburAction> = {},
): WilburAction {
  const suggestion = lifecycle.charlotte?.exactlyThreeNextActions[index]
  if (!suggestion) throw new Error('The Wilbur fixture requires a Charlotte action.')
  return {
    id: WILBUR_ACTION_ID,
    lifecycleRunId: lifecycle.id,
    charlotteActionIndex: index,
    charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
    actor: suggestion.actor,
    action: suggestion.smallestAction,
    testedAssumption: suggestion.assumptionBeingTested,
    expectedObservation: suggestion.expectedObservation,
    decisionThreshold: suggestion.decisionThreshold,
    reviewHorizon: suggestion.reviewHorizon,
    status: 'planned',
    revision: 0,
    version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    createdAt: '2026-08-15T16:00:00.000Z',
    updatedAt: '2026-08-15T16:00:00.000Z',
    ...overrides,
    followUpAt: overrides.followUpAt ?? null,
  }
}

function makeWilburObservation(
  actionId: string,
  command: AppendWilburObservationCommand,
): WilburObservation {
  return {
    id: WILBUR_OBSERVATION_ID,
    actionId,
    ...command,
    version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    createdAt: '2026-08-15T16:05:00.000Z',
  }
}

function requireServerGame(): DurableGame {
  if (!serverGame) throw new Error('The mock server has no current game.')
  return serverGame
}

function assertRevision(command: RevisionCommand, game: DurableGame): void {
  if (command.expectedRevision !== game.revision) {
    throw new Error(
      `Stale mock request: expected revision ${game.revision}, received ${command.expectedRevision}.`,
    )
  }
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderRestoredApp(): Promise<ReturnType<typeof render>> {
  const previousRestoreCalls = apiHarness.getCurrentGame.mock.calls.length
  const previousLifecycleCalls = apiHarness.getGameLifecycle.mock.calls.length
  const result = render(<App />)
  await waitFor(() => {
    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(previousRestoreCalls + 1)
  })
  await flushAsyncWork()
  if (
    serverGame &&
    ['completed', 'answering', 'answer_failed', 'answered'].includes(serverGame.status)
  ) {
    await waitFor(() => {
      expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(
        previousLifecycleCalls + 1,
      )
    })
    await flushAsyncWork()
  }
  return result
}

async function submitProblem(problem = PROBLEM): Promise<void> {
  fireEvent.change(screen.getByLabelText(/what are you trying to understand/i), {
    target: { value: problem },
  })
  fireEvent.click(screen.getByRole('button', { name: /divide the problem/i }))
  await flushAsyncWork()
}

async function finishMapping(): Promise<void> {
  for (let phase = 0; phase < 5; phase += 1) {
    await act(() => vi.advanceTimersByTimeAsync(850))
  }
  await act(() => vi.advanceTimersByTimeAsync(6_500))
}

beforeEach(() => {
  serverGame = null
  engineHarness.deferred = false
  engineHarness.pending.splice(0)
  engineHarness.chooseMove.mockClear()
  engineHarness.reset.mockClear()
  engineHarness.dispose.mockClear()

  for (const mock of Object.values(apiHarness)) mock.mockClear()

  apiHarness.getCurrentGame.mockImplementation(async () => serverGame)
  apiHarness.getGameLifecycle.mockRejectedValue(
    new WebChessApiError('This saved game predates the v2 lifecycle.', {
      kind: 'not-found',
      status: 404,
    }),
  )
  apiHarness.getOwnedGame.mockImplementation(async (gameId: string) => {
    if (serverGame?.id === gameId) return serverGame
    throw new WebChessApiError('That saved game was not found.', {
      kind: 'not-found',
      status: 404,
    })
  })
  apiHarness.recoverDivisionIntent.mockImplementation(async () => {
    if (serverGame) return serverGame
    throw new WebChessApiError('That saved game was not found.', {
      kind: 'not-found',
      status: 404,
    })
  })
  apiHarness.divideProblem.mockImplementation(async (problem: string) => {
    serverGame = makeMappedGame(problem)
    return serverGame
  })
  apiHarness.startGame.mockImplementation(
    async (_gameId: string, command: RevisionCommand) => {
      const current = requireServerGame()
      assertRevision(command, current)
      serverGame = {
        ...current,
        revision: current.revision + 1,
        status: 'playing',
      }
      return serverGame
    },
  )
  apiHarness.submitMove.mockImplementation(
    async (_gameId: string, command: MoveGameCommand) => {
      const current = requireServerGame()
      assertRevision(command, current)
      serverGame = moveGame(current, command.pieceId, command.to)
      return serverGame
    },
  )
  apiHarness.requestGameAnswer.mockImplementation(
    async (_gameId: string, command: RevisionCommand) => {
      const current = requireServerGame()
      assertRevision(command, current)
      serverGame = {
        ...current,
        revision: current.revision + 1,
        status: 'answered',
        answer: ANSWER,
      }
      return { game: serverGame, answer: ANSWER }
    },
  )
  apiHarness.replayGame.mockImplementation(
    async (_gameId: string, command: RevisionCommand) => {
      const current = requireServerGame()
      assertRevision(command, current)
      serverGame = {
        ...makeMappedGame(current.problem, REPLAY_GAME_ID, current.id),
        revision: 0,
      }
      return serverGame
    },
  )
  apiHarness.abandonGame.mockImplementation(
    async (_gameId: string, command: RevisionCommand) => {
      const current = requireServerGame()
      assertRevision(command, current)
      serverGame = {
        ...current,
        revision: current.revision + 1,
        status: 'abandoned',
      }
      return serverGame
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('durable WebChess client flow', () => {
  it('shows a restore failure and retries the durable replay on demand', async () => {
    serverGame = makeMappedGame()
    apiHarness.getCurrentGame.mockRejectedValueOnce(
      new Error('The saved game store is temporarily unavailable.'),
    )

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /saved game store is temporarily unavailable/i,
    )
    fireEvent.click(screen.getByRole('button', { name: /restore again/i }))

    await waitFor(() => {
      expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('restores the current mapped game without repeating semantic division', async () => {
    serverGame = makeMappedGame()

    await renderRestoredApp()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledOnce()
    expect(apiHarness.divideProblem).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
    expect(screen.getAllByText(/sol facet/i).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/what are you trying to understand/i)).not.toBeInTheDocument()
  })

  it('restores the same authoritative move DTO after a browser remount', async () => {
    serverGame = moveGame(
      makePlayingGame(),
      'white-pawn-4',
      { ring: 4, sector: 3 },
    )
    const savedDto = serverGame

    const firstMount = await renderRestoredApp()
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 02')
    expect(screen.getAllByText(/saved at move 1\. black moves next/i)).toHaveLength(2)

    firstMount.unmount()
    await renderRestoredApp()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(2)
    await expect(apiHarness.getCurrentGame.mock.results[1]?.value).resolves.toBe(savedDto)
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 02')
    expect(screen.getAllByText(/saved at move 1\. black moves next/i)).toHaveLength(2)
    expect(apiHarness.startGame).not.toHaveBeenCalled()
    expect(apiHarness.submitMove).not.toHaveBeenCalled()
  })

  it('restores the original question above a completed game outcome and answer', async () => {
    serverGame = makeAnsweredGame()

    const { container } = await renderRestoredApp()
    const question = container.querySelector('.reading-question')
    const outcomeBanner = container.querySelector('.outcome-banner')
    const answerCard = container.querySelector('.ai-answer-card')

    expect(question).toHaveTextContent(PROBLEM)
    expect(question?.compareDocumentPosition(outcomeBanner as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(question?.compareDocumentPosition(answerCard as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('keeps polling a restored division across unchanged and transient responses', async () => {
    vi.useFakeTimers()
    const dividing = makeDividingGame()
    const mapped = makeMappedGame()
    apiHarness.getCurrentGame
      .mockResolvedValueOnce(dividing)
      .mockResolvedValueOnce({ ...dividing })
      .mockRejectedValueOnce(new Error('The saved game store briefly disconnected.'))
      .mockResolvedValue(mapped)

    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()

    expect(screen.getAllByText(/model analyzing 64 candidate facets/i).length).toBeGreaterThan(0)
    expect(apiHarness.getCurrentGame).toHaveBeenCalledOnce()

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText(/model analyzing 64 candidate facets/i).length).toBeGreaterThan(0)

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('alert')).toHaveTextContent(/briefly disconnected/i)

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(4)
    expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('polls a restored in-progress answer until the durable result is ready', async () => {
    vi.useFakeTimers()
    const answered = makeAnsweredGame()
    const answering: DurableGame = {
      ...answered,
      revision: answered.revision - 1,
      status: 'answering',
      answer: null,
    }
    apiHarness.getCurrentGame
      .mockResolvedValueOnce(answering)
      .mockRejectedValueOnce(new Error('The saved game store briefly disconnected.'))
      .mockResolvedValue(answered)

    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledOnce()
    expect(
      screen.getAllByRole('status').some((element) =>
        /final answer is being composed/i.test(element.textContent ?? ''),
      ),
    ).toBe(true)
    expect(screen.getByRole('button', { name: /new question/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /replay this board/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /bring another problem/i })).toBeDisabled()

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(2)
    expect(screen.getByText('00:01')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/briefly disconnected/i)

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(3)
    expect(screen.getByText(ANSWER.answer)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('gives a foreground answer restore priority over the next silent poll', async () => {
    vi.useFakeTimers()
    const answered = makeAnsweredGame()
    const answering: DurableGame = {
      ...answered,
      revision: answered.revision - 1,
      status: 'answering',
      answer: null,
    }
    const foregroundRestore = createDeferred<DurableGame | null>()
    apiHarness.getCurrentGame
      .mockResolvedValueOnce(answering)
      .mockRejectedValueOnce(
        new Error('The saved game store briefly disconnected.'),
      )
      .mockImplementationOnce(() => foregroundRestore.promise)
      .mockResolvedValue(answered)

    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()
    expect(screen.getByRole('alert')).toHaveTextContent(/briefly disconnected/i)

    fireEvent.click(screen.getByRole('button', { name: /restore again/i }))
    await flushAsyncWork()
    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(3)
    const foregroundSignal = (
      apiHarness.getCurrentGame.mock.calls[2]?.[0] as {
        signal: AbortSignal
      }
    ).signal
    expect(
      screen.getByText(/replaying the durable move log/i),
    ).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(3)
    expect(foregroundSignal.aborted).toBe(false)

    await act(async () => {
      foregroundRestore.resolve(answered)
    })
    await flushAsyncWork()

    expect(screen.getByText(ANSWER.answer)).toBeInTheDocument()
    expect(screen.queryByLabelText(/restoring saved game/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('divides into 64 mapped facets and starts only by game id and revision', async () => {
    await renderRestoredApp()
    vi.useFakeTimers()

    await submitProblem()

    expect(apiHarness.divideProblem).toHaveBeenCalledWith(
      PROBLEM,
      expect.objectContaining({
        idempotencyKey: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(screen.getAllByText(/64 model facets received/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/gpt-5\.6-sol · OpenAI API · semantic division/i)).toBeInTheDocument()

    await finishMapping()

    expect(screen.getByRole('progressbar', { name: /facets cast onto the board/i })).toHaveAttribute(
      'aria-valuenow',
      '64',
    )
    fireEvent.click(screen.getByRole('button', { name: /set the pieces in motion/i }))
    await flushAsyncWork()

    expect(apiHarness.startGame).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: 1 },
      { idempotencyKey: expect.any(String) },
    )
    expect(screen.getByRole('region', { name: /play the problem/i })).toBeInTheDocument()
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 01')
  })

  it('guards a pending start and reuses its idempotency key after a transport failure', async () => {
    serverGame = makeMappedGame()
    const pendingStart = createDeferred<DurableGame>()
    apiHarness.startGame.mockImplementationOnce(() => pendingStart.promise)
    await renderRestoredApp()

    const beginButton = screen.getByRole('button', { name: /set the pieces in motion/i })
    const resetButton = screen.getByRole('button', { name: /new question/i })
    fireEvent.click(beginButton)
    fireEvent.click(beginButton)

    expect(apiHarness.startGame).toHaveBeenCalledOnce()
    expect(beginButton).toBeDisabled()
    expect(resetButton).toBeDisabled()

    await act(async () => {
      pendingStart.reject(
        new WebChessApiError('The start response was lost in transit.', {
          kind: 'transport',
        }),
      )
    })

    expect(beginButton).toBeEnabled()
    expect(resetButton).toBeEnabled()
    fireEvent.click(beginButton)
    await flushAsyncWork()

    expect(apiHarness.startGame).toHaveBeenCalledTimes(2)
    const firstOptions = apiHarness.startGame.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.startGame.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(apiHarness.createIdempotencyKey).toHaveBeenCalledOnce()
    expect(screen.getByRole('region', { name: /play the problem/i })).toBeInTheDocument()
  })

  it('does not overwrite a successfully restored start conflict with the stale error', async () => {
    serverGame = makeMappedGame()
    apiHarness.startGame.mockImplementationOnce(async () => {
      const current = requireServerGame()
      serverGame = {
        ...current,
        revision: current.revision + 1,
        status: 'playing',
      }
      throw new WebChessApiError('The game already started elsewhere.', {
        kind: 'conflict',
      })
    })
    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', { name: /set the pieces in motion/i }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /play the problem/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('retries an ambiguous division with the same idempotency key', async () => {
    await renderRestoredApp()
    apiHarness.divideProblem.mockRejectedValueOnce(
      new WebChessApiError('The connection ended before the division was confirmed.', {
        kind: 'transport',
      }),
    )

    await submitProblem()

    expect(screen.getByText(/connection ended before the division was confirmed/i)).toBeInTheDocument()
    expect(apiHarness.recoverDivisionIntent).toHaveBeenCalledWith(
      '018f47b2-4b0c-7b9e-8f24-123456789000',
      { signal: expect.any(AbortSignal) },
    )
    expect(screen.getByRole('button', { name: /new question/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /try the division again/i }))
    await flushAsyncWork()

    expect(apiHarness.divideProblem).toHaveBeenCalledTimes(2)
    const firstOptions = apiHarness.divideProblem.mock.calls[0]?.[1] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.divideProblem.mock.calls[1]?.[1] as {
      idempotencyKey: string
    }
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(screen.getAllByText(/64 model facets received/i).length).toBeGreaterThan(0)
  })

  it('recovers and durably abandons an original failed division before refresh', async () => {
    const firstMount = await renderRestoredApp()
    apiHarness.divideProblem.mockImplementationOnce(
      async (problem: string): Promise<DurableGame> => {
        serverGame = {
          ...makeDividingGame(),
          id: GAME_ID,
          revision: 1,
          status: 'division_failed',
          problem,
        }
        throw new WebChessApiError('The model rejected the division.', {
          kind: 'http-error',
          status: 502,
        })
      },
    )

    await submitProblem()

    expect(apiHarness.recoverDivisionIntent).toHaveBeenCalledWith(
      '018f47b2-4b0c-7b9e-8f24-123456789000',
      { signal: expect.any(AbortSignal) },
    )
    expect(screen.getByText(/model rejected the division/i)).toBeInTheDocument()

    const resetButton = screen.getByRole('button', { name: /new question/i })
    expect(resetButton).toBeEnabled()
    fireEvent.click(resetButton)
    await flushAsyncWork()

    expect(apiHarness.abandonGame).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: 1 },
      { idempotencyKey: expect.any(String) },
    )
    expect(serverGame?.status).toBe('abandoned')

    firstMount.unmount()
    apiHarness.getCurrentGame.mockImplementation(
      async () => serverGame?.status === 'abandoned' ? null : serverGame,
    )
    await renderRestoredApp()

    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
    expect(apiHarness.divideProblem).toHaveBeenCalledOnce()
  })

  it('disables reset until an initial division returns a durable game target', async () => {
    await renderRestoredApp()
    const pendingDivision = createDeferred<DurableGame>()
    apiHarness.divideProblem.mockImplementationOnce(() => pendingDivision.promise)

    await submitProblem()
    const resetButton = screen.getByRole('button', { name: /new question/i })

    expect(resetButton).toBeDisabled()
    expect(apiHarness.abandonGame).not.toHaveBeenCalled()

    const mapped = makeMappedGame()
    serverGame = mapped
    await act(async () => pendingDivision.resolve(mapped))
    await flushAsyncWork()

    expect(resetButton).toBeEnabled()
    fireEvent.click(resetButton)
    await flushAsyncWork()

    expect(apiHarness.abandonGame).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: 1 },
      { idempotencyKey: expect.any(String) },
    )
    expect(serverGame?.status).toBe('abandoned')
    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
  })

  it('guards a pending reset and reuses its idempotency key after a transport failure', async () => {
    serverGame = makePlayingGame()
    const pendingReset = createDeferred<DurableGame>()
    apiHarness.abandonGame.mockImplementationOnce(() => pendingReset.promise)
    await renderRestoredApp()

    const resetButton = screen.getByRole('button', { name: /new question/i })
    fireEvent.click(resetButton)
    fireEvent.click(resetButton)

    expect(apiHarness.abandonGame).toHaveBeenCalledOnce()
    expect(resetButton).toBeDisabled()

    await act(async () => {
      pendingReset.reject(
        new WebChessApiError('The reset response was lost in transit.', {
          kind: 'transport',
        }),
      )
    })

    expect(resetButton).toBeEnabled()
    fireEvent.click(resetButton)
    await flushAsyncWork()

    expect(apiHarness.abandonGame).toHaveBeenCalledTimes(2)
    const firstOptions = apiHarness.abandonGame.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.abandonGame.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(apiHarness.createIdempotencyKey).toHaveBeenCalledOnce()
    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
  })

  it('does not overwrite a successfully restored reset conflict with the stale error', async () => {
    serverGame = makePlayingGame()
    apiHarness.abandonGame.mockImplementationOnce(async () => {
      const current = requireServerGame()
      serverGame = {
        ...current,
        revision: current.revision + 1,
      }
      throw new WebChessApiError('The game changed before reset.', {
        kind: 'conflict',
      })
    })
    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', { name: /new question/i }))

    await waitFor(() => {
      expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole('region', { name: /play the problem/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('durably abandons an answered game before showing a new question', async () => {
    serverGame = makeAnsweredGame()
    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', { name: /bring another problem/i }))
    await flushAsyncWork()

    expect(apiHarness.abandonGame).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: 13 },
      { idempotencyKey: expect.any(String) },
    )
    expect(serverGame?.status).toBe('abandoned')
    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
  })

  it('keeps reset disabled until a restored division has a durable mapped target', async () => {
    vi.useFakeTimers()
    const dividing = makeDividingGame()
    const mapped = makeMappedGame()
    const pendingPoll = createDeferred<DurableGame | null>()
    apiHarness.getCurrentGame
      .mockResolvedValueOnce(dividing)
      .mockImplementationOnce(() => pendingPoll.promise)

    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()
    await act(() => vi.advanceTimersByTimeAsync(1_500))

    const resetButton = screen.getByRole('button', { name: /new question/i })
    expect(resetButton).toBeDisabled()
    fireEvent.click(resetButton)
    expect(apiHarness.abandonGame).not.toHaveBeenCalled()

    await act(async () => pendingPoll.resolve(mapped))
    await flushAsyncWork()

    expect(resetButton).toBeEnabled()
    expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
  })

  it('autoplays with the shallow Engine V2 result and persists only the move command', async () => {
    serverGame = makePlayingGame()
    await renderRestoredApp()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(321))
    await flushAsyncWork()

    expect(apiHarness.submitMove).toHaveBeenCalledOnce()
    expect(engineHarness.chooseMove).toHaveBeenCalledWith(
      expect.any(Array),
      'white',
      `${GAME_ID}/1`,
      { completedPlies: 0, quietPlies: 0 },
    )

    const [gameId, command, options] = apiHarness.submitMove.mock.calls[0] as [
      string,
      MoveGameCommand,
      { idempotencyKey: string },
    ]
    expect(gameId).toBe(GAME_ID)
    expect(Object.keys(command).sort()).toEqual(['expectedRevision', 'pieceId', 'to'])
    expect(command).toMatchObject({
      expectedRevision: 2,
      pieceId: expect.stringMatching(/^white-/),
      to: {
        ring: expect.any(Number),
        sector: expect.any(Number),
      },
    })
    expect(command).not.toHaveProperty('pieces')
    expect(command).not.toHaveProperty('captures')
    expect(command).not.toHaveProperty('outcome')
    expect(options).toEqual({ idempotencyKey: expect.any(String) })
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 02')

    fireEvent.click(screen.getByRole('button', { name: /pause auto-play/i }))
  })

  it('keeps reset disabled while a move compare-and-swap is pending', async () => {
    serverGame = makePlayingGame()
    const pendingMove = createDeferred<DurableGame>()
    apiHarness.submitMove.mockImplementationOnce(() => pendingMove.promise)
    await renderRestoredApp()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(321))
    await flushAsyncWork()

    const resetButton = screen.getByRole('button', { name: /new question/i })
    expect(apiHarness.submitMove).toHaveBeenCalledOnce()
    expect(resetButton).toBeDisabled()
    fireEvent.click(resetButton)
    expect(apiHarness.abandonGame).not.toHaveBeenCalled()

    const command = apiHarness.submitMove.mock.calls[0]?.[1] as MoveGameCommand
    const saved = moveGame(
      requireServerGame(),
      command.pieceId,
      command.to,
    )
    serverGame = saved
    await act(async () => {
      pendingMove.resolve(saved)
    })
    await flushAsyncWork()

    expect(resetButton).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /pause auto-play/i }))
  })

  it('cancels autoplay and ignores the stale engine completion', async () => {
    serverGame = makePlayingGame()
    await renderRestoredApp()
    vi.useFakeTimers()
    engineHarness.deferred = true

    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(321))

    expect(engineHarness.pending).toHaveLength(1)
    expect(screen.getByRole('button', { name: /pause auto-play/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /pause auto-play/i }))

    await act(async () => {
      engineHarness.pending[0]?.resolve({
        status: 'ok',
        move: {
          pieceId: 'white-pawn-1',
          from: { ring: 6, sector: 0 },
          to: { ring: 5, sector: 0 },
          score: 0,
        },
      })
    })

    expect(engineHarness.reset).toHaveBeenCalledOnce()
    expect(apiHarness.submitMove).not.toHaveBeenCalled()
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 01')
    expect(screen.getAllByText(/auto-play paused\. choose a white piece/i)).toHaveLength(2)
  })

  it('cancels a manual search when the durable game is abandoned', async () => {
    serverGame = makePlayingGame()
    await renderRestoredApp()
    engineHarness.deferred = true

    fireEvent.click(screen.getByRole('button', { name: /play one turn/i }))
    expect(engineHarness.pending).toHaveLength(1)
    expect(screen.getByRole('button', { name: /auto-play to the end/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /new question/i }))
    await flushAsyncWork()
    await act(async () => {
      engineHarness.pending[0]?.resolve({
        status: 'ok',
        move: {
          pieceId: 'white-pawn-1',
          from: { ring: 6, sector: 0 },
          to: { ring: 5, sector: 0 },
          score: 0,
        },
      })
    })

    expect(apiHarness.abandonGame).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: 2 },
      { idempotencyKey: expect.any(String) },
    )
    expect(apiHarness.submitMove).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
  })

  it('recovers from failed and empty engine results without inventing a move', async () => {
    serverGame = makePlayingGame()
    await renderRestoredApp()
    engineHarness.deferred = true

    fireEvent.click(screen.getByRole('button', { name: /play one turn/i }))
    await act(async () => {
      engineHarness.pending[0]?.resolve({
        status: 'failed',
        message: 'The worker stopped unexpectedly.',
      })
    })

    expect(screen.getAllByText(/worker stopped unexpectedly.*move a piece yourself/i)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /play one turn/i }))
    await act(async () => {
      engineHarness.pending[1]?.resolve({ status: 'ok', move: null })
    })
    await flushAsyncWork()

    expect(apiHarness.getCurrentGame).toHaveBeenCalledTimes(2)
    expect(apiHarness.submitMove).not.toHaveBeenCalled()
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 01')
  })

  it('answers a terminal server move using only its game id and saved revision', async () => {
    serverGame = makeTerminalReadyGame()
    await renderRestoredApp()
    engineHarness.deferred = true

    fireEvent.click(screen.getByRole('button', { name: /play one turn/i }))
    await act(async () => {
      engineHarness.pending[0]?.resolve({
        status: 'ok',
        move: {
          pieceId: 'white-rook-1',
          from: { ring: 1, sector: 4 },
          to: { ring: 0, sector: 4 },
          score: 10_000,
        },
      })
    })

    await waitFor(() => expect(apiHarness.requestGameAnswer).toHaveBeenCalledOnce())
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /final webchess answer/i })).toBeInTheDocument()
      expect(screen.getByText(/protect the purpose, then test/i)).toBeInTheDocument()
    })

    const [gameId, command, options] = apiHarness.requestGameAnswer.mock.calls[0] as [
      string,
      RevisionCommand,
      { idempotencyKey: string; signal: AbortSignal },
    ]
    expect(gameId).toBe(GAME_ID)
    expect(command).toEqual({ expectedRevision: 12 })
    expect(Object.keys(command)).toEqual(['expectedRevision'])
    expect(command).not.toHaveProperty('captures')
    expect(command).not.toHaveProperty('outcome')
    expect(command).not.toHaveProperty('problem')
    expect(options).toEqual({
      idempotencyKey: expect.any(String),
      signal: expect.any(AbortSignal),
    })
  })

  it('advances a v2 terminal game through Portia, board Answer, and Charlotte', async () => {
    const completed = moveGame(
      makeTerminalReadyGame(),
      'white-rook-1',
      { ring: 0, sector: 4 },
    )
    serverGame = completed
    apiHarness.getGameLifecycle.mockResolvedValue(
      makeLifecycle('chess_terminal'),
    )
    apiHarness.runPortia.mockResolvedValue(
      makeLifecycle('gate_passed', { portia: true, gate: true }),
    )
    apiHarness.runCharlotte.mockResolvedValue(
      makeLifecycle('charlotte_complete', {
        portia: true,
        gate: true,
        charlotte: true,
      }),
    )

    await renderRestoredApp()

    expect(await screen.findByRole('heading', {
      name: /The substantive board-derived answer/i,
    }))
      .toBeInTheDocument()
    expect(await screen.findByRole('heading', {
      name: /The answer, qualified for people and action/i,
    }))
      .toBeInTheDocument()
    expect(screen.getByText(/Protect the purpose, run the smallest reversible test/i))
      .toBeInTheDocument()
    expect(apiHarness.runPortia).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: completed.revision },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
    expect(apiHarness.runCharlotte).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: completed.revision + 1 },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
    expect(apiHarness.requestGameAnswer).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: completed.revision },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    )
    expect(screen.getByRole('region', { name: /WebChess 2\.2 lifecycle/i }))
      .toBeInTheDocument()
  })

  it('reuses the automatic Answer key while a promptless 502 is reconciled', async () => {
    serverGame = moveGame(
      makeTerminalReadyGame(),
      'white-rook-1',
      { ring: 0, sector: 4 },
    )
    apiHarness.getGameLifecycle.mockResolvedValue(
      makeLifecycle('gate_passed', { portia: true, gate: true }),
    )
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('98000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('98000000-0000-4000-8000-000000000002')
    apiHarness.requestGameAnswer.mockRejectedValueOnce(
      new WebChessApiError(
        'The model connection ended before a result was confirmed.',
        { kind: 'http-error', status: 502 },
      ),
    )

    await renderRestoredApp()
    await waitFor(() => expect(apiHarness.requestGameAnswer).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText(ANSWER.answer)).toBeInTheDocument())

    const firstOptions = apiHarness.requestGameAnswer.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.requestGameAnswer.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(firstOptions.idempotencyKey).toBe(
      '98000000-0000-4000-8000-000000000001',
    )
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
  })

  it('reveals research-only Portia poll progress without changing lifecycle revision or its seven stages', async () => {
    vi.useFakeTimers()
    serverGame = moveGame(
      makeTerminalReadyGame(),
      'white-rook-1',
      { ring: 0, sector: 4 },
    )
    const initial = {
      ...makeLifecycle('portia_running'),
      research: [makeResearchRecord('searching')],
    } as LifecycleAggregate
    const completedResearch = makeResearchRecord('completed', {
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
    })
    const polled = {
      ...initial,
      research: [completedResearch],
    } as LifecycleAggregate
    const foregroundPortia = createDeferred<LifecycleAggregate>()

    expect(polled.revision).toBe(initial.revision)
    expect(polled.updatedAt).toBe(initial.updatedAt)
    expect(polled.research[0]?.status).not.toBe(initial.research[0]?.status)
    expect(polled.research[0]?.updatedAt).not.toBe(initial.research[0]?.updatedAt)
    expect(polled.research[0]?.sources).toHaveLength(1)
    expect(initial.research[0]?.sources).toHaveLength(0)

    apiHarness.getGameLifecycle
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(polled)
    apiHarness.runPortia.mockReturnValue(foregroundPortia.promise)

    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()
    await act(() => vi.advanceTimersByTimeAsync(0))
    await flushAsyncWork()

    expect(apiHarness.getGameLifecycle).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { name: 'Searching now' })).toBeInTheDocument()
    expect(screen.getByText('0 linked of 3 allowed · 0 omitted')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await flushAsyncWork()
    expect(apiHarness.runPortia).toHaveBeenCalledOnce()

    await act(() => vi.advanceTimersByTimeAsync(750))
    await flushAsyncWork()

    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument()
    expect(screen.getByText('1 linked of 3 allowed · 0 omitted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /NIST AI measurement guidance/i }))
      .toBeInTheDocument()

    const rail = screen.getByRole('region', { name: 'WebChess lifecycle progress' })
    const railLabels = Array.from(
      rail.querySelectorAll('.lifecycle-step > strong'),
      (node) => node.textContent,
    )
    expect(railLabels).toEqual([
      'Anansi',
      'Chess',
      'Portia',
      'Answer',
      'Charlotte',
      'Wilbur',
      'Web',
    ])
    expect(railLabels).not.toContain('Research')

    foregroundPortia.resolve(polled)
    await flushAsyncWork()
  })

  it('stops Charlotte auto-advance after the bounded terminal result', async () => {
    serverGame = makeAnsweredGame()
    apiHarness.getGameLifecycle.mockResolvedValue(
      makeLifecycle('charlotte_pending', { portia: true, gate: true }),
    )
    apiHarness.runCharlotte.mockResolvedValue({
      ...makeLifecycle('charlotte_unavailable', { portia: true, gate: true }),
      charlotteActiveModelRequestId: null,
      charlotteFailedAttemptCount: 3,
      charlotteFailureLimit: 3,
    } as LifecycleAggregate)

    await renderRestoredApp()

    expect(await screen.findByRole('heading', {
      name: 'Charlotte qualification is unavailable',
    })).toBeInTheDocument()
    expect(screen.getByRole('heading', {
      name: 'The substantive board-derived answer',
    })).toBeInTheDocument()
    expect(screen.getByText(ANSWER.answer)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Let the web meet reality/i }))
      .not.toBeInTheDocument()
    expect(apiHarness.runCharlotte).toHaveBeenCalledOnce()

    vi.useFakeTimers()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    await flushAsyncWork()

    expect(apiHarness.runCharlotte).toHaveBeenCalledOnce()
    expect(screen.queryByText(/qualifying the generated answer/i))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new question/i })).toBeEnabled()
  })

  it('restores an exhausted v2 lifecycle as an honest terminal result without locking reset', async () => {
    serverGame = moveGame(
      makeTerminalReadyGame(),
      'white-rook-1',
      { ring: 0, sector: 4 },
    )
    apiHarness.getGameLifecycle.mockResolvedValue(
      makeLifecycle('insufficient_basis', {
        portia: true,
        gate: true,
        gatePassed: false,
        gateRecommendation: 'insufficient_basis',
        fieldRegenerationCount: 1,
      }),
    )

    await renderRestoredApp()

    expect(await screen.findByRole('heading', { name: /insufficient basis/i }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try another bounded path/i }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new question/i })).toBeEnabled()
    expect(apiHarness.requestGameAnswer).not.toHaveBeenCalled()
  })

  it('settles a durable v2 Answer failure until the player starts one fresh request', async () => {
    serverGame = makeAnswerFailedGame()
    apiHarness.getGameLifecycle.mockResolvedValue(
      makeLifecycle('gate_passed', { portia: true, gate: true }),
    )
    apiHarness.runCharlotte.mockResolvedValue(
      makeLifecycle('charlotte_complete', {
        portia: true,
        gate: true,
        charlotte: true,
      }),
    )

    await renderRestoredApp()

    expect(await screen.findByRole('heading', {
      name: 'The Answer response could not be accepted',
    })).toBeInTheDocument()
    expect(apiHarness.requestGameAnswer).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    })
    expect(apiHarness.requestGameAnswer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Try the answer again' }))
    await waitFor(() => expect(apiHarness.requestGameAnswer).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByText(ANSWER.answer)).toBeInTheDocument())
    expect(apiHarness.requestGameAnswer).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: makeAnswerFailedGame().revision },
      expect.objectContaining({
        idempotencyKey: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('shows a terminal corrective prompt and uses a fresh logical request for retry', async () => {
    serverGame = makeAnswerFailedGame()
    apiHarness.getGameLifecycle.mockResolvedValue(
      makeLifecycle('gate_passed', { portia: true, gate: true }),
    )
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('97000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('97000000-0000-4000-8000-000000000002')
    apiHarness.requestGameAnswer.mockRejectedValueOnce(
      new WebChessApiError(
        'The model did not return a valid WebChess result after one corrective turn.',
        {
          kind: 'http-error',
          prompt: 'SYSTEM ROLE\n\nCORRECTION REQUIRED\nVerified board evidence.',
          status: 502,
        },
      ),
    )

    await renderRestoredApp()
    fireEvent.click(screen.getByRole('button', { name: 'Try the answer again' }))

    const summary = await screen.findByText(
      'Inspect corrective Answer role content',
    )
    fireEvent.click(summary)
    expect(screen.getByRole('region', {
      name: 'Corrective Answer role content',
    })).toHaveTextContent('CORRECTION REQUIRED')
    expect(screen.getByText(/up to two additional OpenClaw model turns/i))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try the answer again' }))
    await waitFor(() => expect(screen.getByText(ANSWER.answer)).toBeInTheDocument())

    const firstOptions = apiHarness.requestGameAnswer.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.requestGameAnswer.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(firstOptions.idempotencyKey).toBe(
      '97000000-0000-4000-8000-000000000001',
    )
    expect(retryOptions.idempotencyKey).toBe(
      '97000000-0000-4000-8000-000000000002',
    )
  })

  it('retries an ambiguous answer with the same idempotency key', async () => {
    serverGame = makeAnswerFailedGame()
    await renderRestoredApp()
    apiHarness.requestGameAnswer.mockRejectedValueOnce(
      new WebChessApiError('The connection ended before the answer was confirmed.', {
        kind: 'transport',
      }),
    )

    expect(screen.getByText(/server replay is complete, but the model answer failed/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try the answer again/i }))
    await waitFor(() => {
      expect(screen.getByText(/connection ended before the answer was confirmed/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /try the answer again/i }))
    await waitFor(() => {
      expect(screen.getByText(ANSWER.answer)).toBeInTheDocument()
    })

    expect(apiHarness.requestGameAnswer).toHaveBeenCalledTimes(2)
    const firstOptions = apiHarness.requestGameAnswer.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.requestGameAnswer.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
  })

  it.each(AMBIGUOUS_WILBUR_FAILURES)(
    'retries a Wilbur action after %s with the same key and exact command',
    async (_failureLabel, makeFailure) => {
    serverGame = makeAnsweredGame()
    let lifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey.mockReturnValueOnce(
      '91000000-0000-4000-8000-000000000001',
    )
    apiHarness.createWilburAction
      .mockRejectedValueOnce(makeFailure(
        'The Wilbur action result could not be confirmed.',
      ))
      .mockImplementationOnce(async (
        _gameId: string,
        command: CreateWilburActionCommand,
      ) => {
        const action = makeWilburAction(lifecycle, command.charlotteActionIndex)
        lifecycle = { ...lifecycle, wilburActions: [action] }
        return action
      })

    await renderRestoredApp()

    const track = screen.getByRole('button', {
      name: 'Track Action 1: Action 1 with Wilbur',
    })
    fireEvent.click(track)
    expect(await screen.findByText(/action result could not be confirmed/i))
      .toBeInTheDocument()

    fireEvent.click(track)
    expect(await screen.findByRole('combobox', {
      name: 'Status for Action 1: Action 1',
    })).toHaveValue('planned')

    expect(apiHarness.createWilburAction).toHaveBeenCalledTimes(2)
    const firstCommand = apiHarness.createWilburAction.mock.calls[0]?.[1]
    const retryCommand = apiHarness.createWilburAction.mock.calls[1]?.[1]
    const firstOptions = apiHarness.createWilburAction.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.createWilburAction.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(retryCommand).toBe(firstCommand)
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(3)
    },
  )

  it.each(AMBIGUOUS_WILBUR_FAILURES)(
    'retries a Wilbur status update after %s with the same key and exact command',
    async (_failureLabel, makeFailure) => {
    serverGame = makeAnsweredGame()
    const baseLifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    const action = makeWilburAction(baseLifecycle)
    let lifecycle = { ...baseLifecycle, wilburActions: [action] }
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey.mockReturnValueOnce(
      '92000000-0000-4000-8000-000000000001',
    )
    apiHarness.updateWilburAction
      .mockRejectedValueOnce(makeFailure(
        'The Wilbur status result could not be confirmed.',
      ))
      .mockImplementationOnce(async (
        _gameId: string,
        _actionId: string,
        command: UpdateWilburActionCommand,
      ) => {
        const updated = makeWilburAction(lifecycle, 0, {
          status: command.status,
          revision: command.expectedRevision + 1,
          updatedAt: '2026-08-15T16:03:00.000Z',
        })
        lifecycle = { ...lifecycle, wilburActions: [updated] }
        return updated
      })

    await renderRestoredApp()

    const status = screen.getByRole('combobox', {
      name: 'Status for Action 1: Action 1',
    })
    fireEvent.change(status, { target: { value: 'in_progress' } })
    expect(await screen.findByText(/status result could not be confirmed/i))
      .toBeInTheDocument()

    fireEvent.change(status, { target: { value: 'in_progress' } })
    await waitFor(() => expect(status).toHaveValue('in_progress'))

    expect(apiHarness.updateWilburAction).toHaveBeenCalledTimes(2)
    const firstCommand = apiHarness.updateWilburAction.mock.calls[0]?.[2]
    const retryCommand = apiHarness.updateWilburAction.mock.calls[1]?.[2]
    const firstOptions = apiHarness.updateWilburAction.mock.calls[0]?.[3] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.updateWilburAction.mock.calls[1]?.[3] as {
      idempotencyKey: string
    }
    expect(retryCommand).toBe(firstCommand)
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(3)
    },
  )

  it.each(AMBIGUOUS_WILBUR_FAILURES)(
    'retries a Wilbur observation after %s with the same key and original observedAt',
    async (_failureLabel, makeFailure) => {
    serverGame = makeAnsweredGame()
    const baseLifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    const action = makeWilburAction(baseLifecycle)
    let lifecycle = { ...baseLifecycle, wilburActions: [action] }
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey.mockReturnValueOnce(
      '93000000-0000-4000-8000-000000000001',
    )
    vi.spyOn(Date.prototype, 'toISOString')
      .mockReturnValueOnce('2026-08-15T16:05:00.000Z')
      .mockReturnValueOnce('2026-08-15T16:06:00.000Z')
    apiHarness.appendWilburObservation
      .mockRejectedValueOnce(makeFailure(
        'The Wilbur observation result could not be confirmed.',
      ))
      .mockImplementationOnce(async (
        _gameId: string,
        actionId: string,
        command: AppendWilburObservationCommand,
      ) => {
        const saved = makeWilburObservation(actionId, command)
        lifecycle = { ...lifecycle, wilburObservations: [saved] }
        return saved
      })

    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What did you observe?' }), {
      target: { value: 'The bounded signal appeared safely.' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'What should happen next?' }), {
      target: { value: 'Continue only inside the original limit.' },
    })
    const submitObservation = screen.getByRole('button', { name: 'Add to the web' })
    fireEvent.click(submitObservation)
    expect(await screen.findByText(/observation result could not be confirmed/i))
      .toBeInTheDocument()

    fireEvent.click(submitObservation)
    expect(await screen.findByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    })).toBeInTheDocument()

    expect(apiHarness.appendWilburObservation).toHaveBeenCalledTimes(2)
    const firstCommand = apiHarness.appendWilburObservation.mock.calls[0]?.[2] as
      AppendWilburObservationCommand
    const retryCommand = apiHarness.appendWilburObservation.mock.calls[1]?.[2]
    const firstOptions = apiHarness.appendWilburObservation.mock.calls[0]?.[3] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.appendWilburObservation.mock.calls[1]?.[3] as {
      idempotencyKey: string
    }
    expect(firstCommand.observedAt).toBe('2026-08-15T16:05:00.000Z')
    expect(retryCommand).toBe(firstCommand)
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(3)
    },
  )

  it('recovers a committed Wilbur action after an HTTP 503 without replaying creation', async () => {
    serverGame = makeAnsweredGame()
    let lifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('97000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('97000000-0000-4000-8000-000000000002')
    apiHarness.createWilburAction.mockImplementationOnce(async (
      _gameId: string,
      command: CreateWilburActionCommand,
    ) => {
      const action = makeWilburAction(lifecycle, command.charlotteActionIndex)
      lifecycle = { ...lifecycle, wilburActions: [action] }
      throw new WebChessApiError(
        'The server committed the action before its response was lost.',
        { kind: 'http-error', status: 503 },
      )
    })
    apiHarness.updateWilburAction.mockImplementationOnce(async (
      _gameId: string,
      _actionId: string,
      command: UpdateWilburActionCommand,
    ) => {
      const updated = makeWilburAction(lifecycle, 0, {
        status: command.status,
        revision: command.expectedRevision + 1,
        updatedAt: '2026-08-15T16:08:00.000Z',
      })
      lifecycle = { ...lifecycle, wilburActions: [updated] }
      return updated
    })

    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', {
      name: 'Track Action 1: Action 1 with Wilbur',
    }))
    const status = await screen.findByRole('combobox', {
      name: 'Status for Action 1: Action 1',
    })
    expect(status).toHaveValue('planned')
    expect(apiHarness.createWilburAction).toHaveBeenCalledOnce()
    expect(screen.queryByText(/response was lost/i)).not.toBeInTheDocument()

    fireEvent.change(status, { target: { value: 'in_progress' } })
    await waitFor(() => expect(status).toHaveValue('in_progress'))

    expect(apiHarness.createWilburAction).toHaveBeenCalledOnce()
    expect(apiHarness.updateWilburAction).toHaveBeenCalledOnce()
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(3)
  })

  it('recovers a committed Wilbur status after a malformed 2xx without replaying it', async () => {
    serverGame = makeAnsweredGame()
    const baseLifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    const action = makeWilburAction(baseLifecycle)
    let lifecycle = { ...baseLifecycle, wilburActions: [action] }
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('98000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('98000000-0000-4000-8000-000000000002')
    apiHarness.updateWilburAction
      .mockImplementationOnce(async (
        _gameId: string,
        _actionId: string,
        command: UpdateWilburActionCommand,
      ) => {
        const updated = makeWilburAction(lifecycle, 0, {
          status: command.status,
          revision: command.expectedRevision + 1,
          updatedAt: '2026-08-15T16:09:00.000Z',
        })
        lifecycle = { ...lifecycle, wilburActions: [updated] }
        throw new WebChessApiError(
          'The server committed the status but returned malformed JSON.',
          { kind: 'invalid-response' },
        )
      })
      .mockImplementationOnce(async (
        _gameId: string,
        _actionId: string,
        command: UpdateWilburActionCommand,
      ) => {
        const updated = makeWilburAction(lifecycle, 0, {
          status: command.status,
          revision: command.expectedRevision + 1,
          updatedAt: '2026-08-15T16:10:00.000Z',
        })
        lifecycle = { ...lifecycle, wilburActions: [updated] }
        return updated
      })

    await renderRestoredApp()

    const status = screen.getByRole('combobox', {
      name: 'Status for Action 1: Action 1',
    })
    fireEvent.change(status, { target: { value: 'in_progress' } })
    await waitFor(() => expect(status).toHaveValue('in_progress'))
    expect(apiHarness.updateWilburAction).toHaveBeenCalledOnce()
    expect(screen.queryByText(/malformed JSON/i)).not.toBeInTheDocument()

    fireEvent.change(status, { target: { value: 'completed' } })
    await waitFor(() => expect(status).toHaveValue('completed'))

    const firstCommand = apiHarness.updateWilburAction.mock.calls[0]?.[2] as
      UpdateWilburActionCommand
    const nextCommand = apiHarness.updateWilburAction.mock.calls[1]?.[2] as
      UpdateWilburActionCommand
    const firstOptions = apiHarness.updateWilburAction.mock.calls[0]?.[3] as {
      idempotencyKey: string
    }
    const nextOptions = apiHarness.updateWilburAction.mock.calls[1]?.[3] as {
      idempotencyKey: string
    }
    expect(firstCommand).toEqual({
      expectedRevision: 0,
      status: 'in_progress',
      followUpAt: null,
    })
    expect(nextCommand).toEqual({
      expectedRevision: 1,
      status: 'completed',
      followUpAt: null,
    })
    expect(nextOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey)
    expect(apiHarness.updateWilburAction).toHaveBeenCalledTimes(2)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(3)
  })

  it('recovers a committed Wilbur observation after an HTTP 503 without duplicating it', async () => {
    serverGame = makeAnsweredGame()
    const baseLifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    const action = makeWilburAction(baseLifecycle)
    let lifecycle = { ...baseLifecycle, wilburActions: [action] }
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('99000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('99000000-0000-4000-8000-000000000002')
    vi.spyOn(Date.prototype, 'toISOString')
      .mockReturnValueOnce('2026-08-15T16:11:00.000Z')
      .mockReturnValueOnce('2026-08-15T16:12:00.000Z')
    apiHarness.appendWilburObservation
      .mockImplementationOnce(async (
        _gameId: string,
        actionId: string,
        command: AppendWilburObservationCommand,
      ) => {
        const saved = makeWilburObservation(actionId, command)
        lifecycle = { ...lifecycle, wilburObservations: [saved] }
        throw new WebChessApiError(
          'The server committed the observation before its response was lost.',
          { kind: 'http-error', status: 503 },
        )
      })
      .mockImplementationOnce(async (
        _gameId: string,
        actionId: string,
        command: AppendWilburObservationCommand,
      ) => {
        const saved = {
          ...makeWilburObservation(actionId, command),
          id: '84000000-0000-4000-8000-000000000002',
        }
        lifecycle = {
          ...lifecycle,
          wilburObservations: [...lifecycle.wilburObservations, saved],
        }
        return saved
      })

    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What did you observe?' }), {
      target: { value: 'The first bounded signal appeared safely.' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'What should happen next?' }), {
      target: { value: 'Keep the first action inside its original limit.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the web' }))
    expect(await screen.findByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    })).toBeInTheDocument()
    expect(apiHarness.appendWilburObservation).toHaveBeenCalledOnce()
    expect(screen.queryByText(/response was lost/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What did you observe?' }), {
      target: { value: 'A distinct follow-up signal appeared.' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'What should happen next?' }), {
      target: { value: 'Use the follow-up signal for the next decision.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the web' }))
    expect(await screen.findByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    })).toBeInTheDocument()

    const firstCommand = apiHarness.appendWilburObservation.mock.calls[0]?.[2] as
      AppendWilburObservationCommand
    const nextCommand = apiHarness.appendWilburObservation.mock.calls[1]?.[2] as
      AppendWilburObservationCommand
    const firstOptions = apiHarness.appendWilburObservation.mock.calls[0]?.[3] as {
      idempotencyKey: string
    }
    const nextOptions = apiHarness.appendWilburObservation.mock.calls[1]?.[3] as {
      idempotencyKey: string
    }
    expect(nextCommand.observation).not.toBe(firstCommand.observation)
    expect(nextCommand.observedAt).not.toBe(firstCommand.observedAt)
    expect(nextOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey)
    expect(lifecycle.wilburObservations).toHaveLength(2)
    expect(lifecycle.wilburObservations.filter(
      (observation) => observation.observation === firstCommand.observation,
    )).toHaveLength(1)
    expect(apiHarness.appendWilburObservation).toHaveBeenCalledTimes(2)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(3)
  })

  it('starts a new Wilbur action intent after a definitive 4xx response', async () => {
    serverGame = makeAnsweredGame()
    let lifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('94000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('94000000-0000-4000-8000-000000000002')
    apiHarness.createWilburAction
      .mockRejectedValueOnce(new WebChessApiError(
        'That Wilbur action was rejected.',
        { kind: 'http-error', status: 422 },
      ))
      .mockImplementationOnce(async (
        _gameId: string,
        command: CreateWilburActionCommand,
      ) => {
        const action = makeWilburAction(lifecycle, command.charlotteActionIndex)
        lifecycle = { ...lifecycle, wilburActions: [action] }
        return action
      })

    await renderRestoredApp()

    const track = screen.getByRole('button', {
      name: 'Track Action 1: Action 1 with Wilbur',
    })
    fireEvent.click(track)
    expect(await screen.findByText(/Wilbur action was rejected/i))
      .toBeInTheDocument()
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledOnce()

    fireEvent.click(track)
    expect(await screen.findByRole('combobox', {
      name: 'Status for Action 1: Action 1',
    })).toHaveValue('planned')

    const firstCommand = apiHarness.createWilburAction.mock.calls[0]?.[1]
    const retryCommand = apiHarness.createWilburAction.mock.calls[1]?.[1]
    const firstOptions = apiHarness.createWilburAction.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.createWilburAction.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(retryCommand).not.toBe(firstCommand)
    expect(retryCommand).toEqual(firstCommand)
    expect(retryOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(2)
  })

  it('starts a new Wilbur status intent after a definitive 4xx response', async () => {
    serverGame = makeAnsweredGame()
    const baseLifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    const action = makeWilburAction(baseLifecycle)
    let lifecycle = { ...baseLifecycle, wilburActions: [action] }
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('95000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('95000000-0000-4000-8000-000000000002')
    apiHarness.updateWilburAction
      .mockRejectedValueOnce(new WebChessApiError(
        'That Wilbur status update was rejected.',
        { kind: 'http-error', status: 422 },
      ))
      .mockImplementationOnce(async (
        _gameId: string,
        _actionId: string,
        command: UpdateWilburActionCommand,
      ) => {
        const updated = makeWilburAction(lifecycle, 0, {
          status: command.status,
          revision: command.expectedRevision + 1,
          updatedAt: '2026-08-15T16:03:00.000Z',
        })
        lifecycle = { ...lifecycle, wilburActions: [updated] }
        return updated
      })

    await renderRestoredApp()

    const status = screen.getByRole('combobox', {
      name: 'Status for Action 1: Action 1',
    })
    fireEvent.change(status, { target: { value: 'in_progress' } })
    expect(await screen.findByText(/Wilbur status update was rejected/i))
      .toBeInTheDocument()
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledOnce()

    fireEvent.change(status, { target: { value: 'in_progress' } })
    await waitFor(() => expect(status).toHaveValue('in_progress'))

    const firstCommand = apiHarness.updateWilburAction.mock.calls[0]?.[2]
    const retryCommand = apiHarness.updateWilburAction.mock.calls[1]?.[2]
    const firstOptions = apiHarness.updateWilburAction.mock.calls[0]?.[3] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.updateWilburAction.mock.calls[1]?.[3] as {
      idempotencyKey: string
    }
    expect(retryCommand).not.toBe(firstCommand)
    expect(retryCommand).toEqual(firstCommand)
    expect(retryOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(2)
  })

  it('starts a new Wilbur observation intent after a definitive 4xx response', async () => {
    serverGame = makeAnsweredGame()
    const baseLifecycle = makeLifecycle('charlotte_complete', {
      portia: true,
      gate: true,
      charlotte: true,
    })
    const action = makeWilburAction(baseLifecycle)
    let lifecycle = { ...baseLifecycle, wilburActions: [action] }
    apiHarness.getGameLifecycle.mockImplementation(async () => lifecycle)
    apiHarness.createIdempotencyKey
      .mockReturnValueOnce('96000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('96000000-0000-4000-8000-000000000002')
    vi.spyOn(Date.prototype, 'toISOString')
      .mockReturnValueOnce('2026-08-15T16:05:00.000Z')
      .mockReturnValueOnce('2026-08-15T16:06:00.000Z')
    apiHarness.appendWilburObservation
      .mockRejectedValueOnce(new WebChessApiError(
        'That Wilbur observation was rejected.',
        { kind: 'http-error', status: 422 },
      ))
      .mockImplementationOnce(async (
        _gameId: string,
        actionId: string,
        command: AppendWilburObservationCommand,
      ) => {
        const saved = makeWilburObservation(actionId, command)
        lifecycle = { ...lifecycle, wilburObservations: [saved] }
        return saved
      })

    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What did you observe?' }), {
      target: { value: 'The bounded signal appeared safely.' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'What should happen next?' }), {
      target: { value: 'Continue only inside the original limit.' },
    })
    const submitObservation = screen.getByRole('button', { name: 'Add to the web' })
    fireEvent.click(submitObservation)
    expect(await screen.findByText(/Wilbur observation was rejected/i))
      .toBeInTheDocument()
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledOnce()

    fireEvent.click(submitObservation)
    expect(await screen.findByRole('button', {
      name: 'Record what happened for Action 1: Action 1',
    })).toBeInTheDocument()

    const firstCommand = apiHarness.appendWilburObservation.mock.calls[0]?.[2] as
      AppendWilburObservationCommand
    const retryCommand = apiHarness.appendWilburObservation.mock.calls[1]?.[2] as
      AppendWilburObservationCommand
    const firstOptions = apiHarness.appendWilburObservation.mock.calls[0]?.[3] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.appendWilburObservation.mock.calls[1]?.[3] as {
      idempotencyKey: string
    }
    expect(retryCommand).not.toBe(firstCommand)
    expect(retryCommand.observedAt).not.toBe(firstCommand.observedAt)
    expect(retryOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey)
    expect(apiHarness.getGameLifecycle).toHaveBeenCalledTimes(2)
  })

  it('guards replay against rapid duplicate clicks and other reading actions', async () => {
    serverGame = makeAnsweredGame()
    const pendingReplay = createDeferred<DurableGame>()
    apiHarness.replayGame.mockImplementationOnce(() => pendingReplay.promise)
    await renderRestoredApp()

    const replayButton = screen.getByRole('button', { name: /replay this board/i })
    fireEvent.click(replayButton)
    fireEvent.click(replayButton)

    expect(apiHarness.replayGame).toHaveBeenCalledOnce()
    expect(replayButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /new question/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /bring another problem/i })).toBeDisabled()

    const replayed = {
      ...makeMappedGame(PROBLEM, REPLAY_GAME_ID, GAME_ID),
      revision: 0,
    }
    serverGame = replayed
    await act(async () => pendingReplay.resolve(replayed))
    await flushAsyncWork()

    expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
  })

  it('locks reset after an ambiguous replay until a same-key retry resolves its child', async () => {
    serverGame = makeAnsweredGame()
    const firstMount = await renderRestoredApp()
    let replayChild: DurableGame | null = null
    apiHarness.replayGame
      .mockImplementationOnce(
        async (
          sourceGameId: string,
          _command: RevisionCommand,
          options: { idempotencyKey: string },
        ) => {
          replayChild = {
            ...makeMappedGame(PROBLEM, options.idempotencyKey, sourceGameId),
            revision: 0,
          }
          serverGame = replayChild
          throw new WebChessApiError(
            'The replay response was lost in transit.',
            { kind: 'transport' },
          )
        },
      )
      .mockImplementationOnce(async () => {
        if (!replayChild) throw new Error('The mock replay child is missing.')
        return replayChild
      })
    apiHarness.getOwnedGame.mockRejectedValueOnce(
      new WebChessApiError('The replay child is not visible yet.', {
        kind: 'not-found',
        status: 404,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /replay this board/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /replay response was lost in transit/i,
      )
    })

    const headerReset = screen.getByRole('button', { name: /new question/i })
    const readingReset = screen.getByRole('button', { name: /bring another problem/i })
    const replayButton = screen.getByRole('button', { name: /replay this board/i })
    expect(headerReset).toBeDisabled()
    expect(readingReset).toBeDisabled()
    expect(replayButton).toBeEnabled()
    fireEvent.click(headerReset)
    expect(apiHarness.abandonGame).not.toHaveBeenCalled()

    fireEvent.click(replayButton)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
    })

    expect(apiHarness.replayGame).toHaveBeenCalledTimes(2)
    const firstOptions = apiHarness.replayGame.mock.calls[0]?.[2] as {
      idempotencyKey: string
    }
    const retryOptions = apiHarness.replayGame.mock.calls[1]?.[2] as {
      idempotencyKey: string
    }
    expect(retryOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(requireServerGame()).toMatchObject({
      id: firstOptions.idempotencyKey,
      sourceGameId: GAME_ID,
      revision: 0,
    })

    fireEvent.click(screen.getByRole('button', { name: /new question/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
    })
    expect(apiHarness.abandonGame).toHaveBeenCalledWith(
      firstOptions.idempotencyKey,
      { expectedRevision: 0 },
      { idempotencyKey: expect.any(String) },
    )

    firstMount.unmount()
    apiHarness.getCurrentGame.mockImplementation(
      async () => serverGame?.status === 'abandoned' ? null : serverGame,
    )
    await renderRestoredApp()

    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
  })

  it('creates a durable replay and abandons that replay before a new question', async () => {
    serverGame = makeAnsweredGame()
    await renderRestoredApp()

    fireEvent.click(screen.getByRole('button', { name: /replay this board/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeEnabled()
    })

    expect(apiHarness.replayGame).toHaveBeenCalledWith(
      GAME_ID,
      { expectedRevision: 13 },
      { idempotencyKey: expect.any(String) },
    )
    expect(requireServerGame()).toMatchObject({
      id: REPLAY_GAME_ID,
      sourceGameId: GAME_ID,
      revision: 0,
      status: 'mapped',
    })

    fireEvent.click(screen.getByRole('button', { name: /new question/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
    })

    expect(apiHarness.abandonGame).toHaveBeenCalledWith(
      REPLAY_GAME_ID,
      { expectedRevision: 0 },
      { idempotencyKey: expect.any(String) },
    )
  })
})

// @vitest-environment node

import { APIConnectionTimeoutError } from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../lib/game-contract'
import { composeProblemParts } from '../../lib/division'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  evaluateGate,
  PORTIA_ATTACK_TYPES,
} from '../../lib/lifecycle'
import type {
  CharlotteResult,
  LifecycleAggregate,
  PortiaCandidateAssessment,
  PortiaReview,
  SurvivorCandidate,
} from '../../lib/lifecycle'
import { makeProblemFacets } from '../../test/fixtures'
import type { CaptureRecord, GeneratedAnswer } from '../../types'
import type { SqlAdapter, SqlResult, SqlRow } from '../db'
import {
  GameRepositoryError,
  type DurableGameSnapshot,
  type TerminalGameSnapshot,
} from '../games'
import type { LifecycleRepositoryPort } from '../lifecycle'
import {
  ModelContractError,
  ModelResponseError,
  OPENAI_MODEL,
} from '../openai'
import type {
  ModelResultPayload,
  ModelRequestStatus,
  UsageController,
} from '../usage'
import { ApiError } from './errors'
import {
  createApiServicesWithDependencies,
  type ApiServiceAdapterDependencies,
} from './service-adapter'

const OWNER_ID = 'user_adapter_test'
const GAME_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333'
const LEASE_TOKEN = '44444444-4444-4444-8444-444444444444'
const PROBLEM = 'How should I make this durable decision?'
const HMAC_SECRET = 'adapter-test-secret-'.repeat(3)
const FACETS = makeProblemFacets('Adapter facet')
const SEED = REQUEST_ID
const PARTS = composeProblemParts(FACETS, SEED)
const PROMPT = 'Canonical server-side division prompt.'
const NOW = new Date('2026-07-26T20:00:00.000Z')

const STORED_ANSWER: GeneratedAnswer = {
  answer: 'Use the durable evidence to make one reversible next move.',
  model: OPENAI_MODEL,
  prompt: 'Canonical answer prompt built only from the replay.',
}

function snapshot(
  overrides: Partial<DurableGameSnapshot> = {},
): DurableGameSnapshot {
  return {
    id: GAME_ID,
    sourceGameId: null,
    isCurrent: true,
    revision: 0,
    status: 'dividing',
    problem: PROBLEM,
    division: null,
    game: null,
    answer: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    answeredAt: null,
    ...overrides,
  }
}

function mappedSnapshot(
  overrides: Partial<DurableGameSnapshot> = {},
): DurableGameSnapshot {
  return snapshot({
    revision: 1,
    status: 'mapped',
    division: {
      seed: SEED,
      facets: FACETS,
      parts: PARTS,
      model: OPENAI_MODEL,
      promptVersion: 'webchess-division-v2',
      promptSha256: 'a'.repeat(64),
      digest: 'b'.repeat(64),
    },
    game: {
      versions: CURRENT_GAME_VERSIONS,
      pieces: [],
      turn: 'white',
      completedPlies: 0,
      quietPlies: 0,
      events: [],
      captures: [],
      lastMove: null,
      outcome: null,
    },
    ...overrides,
  })
}

function capture(): CaptureRecord {
  return {
    id: 'capture-private-id',
    turn: 1,
    attacker: {
      id: 'white-rook-0',
      side: 'white',
      kind: 'rook',
      position: { ring: 4, sector: 0 },
      moved: true,
    },
    captured: {
      id: 'black-pawn-0',
      side: 'black',
      kind: 'pawn',
      position: { ring: 4, sector: 0 },
      moved: true,
    },
    cell: { ring: 4, sector: 0 },
    part: PARTS[0]!,
    resonance: 73,
    narration: 'Private narration must not enter model evidence.',
  }
}

function terminalSnapshot(
  status: TerminalGameSnapshot['status'] = 'completed',
): TerminalGameSnapshot {
  const recordedCapture = capture()
  return mappedSnapshot({
    revision: status === 'answering' ? 3 : 2,
    status,
    game: {
      versions: CURRENT_GAME_VERSIONS,
      pieces: [],
      turn: 'white',
      completedPlies: 1,
      quietPlies: 0,
      events: [],
      captures: [recordedCapture],
      lastMove: {
        from: { ring: 5, sector: 0 },
        to: { ring: 4, sector: 0 },
      },
      outcome: {
        winner: null,
        reason: 'no-moves',
        completedTurn: 1,
        terminalCapture: recordedCapture,
      },
    },
    completedAt: NOW,
  }) as TerminalGameSnapshot
}

function divisionResultPayload() {
  return {
    format: 'webchess-division-result/1' as const,
    seed: SEED,
    facets: FACETS,
    model: OPENAI_MODEL,
    prompt: PROMPT,
  }
}

function answerResultPayload() {
  return {
    format: 'webchess-answer-result/1' as const,
    answer: STORED_ANSWER,
  }
}

function sqlResult(rows: readonly SqlRow[] = []): SqlResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    rows,
  }
}

function createDatabase(): SqlAdapter {
  return {
    query: vi.fn(async () => sqlResult()),
    transaction: vi.fn(async () => []),
  } as unknown as SqlAdapter
}

function createUsage(): UsageController {
  return {
    reserveModelRequest: vi.fn(async () => ({
      ok: true as const,
      kind: 'reserved' as const,
      requestId: REQUEST_ID,
      gameId: null,
      status: 'reserved' as const,
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: '2026-07-26T20:03:00.000Z',
    })),
    attachModelRequestGame: vi.fn(async () => ({
      ok: true as const,
      attached: true,
    })),
    consumeGameMoveRate: vi.fn(async () => ({
      ok: true as const,
      remaining: { user: 10, ip: 20 },
      resetsAt: '2026-07-26T21:00:00.000Z',
    })),
    consumeAccountExportRate: vi.fn(async () => ({
      ok: true as const,
      remaining: { user: 1, ip: 9 },
      resetsAt: '2026-07-26T21:00:00.000Z',
    })),
    consumeReplayGameStart: vi.fn(async () => ({
      ok: true as const,
      kind: 'consumed' as const,
      gameId: IDEMPOTENCY_KEY,
    })),
    getModelRequestResult: vi.fn(async () => ({ found: false as const })),
    getModelRequestByIdempotencyKey: vi.fn(async () => ({
      found: false as const,
    })),
    getLatestModelRequestForGame: vi.fn(async () => ({
      found: false as const,
    })),
    getSucceededModelResultForGame: vi.fn(async () => ({
      found: false as const,
    })),
    beginProviderCall: vi.fn(async () => ({
      ok: true as const,
      status: 'in_progress' as const,
      alreadyStarted: false,
    })),
    settleModelRequest: vi.fn(async (input) => ({
      ok: true as const,
      status: input.outcome,
      alreadySettled: false,
    })),
    releaseReservation: vi.fn(async () => ({
      ok: true as const,
      released: true,
    })),
    reconcileExpiredLeases: vi.fn(async () => ({
      expiredRequests: 0,
      clearedSlots: 0,
    })),
    deleteAccountData: vi.fn(async () => ({
      ok: true as const,
      deleted: true,
    })),
    getUsageSummary: vi.fn(async () => ({
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
  }
}

function createRepository() {
  return {
    getOrCreateDivision: vi.fn(async () => ({
      game: snapshot({ id: REQUEST_ID }),
      created: true,
    })),
    finishDivision: vi.fn(async () =>
      mappedSnapshot({ id: REQUEST_ID }),
    ),
    failDivision: vi.fn(async (input: { gameId: string }) =>
      snapshot({
        id: input.gameId,
        revision: 1,
        status: 'division_failed',
      }),
    ),
    getOwnedGame: vi.fn(async () => snapshot()),
    getCurrentGame: vi.fn(async () => snapshot()),
    startGame: vi.fn(async () => mappedSnapshot({ status: 'playing' })),
    appendMove: vi.fn(async () => ({
      game: mappedSnapshot({ status: 'playing' }),
      appendedEvents: [],
      idempotent: false,
    })),
    getTerminalReplay: vi.fn(async () => terminalSnapshot()),
    beginAnswer: vi.fn(async () => terminalSnapshot('answering')),
    storeAnswer: vi.fn(async () =>
      terminalSnapshot('answered') as TerminalGameSnapshot,
    ),
    failAnswer: vi.fn(async () =>
      terminalSnapshot('answer_failed'),
    ),
    abandonGame: vi.fn(async () =>
      mappedSnapshot({ status: 'abandoned' }),
    ),
  }
}

function createDependencies(): ApiServiceAdapterDependencies {
  const repository = createRepository()
  const usage = createUsage()
  return {
    accountExportMaxBytes: 3_000_000,
    database: createDatabase(),
    repository: repository as ApiServiceAdapterDependencies['repository'],
    usage,
    hmacSecret: HMAC_SECRET,
    openAiApiKey: 'server-test-key',
    softwareVersion: 'webchess-test',
    divisionGenerator: vi.fn(async () => ({
      providerId: 'resp_division',
      model: OPENAI_MODEL,
      prompt: PROMPT,
      result: { facets: FACETS },
      usage: {
        reported: true,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 170,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 5,
        reasoningOutputTokens: 20,
      },
    })),
    answerGenerator: vi.fn(async () => ({
      providerId: 'resp_answer',
      model: OPENAI_MODEL,
      prompt: STORED_ANSWER.prompt,
      result: {
        answer: STORED_ANSWER.answer,
        sections: {
          answer: 'Direct answer.',
          what_the_conflicts_emphasized: 'Conflicts.',
          the_tension_to_hold: 'Tension.',
          three_next_moves: ['One', 'Two', 'Three'],
          what_could_change_the_answer: 'Evidence.',
        },
        wordCount: 500,
      },
      usage: {
        reported: true,
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 310,
        cachedInputTokens: 30,
        cacheWriteInputTokens: 10,
        reasoningOutputTokens: 30,
      },
    })),
  }
}

function lifecycleCandidate(index: number): SurvivorCandidate {
  return {
    candidateId: `attempt-1:piece-${index + 1}`,
    pieceId: `piece-${index + 1}`,
    side: index % 2 === 0 ? 'white' : 'black',
    pieceKind: index === 0 ? 'king' : 'rook',
    originalPieceKind: index === 0 ? 'king' : 'rook',
    pieceRole: 'the structure holding a bounded choice in place',
    sidePolarity: index % 2 === 0 ? 'outside-in evidence' : 'inside-out possibility',
    finalCoordinate: { ring: index + 1, sector: index },
    facet: PARTS[index * 8],
    route: [],
    capturesMade: [],
    attackedPlies: [],
    moveCount: index + 1,
    promoted: false,
    terminalGameId: GAME_ID,
    attemptId: '55555555-5555-4555-8555-555555555555',
    sourceDigest: String(index + 1).repeat(64),
  }
}

const LIFECYCLE_SURVIVORS = Array.from(
  { length: 4 },
  (_, index) => lifecycleCandidate(index),
)

function lifecycleAssessment(
  candidate: SurvivorCandidate,
  index: number,
): PortiaCandidateAssessment {
  return {
    candidateId: candidate.candidateId,
    disposition: index === 1 ? 'wounded' : 'preserved',
    survivingInterpretation: 'A bounded interpretation remains useful after adversarial testing.',
    requiredQualification: index === 1
      ? 'Use this interpretation only after the local evidence check succeeds.'
      : null,
    redundancyClusterId: null,
    coverageTags: [[
      'protected_outcome',
      'evidence_or_reality',
      'risk_or_countercase',
      'agency_or_action',
    ][index] as PortiaCandidateAssessment['coverageTags'][number]],
    missingEvidence: ['A direct observation remains necessary before scaling.'],
    countercase: 'A contradictory observation would reverse the interpretation.',
    reversalCondition: 'Stop when the protected outcome or evidence threshold fails.',
    attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
      attackType,
      severity: 'moderate',
      finding: `The ${attackType} attack identifies a bounded uncertainty.`,
      consequence: 'Preserve uncertainty and a credible stopping rule.',
      requiredRevision: 'State the tested assumption and evidence threshold.',
    })),
  }
}

function lifecycleReview(): PortiaReview {
  const assessments = LIFECYCLE_SURVIVORS.map(lifecycleAssessment)
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    runSummary: 'Portia examined every terminal survivor without treating survival as proof.',
    assessments,
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: ['Which direct observation would reduce uncertainty fastest?'],
    recommendedGateInputs: {
      tensionCandidatePairs: [[
        assessments[0].candidateId,
        assessments[2].candidateId,
      ]],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  }
}

function lifecycleCharlotte(portia = lifecycleReview()): CharlotteResult {
  const wounded = portia.assessments[1]
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    protectedOutcome: 'Protect the declared outcome while generating useful direct evidence.',
    directAnswer: 'Run one bounded, reversible test before making the larger commitment, then decide from the recorded observation rather than the metaphor.',
    supportingCandidateIds: portia.assessments.map((item) => item.candidateId),
    qualificationsByCandidateId: {
      [wounded.candidateId]: wounded.requiredQualification ?? '',
    },
    centralTension: 'Learn promptly while protecting affected people from avoidable downside and preserving a real stopping path.',
    valueConstraints: ['Keep uncertainty visible and do not weaken the protected outcome.'],
    stakeholderConsequences: ['The accountable owner records impact and affected people retain agency.'],
    recommendation: 'Authorize only the smallest reversible experiment and use the predeclared observation threshold to stop, revise, or continue.',
    communicationStrategy: 'State the tested assumption, evidence boundary, and stop rule consistently.',
    uncertainties: ['The direct observation has not yet been collected.'],
    whatCouldChangeTheAnswer: ['A contradictory signal or unacceptable harm reverses the recommendation.'],
    exactlyThreeNextActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Reversible action ${index + 1}`,
      actor: 'The accountable decision owner',
      assumptionBeingTested: 'A bounded action can generate useful decision evidence safely.',
      smallestAction: 'Run one limited observation without expanding scope.',
      expectedObservation: 'A direct signal appears inside the review horizon.',
      decisionThreshold: 'Continue only when the declared signal appears without harm.',
      reviewHorizon: 'Within fourteen days',
      reversibility: 'Stop the test and restore the prior operating state.',
      risksOrAffectedParties: 'Record affected parties and stop when the protected outcome is threatened.',
      decisionRule: 'revise',
    })),
  }
}

function lifecycleAggregate(
  overrides: Partial<LifecycleAggregate> = {},
): LifecycleAggregate {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    rootRunId: '55555555-5555-4555-8555-555555555555',
    parentRunId: null,
    gameId: GAME_ID,
    state: 'portia_pending',
    revision: 5,
    fieldGeneration: 1,
    gameAttempt: 1,
    sameFieldRetryCount: 0,
    fieldRegenerationCount: 0,
    divisionSeed: SEED,
    castSeed: 'adapter-cast-seed',
    trajectorySeed: 'adapter-trajectory-seed',
    retryReason: null,
    terminalFingerprint: 'f'.repeat(64),
    survivors: LIFECYCLE_SURVIVORS,
    portia: null,
    gate: null,
    charlotte: null,
    charlotteRenderedAnswer: null,
    wilburActions: [],
    wilburObservations: [],
    versions: {
      software: '2.0.0',
      lifecycle: CURRENT_LIFECYCLE_VERSIONS.lifecycle,
      portiaPrompt: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      portiaContract: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      gateAlgorithm: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
      retryPolicy: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      charlottePrompt: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      charlotteContract: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      wilburRecord: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      rules: CURRENT_GAME_VERSIONS.rules,
      engine: CURRENT_GAME_VERSIONS.engine,
      cast: CURRENT_GAME_VERSIONS.cast,
      event: CURRENT_GAME_VERSIONS.event,
    },
    activities: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  }
}

function createLifecycleRepository(
  initial = lifecycleAggregate(),
): LifecycleRepositoryPort {
  let current = initial
  const repository: LifecycleRepositoryPort = {
    ensureForGame: vi.fn(async () => current),
    getForGame: vi.fn(async () => current),
    transition: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: input.to,
        terminalFingerprint:
          input.terminalFingerprint ?? current.terminalFingerprint,
        survivors: input.survivors ?? current.survivors,
      }
      return current
    }),
    storePortia: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'portia_complete',
        portia: input.review,
      }
      return current
    }),
    storeGate: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: input.result.passed ? 'gate_passed' : 'gate_failed',
        gate: input.result,
      }
      return current
    }),
    storeCharlotte: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'charlotte_complete',
        charlotte: input.result,
        charlotteRenderedAnswer: input.renderedAnswer,
      }
      return current
    }),
    createRetryRun: vi.fn(async (input) => {
      current = lifecycleAggregate({
        id: '66666666-6666-4666-8666-666666666666',
        rootRunId: initial.rootRunId,
        parentRunId: initial.id,
        gameId: input.childGame.id,
        state: input.mode === 'replay_game' ? 'chess_ready' : 'field_ready',
        retryReason: input.reason,
        sameFieldRetryCount:
          initial.sameFieldRetryCount + (input.mode === 'replay_game' ? 1 : 0),
        fieldRegenerationCount:
          initial.fieldRegenerationCount + (input.mode === 'regenerate_field' ? 1 : 0),
      })
      return current
    }),
    hasPriorTerminalFingerprint: vi.fn(async () => false),
    createWilburAction: vi.fn(async (input) => ({
      id: input.id,
      lifecycleRunId: current.id,
      charlotteActionIndex: input.charlotteActionIndex,
      actor: input.actor,
      action: input.action,
      testedAssumption: input.testedAssumption,
      expectedObservation: input.expectedObservation,
      decisionThreshold: input.decisionThreshold,
      reviewHorizon: input.reviewHorizon,
      status: 'planned' as const,
      revision: 0,
      version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    updateWilburAction: vi.fn(async (input) => ({
      id: input.actionId,
      lifecycleRunId: current.id,
      charlotteActionIndex: 0,
      actor: 'The accountable owner',
      action: 'Run one bounded test.',
      testedAssumption: 'The bounded test can produce useful evidence.',
      expectedObservation: 'A direct signal appears.',
      decisionThreshold: 'Continue only if the signal appears safely.',
      reviewHorizon: 'Within fourteen days',
      status: input.status,
      revision: input.expectedRevision + 1,
      version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })),
    appendWilburObservation: vi.fn(async (input) => ({
      id: input.id,
      actionId: input.actionId,
      observedAt: input.observedAt,
      observation: input.observation,
      evidenceClassification: input.evidenceClassification,
      expectedEffect: input.expectedEffect,
      unexpectedEffect: input.unexpectedEffect,
      stakeholderResponse: input.stakeholderResponse,
      assumptionResult: input.assumptionResult,
      nextDecision: input.nextDecision,
      version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      createdAt: NOW.toISOString(),
    })),
  }
  return repository
}

function lifecycleDependencies(
  initial = lifecycleAggregate(),
): ApiServiceAdapterDependencies {
  const dependencies = createDependencies()
  const portiaGenerator = vi.fn(async () => ({
    providerId: 'resp_portia',
    model: OPENAI_MODEL,
    prompt: 'Canonical Portia prompt.',
    result: lifecycleReview(),
    usage: {
      reported: true,
      inputTokens: 300,
      outputTokens: 120,
      totalTokens: 450,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 30,
    },
  }))
  const charlotteGenerator = vi.fn(async () => ({
    providerId: 'resp_charlotte',
    model: OPENAI_MODEL,
    prompt: 'Canonical Charlotte prompt.',
    result: {
      structured: lifecycleCharlotte(),
      renderedAnswer: 'Charlotte preserves the qualified evidence boundary. '.repeat(12),
      wordCount: 500,
    },
    usage: {
      reported: true,
      inputTokens: 240,
      outputTokens: 110,
      totalTokens: 380,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 30,
    },
  }))
  return {
    ...dependencies,
    lifecycleRepository: createLifecycleRepository(initial),
    portiaGenerator,
    charlotteGenerator,
  }
}

function operationInput() {
  return {
    ownerId: OWNER_ID,
    problem: PROBLEM,
    ipAddress: '203.0.113.17',
    idempotencyKey: IDEMPOTENCY_KEY,
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
  }
}

describe('durable HTTP service adapter', () => {
  let dependencies: ApiServiceAdapterDependencies

  beforeEach(() => {
    dependencies = createDependencies()
  })

  it('orders division reservation, provider work, durable settlement, and game finalization', async () => {
    const order: string[] = []
    const usage = dependencies.usage
    const repository = dependencies.repository

    vi.mocked(usage.reserveModelRequest).mockImplementation(async () => {
      order.push('reserve')
      return {
        ok: true,
        kind: 'reserved',
        requestId: REQUEST_ID,
        gameId: null,
        status: 'reserved',
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: '2026-07-26T20:03:00.000Z',
      }
    })
    vi.mocked(repository.getOrCreateDivision).mockImplementation(async () => {
      order.push('create')
      return {
        game: snapshot({ id: REQUEST_ID }),
        created: true,
      }
    })
    vi.mocked(usage.attachModelRequestGame).mockImplementation(async () => {
      order.push('attach')
      return { ok: true, attached: true }
    })
    vi.mocked(usage.beginProviderCall).mockImplementation(async () => {
      order.push('begin')
      return { ok: true, status: 'in_progress', alreadyStarted: false }
    })
    vi.mocked(dependencies.divisionGenerator).mockImplementation(async () => {
      order.push('provider')
      return {
        providerId: 'resp_division',
        model: OPENAI_MODEL,
        prompt: PROMPT,
        result: { facets: FACETS },
        usage: {
          reported: true,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 170,
          cachedInputTokens: 20,
          cacheWriteInputTokens: 5,
          reasoningOutputTokens: 20,
        },
      }
    })
    vi.mocked(usage.settleModelRequest).mockImplementation(async () => {
      order.push('settle')
      return { ok: true, status: 'succeeded', alreadySettled: false }
    })
    vi.mocked(repository.finishDivision).mockImplementation(async () => {
      order.push('finish')
      return mappedSnapshot({ id: REQUEST_ID })
    })

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).divide(operationInput())

    expect(order).toEqual([
      'reserve',
      'create',
      'attach',
      'begin',
      'provider',
      'settle',
      'finish',
    ])
    expect(game).toMatchObject({
      id: REQUEST_ID,
      status: 'mapped',
    })
    expect(game.division).not.toHaveProperty('prompt')
    expect(game).not.toHaveProperty('isCurrent')
    expect(usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'succeeded',
        resultPayload: expect.objectContaining({
          format: 'webchess-division-result/1',
          seed: REQUEST_ID,
        }),
        usage: {
          reported: true,
          inputTokens: 100,
          cachedInputTokens: 20,
          cacheWriteInputTokens: 5,
          outputTokens: 50,
          reasoningTokens: 20,
          totalTokens: 170,
        },
      }),
    )
    const providerContext = vi.mocked(
      dependencies.divisionGenerator,
    ).mock.calls[0]?.[1]
    expect(providerContext?.userId).toBe(OWNER_ID)
    expect(providerContext?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(providerContext?.idempotencyKey).not.toBe(IDEMPOTENCY_KEY)
  })

  it('does not recreate a game after forced deletion wins during a division provider call', async () => {
    vi.mocked(dependencies.usage.settleModelRequest).mockResolvedValue({
      ok: false,
      code: 'REQUEST_NOT_FOUND',
      httpStatus: 409,
    })
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockResolvedValue({ found: false })

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    })

    expect(dependencies.repository.finishDivision).not.toHaveBeenCalled()
    expect(dependencies.repository.failDivision).not.toHaveBeenCalled()
  })

  it('rejects a stale authenticated division after the deletion barrier wins', async () => {
    vi.mocked(dependencies.usage.reserveModelRequest).mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
      retryAfterSeconds: null,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect(dependencies.repository.getOrCreateDivision).not.toHaveBeenCalled()
    expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
  })

  it('preserves the account-deleted response when forced deletion removes the shell before provider start', async () => {
    vi.mocked(dependencies.usage.beginProviderCall).mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })
    vi.mocked(dependencies.repository.failDivision).mockRejectedValue(
      new GameRepositoryError('not-found', 'Deleted game.'),
    )

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })

    expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
    expect(dependencies.usage.releaseReservation).toHaveBeenCalledOnce()
    expect(dependencies.repository.finishDivision).not.toHaveBeenCalled()
  })

  it('reports an expired provider-start lease without calling OpenAI', async () => {
    vi.mocked(dependencies.usage.beginProviderCall).mockResolvedValue({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 410,
      retryAfterSeconds: 2,
    })
    expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
  })

  it('recovers a settled division payload without a second provider call', async () => {
    vi.mocked(dependencies.usage.reserveModelRequest).mockResolvedValue({
      ok: true,
      kind: 'existing',
      requestId: REQUEST_ID,
      gameId: REQUEST_ID,
      status: 'succeeded',
      leaseToken: null,
      leaseExpiresAt: null,
    })
    vi.mocked(
      dependencies.usage.getLatestModelRequestForGame,
    ).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: REQUEST_ID,
      operation: 'division',
      status: 'succeeded',
      resultPayload: divisionResultPayload() as unknown as ModelResultPayload,
    })

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).divide(operationInput())

    expect(game.status).toBe('mapped')
    expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
    expect(dependencies.usage.beginProviderCall).not.toHaveBeenCalled()
    expect(dependencies.repository.finishDivision).toHaveBeenCalledTimes(1)
  })

  it('finalizes the committed winner when a concurrent division success rejects this settlement', async () => {
    vi.mocked(dependencies.usage.settleModelRequest).mockResolvedValue({
      ok: false,
      code: 'OPERATION_ALREADY_SUCCEEDED',
      httpStatus: 409,
    })
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockResolvedValue({
      found: true,
      requestId: '55555555-5555-4555-8555-555555555555',
      gameId: REQUEST_ID,
      operation: 'division',
      status: 'succeeded',
      resultPayload: divisionResultPayload() as unknown as ModelResultPayload,
    })

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).divide(operationInput())

    expect(game.status).toBe('mapped')
    expect(
      dependencies.usage.getSucceededModelResultForGame,
    ).toHaveBeenCalledWith({
      userId: OWNER_ID,
      gameId: REQUEST_ID,
      operation: 'division',
    })
    expect(dependencies.repository.finishDivision).toHaveBeenCalledTimes(1)
    expect(dependencies.repository.failDivision).not.toHaveBeenCalled()
    expect(dependencies.usage.releaseReservation).not.toHaveBeenCalled()
  })

  it.each(['reserved', 'in_progress'] satisfies ModelRequestStatus[])(
    'returns a pending division for an active %s ledger state without duplicating OpenAI',
    async (status) => {
      vi.mocked(dependencies.usage.reserveModelRequest).mockResolvedValue({
        ok: true,
        kind: 'existing',
        requestId: REQUEST_ID,
        gameId: REQUEST_ID,
        status,
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: '2026-07-26T20:03:00.000Z',
      })
      vi.mocked(
        dependencies.usage.getLatestModelRequestForGame,
      ).mockResolvedValue({
        found: true,
        requestId: REQUEST_ID,
        gameId: REQUEST_ID,
        operation: 'division',
        status,
        resultPayload: null,
      })

      const game = await createApiServicesWithDependencies(
        dependencies,
      ).divide(operationInput())

      expect(game.status).toBe('dividing')
      expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
      expect(dependencies.usage.beginProviderCall).not.toHaveBeenCalled()
    },
  )

  it.each([
    'failed',
    'indeterminate',
    'rejected',
  ] satisfies ModelRequestStatus[])(
    'transitions a pending division to failed for terminal ledger state %s',
    async (status) => {
      vi.mocked(dependencies.repository.getOwnedGame).mockResolvedValue(
        snapshot(),
      )
      vi.mocked(
        dependencies.usage.getLatestModelRequestForGame,
      ).mockResolvedValue({
        found: true,
        requestId: REQUEST_ID,
        gameId: GAME_ID,
        operation: 'division',
        status,
        resultPayload: null,
      })

      const game = await createApiServicesWithDependencies(
        dependencies,
      ).getGame({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      })

      expect(game.status).toBe('division_failed')
      expect(dependencies.repository.failDivision).toHaveBeenCalledTimes(1)
      expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
    },
  )

  it('repairs the crash window between division shell creation and ledger attachment', async () => {
    vi.mocked(dependencies.repository.getCurrentGame).mockResolvedValue(
      snapshot(),
    )
    vi.mocked(
      dependencies.usage.getLatestModelRequestForGame,
    ).mockResolvedValue({ found: false })
    vi.mocked(dependencies.usage.getModelRequestResult).mockResolvedValue({
      found: true,
      requestId: GAME_ID,
      gameId: null,
      operation: 'division',
      status: 'reserved',
      resultPayload: null,
    })

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).getCurrentGame({
      ownerId: OWNER_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(game?.status).toBe('dividing')
    expect(dependencies.usage.attachModelRequestGame).toHaveBeenCalledWith({
      userId: OWNER_ID,
      requestId: GAME_ID,
      gameId: GAME_ID,
    })
  })

  it('resolves a browser division intent to its independently identified owner game', async () => {
    vi.mocked(
      dependencies.usage.getModelRequestByIdempotencyKey,
    ).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: GAME_ID,
      operation: 'division',
      status: 'succeeded',
      resultPayload: divisionResultPayload() as unknown as ModelResultPayload,
    })
    vi.mocked(dependencies.repository.getOwnedGame).mockResolvedValue(
      mappedSnapshot({ id: GAME_ID }),
    )

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).getDivisionIntent({
      ownerId: OWNER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(game.id).toBe(GAME_ID)
    expect(game.id).not.toBe(IDEMPOTENCY_KEY)
    expect(
      dependencies.usage.getModelRequestByIdempotencyKey,
    ).toHaveBeenCalledWith({
      userId: OWNER_ID,
      operation: 'division',
      idempotencyKey: IDEMPOTENCY_KEY,
    })
    expect(dependencies.repository.getOwnedGame).toHaveBeenCalledWith(
      OWNER_ID,
      GAME_ID,
    )
    expect(game).not.toHaveProperty('requestId')
    expect(game).not.toHaveProperty('idempotencyKey')
    expect(game).not.toHaveProperty('clerkUserId')
  })

  it('keeps absent and unlinked division intents owner-private', async () => {
    const services = createApiServicesWithDependencies(dependencies)
    const input = {
      ownerId: OWNER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    }

    await expect(services.getDivisionIntent(input)).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
      status: 404,
    })
    vi.mocked(
      dependencies.usage.getModelRequestByIdempotencyKey,
    ).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: null,
      operation: 'division',
      status: 'reserved',
      resultPayload: null,
    })
    await expect(services.getDivisionIntent(input)).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
      status: 404,
    })
    expect(dependencies.repository.getOwnedGame).not.toHaveBeenCalled()
  })

  it('reconciles a pending game recovered through its division intent', async () => {
    vi.mocked(
      dependencies.usage.getModelRequestByIdempotencyKey,
    ).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: GAME_ID,
      operation: 'division',
      status: 'in_progress',
      resultPayload: null,
    })
    vi.mocked(dependencies.repository.getOwnedGame).mockResolvedValue(
      snapshot({ id: GAME_ID }),
    )
    vi.mocked(
      dependencies.usage.getLatestModelRequestForGame,
    ).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: GAME_ID,
      operation: 'division',
      status: 'failed',
      resultPayload: null,
    })

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).getDivisionIntent({
      ownerId: OWNER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(game.status).toBe('division_failed')
    expect(dependencies.usage.reconcileExpiredLeases).toHaveBeenCalledOnce()
    expect(dependencies.repository.failDivision).toHaveBeenCalledOnce()
  })

  it('settles a definitive provider contract failure before failing the game', async () => {
    vi.mocked(dependencies.divisionGenerator).mockRejectedValue(
      new ModelContractError('invalid structured output'),
    )

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE',
      status: 502,
    })

    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        failureCode: 'provider_contract_invalid',
      }),
    )
    expect(dependencies.repository.failDivision).toHaveBeenCalledTimes(1)
    expect(dependencies.usage.releaseReservation).not.toHaveBeenCalled()
  })

  it('persists sanitized token usage from a rejected provider response', async () => {
    vi.mocked(dependencies.divisionGenerator).mockRejectedValue(
      new ModelResponseError({
        providerId: 'resp_rejected',
        model: OPENAI_MODEL,
        status: 'schema_invalid',
        usage: {
          reported: true,
          inputTokens: 91,
          cachedInputTokens: 11,
          cacheWriteInputTokens: 7,
          outputTokens: 37,
          reasoningOutputTokens: 9,
          totalTokens: 128,
        },
      }),
    )

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE',
      status: 502,
    })

    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        failureCode: 'provider_schema_invalid',
        providerResponseId: 'resp_rejected',
        usage: {
          reported: true,
          inputTokens: 91,
          cachedInputTokens: 11,
          cacheWriteInputTokens: 7,
          outputTokens: 37,
          reasoningTokens: 9,
          totalTokens: 128,
        },
      }),
    )
  })

  it('settles a received model response even when a client abort races afterward', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.mocked(dependencies.divisionGenerator).mockRejectedValue(
      new ModelResponseError({
        providerId: 'resp_abort_race',
        model: OPENAI_MODEL,
        status: 'refused',
        usage: {
          reported: true,
          inputTokens: 45,
          cachedInputTokens: 5,
          cacheWriteInputTokens: 0,
          outputTokens: 3,
          reasoningOutputTokens: 0,
          totalTokens: 48,
        },
      }),
    )

    await expect(
      createApiServicesWithDependencies(dependencies).divide({
        ...operationInput(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE',
      status: 502,
    })

    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        failureCode: 'provider_refused',
        providerResponseId: 'resp_abort_race',
        usage: expect.objectContaining({
          reported: true,
          inputTokens: 45,
          totalTokens: 48,
        }),
      }),
    )
    expect(dependencies.repository.failDivision).toHaveBeenCalledTimes(1)
  })

  it('leaves an ambiguous timeout in progress for lease reconciliation', async () => {
    vi.mocked(dependencies.divisionGenerator).mockRejectedValue(
      new APIConnectionTimeoutError(),
    )

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      status: 504,
    })

    expect(dependencies.usage.settleModelRequest).not.toHaveBeenCalled()
    expect(dependencies.repository.failDivision).not.toHaveBeenCalled()
    expect(dependencies.usage.releaseReservation).not.toHaveBeenCalled()
  })

  it('releases quota and marks the shell failed when setup fails before OpenAI', async () => {
    vi.mocked(dependencies.usage.attachModelRequestGame).mockResolvedValue({
      ok: false,
      code: 'GAME_LINK_CONFLICT',
      httpStatus: 409,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).divide(operationInput()),
    ).rejects.toBeInstanceOf(ApiError)

    expect(dependencies.usage.releaseReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'provider_not_started',
      }),
    )
    expect(dependencies.repository.failDivision).toHaveBeenCalledTimes(1)
    expect(dependencies.divisionGenerator).not.toHaveBeenCalled()
  })

  it('derives answer evidence only from the authoritative terminal replay', async () => {
    vi.mocked(dependencies.repository.storeAnswer).mockImplementation(
      async (input) => ({
        ...terminalSnapshot('answered'),
        revision: 4,
        answer: input.answer,
      }),
    )

    const result = await createApiServicesWithDependencies(
      dependencies,
    ).answer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      ipAddress: '203.0.113.17',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(result.answer).toEqual(STORED_ANSWER)
    const evidence = vi.mocked(dependencies.answerGenerator).mock.calls[0]?.[0]
    expect(evidence).toEqual({
      problem: PROBLEM,
      turnCount: 1,
      outcome: {
        winner: null,
        reason: 'no-moves',
        completedTurn: 1,
      },
      captures: [
        {
          turn: 1,
          resonance: 73,
          cell: { ring: 4, sector: 0 },
          attacker: { side: 'white', kind: 'rook' },
          captured: { side: 'black', kind: 'pawn' },
          part: PARTS[0],
        },
      ],
    })
    expect(JSON.stringify(evidence)).not.toContain('capture-private-id')
    expect(JSON.stringify(evidence)).not.toContain('Private narration')
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledBefore(
      vi.mocked(dependencies.repository.storeAnswer),
    )
  })

  it.each(['failed', 'indeterminate', 'rejected'] satisfies ModelRequestStatus[])(
    'transitions a pending answer to answer_failed for terminal ledger state %s',
    async (status) => {
      vi.mocked(dependencies.repository.getOwnedGame).mockResolvedValue(
        terminalSnapshot('answering'),
      )
      vi.mocked(
        dependencies.usage.getLatestModelRequestForGame,
      ).mockResolvedValue({
        found: true,
        requestId: REQUEST_ID,
        gameId: GAME_ID,
        operation: 'answer',
        status,
        resultPayload: null,
      })

      const game = await createApiServicesWithDependencies(
        dependencies,
      ).getGame({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      })

      expect(game.status).toBe('answer_failed')
      expect(dependencies.repository.failAnswer).toHaveBeenCalledTimes(1)
      expect(dependencies.answerGenerator).not.toHaveBeenCalled()
    },
  )

  it('recovers a succeeded answer payload during GET without another provider call', async () => {
    vi.mocked(dependencies.repository.getOwnedGame).mockResolvedValue(
      terminalSnapshot('answering'),
    )
    vi.mocked(dependencies.repository.storeAnswer).mockImplementation(
      async (input) => ({
        ...terminalSnapshot('answered'),
        answer: input.answer,
      }),
    )
    vi.mocked(
      dependencies.usage.getLatestModelRequestForGame,
    ).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: GAME_ID,
      operation: 'answer',
      status: 'succeeded',
      resultPayload: answerResultPayload() as unknown as ModelResultPayload,
    })

    const game = await createApiServicesWithDependencies(
      dependencies,
    ).getGame({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(game.status).toBe('answered')
    expect(game.answer).toEqual(STORED_ANSWER)
    expect(dependencies.answerGenerator).not.toHaveBeenCalled()
  })

  it('uses the succeeded answer winner when an idempotent duplicate was rejected', async () => {
    vi.mocked(dependencies.usage.reserveModelRequest).mockResolvedValue({
      ok: true,
      kind: 'existing',
      requestId: REQUEST_ID,
      gameId: GAME_ID,
      status: 'rejected',
      leaseToken: null,
      leaseExpiresAt: null,
    })
    vi.mocked(dependencies.usage.getModelRequestResult).mockResolvedValue({
      found: true,
      requestId: REQUEST_ID,
      gameId: GAME_ID,
      operation: 'answer',
      status: 'rejected',
      resultPayload: null,
    })
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockResolvedValue({
      found: true,
      requestId: '55555555-5555-4555-8555-555555555555',
      gameId: GAME_ID,
      operation: 'answer',
      status: 'succeeded',
      resultPayload: answerResultPayload() as unknown as ModelResultPayload,
    })
    vi.mocked(dependencies.repository.storeAnswer).mockImplementation(
      async (input) => ({
        ...terminalSnapshot('answered'),
        answer: input.answer,
      }),
    )

    const result = await createApiServicesWithDependencies(
      dependencies,
    ).answer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      ipAddress: '203.0.113.17',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(result.game.status).toBe('answered')
    expect(result.answer).toEqual(STORED_ANSWER)
    expect(
      dependencies.usage.getSucceededModelResultForGame,
    ).toHaveBeenCalledWith({
      userId: OWNER_ID,
      gameId: GAME_ID,
      operation: 'answer',
    })
    expect(dependencies.answerGenerator).not.toHaveBeenCalled()
  })

  it('does not recreate an answer after forced deletion wins during its provider call', async () => {
    vi.mocked(dependencies.repository.getTerminalReplay).mockResolvedValue(
      terminalSnapshot(),
    )
    vi.mocked(dependencies.usage.settleModelRequest).mockResolvedValue({
      ok: false,
      code: 'REQUEST_NOT_FOUND',
      httpStatus: 409,
    })
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockResolvedValue({ found: false })

    await expect(
      createApiServicesWithDependencies(dependencies).answer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 2,
        ipAddress: '203.0.113.17',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    })

    expect(dependencies.repository.storeAnswer).not.toHaveBeenCalled()
    expect(dependencies.repository.failAnswer).not.toHaveBeenCalled()
  })

  it('does not call the game repository when durable move throttling denies a move', async () => {
    vi.mocked(dependencies.usage.consumeGameMoveRate).mockResolvedValue({
      ok: false,
      code: 'GAME_MOVE_HOURLY_RATE_LIMITED',
      httpStatus: 429,
      retryAfterSeconds: 30,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).move({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 3,
        pieceId: 'white-pawn-0',
        to: { ring: 5, sector: 0 },
        ipAddress: '203.0.113.17',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 30,
    })
    expect(dependencies.repository.appendMove).not.toHaveBeenCalled()
  })

  it('hydrates the child created by the atomic replay accounting mutation', async () => {
    const order: string[] = []
    vi.mocked(
      dependencies.usage.consumeReplayGameStart,
    ).mockImplementation(async () => {
      order.push('consume')
      return {
        ok: true,
        kind: 'consumed',
        gameId: IDEMPOTENCY_KEY,
      }
    })
    vi.mocked(dependencies.repository.getOwnedGame).mockImplementation(
      async (_ownerId, gameId) => {
        order.push('get')
        return mappedSnapshot({
          id: gameId,
          sourceGameId: GAME_ID,
        })
      },
    )

    const replayed = await createApiServicesWithDependencies(
      dependencies,
    ).replay({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      ipAddress: '203.0.113.17',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(order).toEqual(['consume', 'get'])
    expect(replayed).toMatchObject({
      id: IDEMPOTENCY_KEY,
      sourceGameId: GAME_ID,
    })
    expect(dependencies.usage.consumeReplayGameStart).toHaveBeenCalledWith({
      userId: OWNER_ID,
      sourceGameId: GAME_ID,
      expectedRevision: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: '203.0.113.17',
    })
    expect(dependencies.repository.getOwnedGame).toHaveBeenCalledWith(
      OWNER_ID,
      IDEMPOTENCY_KEY,
    )
  })

  it('does not hydrate a replay child when the atomic mutation rejects stale source state', async () => {
    vi.mocked(
      dependencies.usage.consumeReplayGameStart,
    ).mockResolvedValue({
      ok: false,
      code: 'GAME_REVISION_CONFLICT',
      httpStatus: 409,
      retryAfterSeconds: null,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).replay({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 1,
        ipAddress: '203.0.113.17',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(dependencies.usage.consumeReplayGameStart).toHaveBeenCalledOnce()
    expect(dependencies.repository.getOwnedGame).not.toHaveBeenCalled()
  })

  it('keeps active self-service deletion fail-closed and makes forced cleanup idempotent', async () => {
    vi.mocked(dependencies.usage.deleteAccountData)
      .mockResolvedValueOnce({
        ok: false,
        code: 'ACTIVE_MODEL_REQUEST',
        httpStatus: 409,
        retryAfterSeconds: 75,
      })
      .mockResolvedValueOnce({
        ok: true,
        deleted: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        deleted: false,
      })
    const services = createApiServicesWithDependencies(dependencies)

    await expect(
      services.deleteAccountData({
        ownerId: OWNER_ID,
        ipAddress: '203.0.113.17',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      retryAfterSeconds: 75,
    })
    await services.handleClerkUserDeleted({
      clerkUserId: OWNER_ID,
      webhookEventId: 'msg_delete',
      requestId: REQUEST_ID,
    })
    await services.handleClerkUserDeleted({
      clerkUserId: OWNER_ID,
      webhookEventId: 'msg_delete_repeat',
      requestId: REQUEST_ID,
    })

    expect(dependencies.usage.deleteAccountData).toHaveBeenNthCalledWith(
      1,
      OWNER_ID,
    )
    expect(dependencies.usage.deleteAccountData).toHaveBeenNthCalledWith(
      2,
      OWNER_ID,
      { force: true },
    )
    expect(dependencies.usage.deleteAccountData).toHaveBeenNthCalledWith(
      3,
      OWNER_ID,
      { force: true },
    )
  })

  it('does not recreate account controls when usage is read after deletion', async () => {
    vi.mocked(dependencies.usage.getUsageSummary).mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
      retryAfterSeconds: null,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).getAccountUsage({
        ownerId: OWNER_ID,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })

  it('exports one private repeatable-read snapshot without rate identifiers or leases', async () => {
    vi.mocked(dependencies.database.transaction).mockResolvedValue([
      sqlResult([{
        estimatedBytes: String(dependencies.accountExportMaxBytes),
        exportAllowed: 'on',
      }]),
      sqlResult([{ suspended: false }]),
      sqlResult([{ id: GAME_ID, revision: '3' }]),
      sqlResult([{ gameId: GAME_ID, ply: 1 }]),
      sqlResult([{ id: REQUEST_ID, usageReported: false }]),
      sqlResult([{ metric: 'model_requests', used: '1' }]),
      sqlResult([{
        idempotencyKey: IDEMPOTENCY_KEY,
        kind: 'replay',
        sourceGameId: GAME_ID,
        activatedAt: NOW,
      }]),
    ])

    const exported = await createApiServicesWithDependencies(
      dependencies,
    ).exportAccount({
      ownerId: OWNER_ID,
      ipAddress: '203.0.113.17',
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(exported).toMatchObject({
      format: 'webchess-account-export/2',
      controls: { suspended: false },
      games: [{ id: GAME_ID, revision: '3' }],
      events: [{ gameId: GAME_ID, ply: 1 }],
      modelRequests: [{ id: REQUEST_ID, usageReported: false }],
      usageBuckets: [{ metric: 'model_requests', used: '1' }],
      gameStartRequests: [{
        idempotencyKey: IDEMPOTENCY_KEY,
        kind: 'replay',
        sourceGameId: GAME_ID,
        activatedAt: NOW.toISOString(),
      }],
    })
    expect(dependencies.usage.consumeAccountExportRate).toHaveBeenCalledWith({
      userId: OWNER_ID,
      ipAddress: '203.0.113.17',
    })
    expect(dependencies.database.transaction).toHaveBeenCalledWith(
      expect.any(Array),
      {
        isolationLevel: 'RepeatableRead',
        readOnly: true,
      },
    )
    const statements = vi.mocked(
      dependencies.database.transaction,
    ).mock.calls[0]?.[0]
    expect(statements).toHaveLength(14)
    expect(statements?.[0]?.text).toContain('pg_column_size')
    expect(statements?.[6]?.text).toContain(
      'activated_at AS "activatedAt"',
    )
    expect(statements?.[7]?.text).toContain('FROM lifecycle_runs')
    expect(statements?.[13]?.text).toContain('FROM lifecycle_events')
    expect(
      statements
        ?.slice(1)
        .every((statement) =>
          statement.text.includes('webchess.account_export_allowed'),
        ),
    ).toBe(true)
    expect(statements?.map((statement) => statement.text).join('\n'))
      .not.toMatch(/rate_buckets|lease_token|clerk_user_id AS/i)
  })

  it('does not read export rows when the durable export rate limit denies', async () => {
    vi.mocked(
      dependencies.usage.consumeAccountExportRate,
    ).mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_EXPORT_HOURLY_RATE_LIMITED',
      httpStatus: 429,
      retryAfterSeconds: 1800,
    })

    await expect(
      createApiServicesWithDependencies(dependencies).exportAccount({
        ownerId: OWNER_ID,
        ipAddress: '203.0.113.17',
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 1800,
    })
    expect(dependencies.database.transaction).not.toHaveBeenCalled()
  })

  it('rejects an oversized export before any owner rows are materialized', async () => {
    vi.mocked(dependencies.database.transaction).mockResolvedValue([
      sqlResult([{
        estimatedBytes: String(dependencies.accountExportMaxBytes + 1),
        exportAllowed: 'off',
      }]),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
    ])

    await expect(
      createApiServicesWithDependencies(dependencies).exportAccount({
        ownerId: OWNER_ID,
        ipAddress: '203.0.113.17',
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    })

    const statements = vi.mocked(
      dependencies.database.transaction,
    ).mock.calls[0]?.[0]
    expect(statements?.[0]?.values).toEqual([
      OWNER_ID,
      dependencies.accountExportMaxBytes,
    ])
    expect(
      statements
        ?.slice(1)
        .every((statement) => statement.text.includes('export_gate.allowed')),
    ).toBe(true)
  })

  it('enforces the byte cap on the final serialized export as a second guard', async () => {
    vi.mocked(dependencies.database.transaction).mockResolvedValue([
      sqlResult([{ estimatedBytes: '4096', exportAllowed: 'on' }]),
      sqlResult(),
      sqlResult([{ problem: 'x'.repeat(dependencies.accountExportMaxBytes) }]),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
    ])

    await expect(
      createApiServicesWithDependencies(dependencies).exportAccount({
        ownerId: OWNER_ID,
        ipAddress: '203.0.113.17',
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    })
  })

  it('runs Portia, commits the deterministic Gate, and authorizes Charlotte', async () => {
    dependencies = lifecycleDependencies()
    const services = createApiServicesWithDependencies(dependencies)

    const lifecycle = await services.runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(lifecycle).toMatchObject({
      state: 'charlotte_pending',
      portia: { contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract },
      gate: { passed: true, recommendedNextTransition: 'charlotte' },
    })
    expect(dependencies.portiaGenerator).toHaveBeenCalledWith(
      {
        problem: PROBLEM,
        survivors: LIFECYCLE_SURVIVORS,
      },
      expect.objectContaining({
        userId: OWNER_ID,
        apiKey: 'server-test-key',
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    )
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'succeeded',
        resultPayload: expect.objectContaining({
          format: 'webchess-portia-result/1',
        }),
      }),
    )
    expect(dependencies.lifecycleRepository?.storePortia).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.storeGate).toHaveBeenCalledOnce()
  })

  it('runs Charlotte only from a persisted passed Gate and stores its qualified answer', async () => {
    const portia = lifecycleReview()
    const gate = evaluateGate(portia)
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'charlotte_pending',
      portia,
      gate,
    }))

    const lifecycle = await createApiServicesWithDependencies(
      dependencies,
    ).runCharlotte({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(lifecycle).toMatchObject({
      state: 'charlotte_complete',
      charlotte: {
        contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
        exactlyThreeNextActions: expect.any(Array),
      },
    })
    expect(lifecycle.charlotte?.exactlyThreeNextActions).toHaveLength(3)
    expect(dependencies.charlotteGenerator).toHaveBeenCalledWith(
      { problem: PROBLEM, portia, gate },
      expect.objectContaining({
        userId: OWNER_ID,
        apiKey: 'server-test-key',
      }),
    )
    expect(dependencies.lifecycleRepository?.storeCharlotte)
      .toHaveBeenCalledWith(expect.objectContaining({
        modelRequestId: REQUEST_ID,
        renderedAnswer: expect.stringContaining('qualified evidence boundary'),
      }))
  })

  it('recovers persisted Portia output and returns completed Charlotte idempotently', async () => {
    const portia = lifecycleReview()
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'portia_complete',
      portia,
    }))
    const recovered = await createApiServicesWithDependencies(
      dependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(recovered.state).toBe('charlotte_pending')
    expect(dependencies.portiaGenerator).not.toHaveBeenCalled()
    expect(dependencies.usage.reserveModelRequest).not.toHaveBeenCalled()

    const gate = evaluateGate(portia)
    const charlotte = lifecycleCharlotte(portia)
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'charlotte_complete',
      portia,
      gate,
      charlotte,
      charlotteRenderedAnswer: 'The persisted Charlotte answer is already complete.',
    }))
    const completed = await createApiServicesWithDependencies(
      dependencies,
    ).runCharlotte({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(completed.charlotte).toEqual(charlotte)
    expect(dependencies.charlotteGenerator).not.toHaveBeenCalled()
  })

  it('enforces lifecycle authority and the bounded Retry outcomes', async () => {
    dependencies = createDependencies()
    await expect(
      createApiServicesWithDependencies(dependencies).getLifecycle({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    const failedPortia = {
      ...lifecycleReview(),
      assessments: [lifecycleReview().assessments[0]],
      recommendedGateInputs: {
        tensionCandidatePairs: [],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    }
    const failedGate = evaluateGate(failedPortia)
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'gate_failed',
      portia: failedPortia,
      gate: failedGate,
    }))
    const replayed = await createApiServicesWithDependencies(
      dependencies,
    ).retryLifecycle({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })
    expect(replayed.game).not.toBeNull()
    expect(replayed.lifecycle).toMatchObject({
      state: 'chess_ready',
      sameFieldRetryCount: 1,
    })
    expect(dependencies.usage.consumeReplayGameStart).toHaveBeenCalledOnce()

    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'gate_failed',
      portia: failedPortia,
      gate: failedGate,
      sameFieldRetryCount: 2,
      fieldRegenerationCount: 1,
    }))
    const exhausted = await createApiServicesWithDependencies(
      dependencies,
    ).retryLifecycle({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })
    expect(exhausted.game).toBeNull()
    expect(exhausted.lifecycle.state).toBe('insufficient_basis')
    expect(dependencies.usage.reserveModelRequest).not.toHaveBeenCalled()
  })

  it('delegates owner-scoped Wilbur actions, statuses, observations, and provenance', async () => {
    const portia = lifecycleReview()
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'charlotte_complete',
      portia,
      gate: evaluateGate(portia),
      charlotte: lifecycleCharlotte(portia),
      activities: [{
        id: 'activity-1',
        sequence: 1,
        stage: 'charlotte',
        activityType: 'synthesis_completed',
        stateFrom: 'charlotte_running',
        stateTo: 'charlotte_complete',
        inputEntityIds: [],
        outputEntityIds: [],
        responsibleAgentIds: ['charlotte'],
        configurationDigest: 'a'.repeat(64),
        status: 'completed',
        eventVersion: 1,
        createdAt: NOW.toISOString(),
      }],
    }))
    const services = createApiServicesWithDependencies(dependencies)
    const context = {
      ...operationInput(),
      gameId: GAME_ID,
    }

    const created = await services.createWilburAction({
      ...context,
      charlotteActionIndex: 0,
      actor: 'The accountable owner',
      action: 'Run one bounded test.',
      testedAssumption: 'The test can produce useful evidence.',
      expectedObservation: 'A direct signal appears.',
      decisionThreshold: 'Continue only if the signal appears safely.',
      reviewHorizon: 'Within fourteen days',
    })
    const updated = await services.updateWilburAction({
      ...context,
      actionId: created.id,
      expectedRevision: created.revision,
      status: 'in_progress',
    })
    const observed = await services.appendWilburObservation({
      ...context,
      actionId: created.id,
      observedAt: NOW.toISOString(),
      observation: 'The bounded test produced one direct signal.',
      evidenceClassification: 'Direct observation by the accountable owner.',
      expectedEffect: 'A direct signal appears.',
      unexpectedEffect: 'No unexpected effect was recorded.',
      stakeholderResponse: 'Affected participants retained the stop path.',
      assumptionResult: 'supported',
      nextDecision: 'Continue only inside the original bounded scope.',
    })
    const provenance = await services.getProvenance({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(created.status).toBe('planned')
    expect(updated.status).toBe('in_progress')
    expect(observed.assumptionResult).toBe('supported')
    expect(provenance).toHaveLength(1)
    expect(dependencies.lifecycleRepository?.createWilburAction)
      .toHaveBeenCalledWith(expect.objectContaining({
        ownerId: OWNER_ID,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }))
    expect(dependencies.lifecycleRepository?.appendWilburObservation)
      .toHaveBeenCalledWith(expect.objectContaining({
        assumptionResult: 'supported',
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }))
  })
})

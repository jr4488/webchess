// @vitest-environment node

import { createHash } from 'node:crypto'

import { APIConnectionTimeoutError } from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../lib/game-contract'
import { composeProblemParts } from '../../lib/division'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  evaluateGate,
  PORTIA_ATTACK_TYPES,
  terminalFingerprint,
} from '../../lib/lifecycle'
import type {
  CharlotteResult,
  LifecycleAggregate,
  PortiaCandidateAssessment,
  PortiaReview,
  SurvivorCandidate,
  WebMemoryEvidence,
} from '../../lib/lifecycle'
import { makeProblemFacets } from '../../test/fixtures'
import type { CaptureRecord, GeneratedAnswer } from '../../types'
import { hashCanonicalJson } from '../db'
import type { CanonicalJson, SqlAdapter, SqlResult, SqlRow } from '../db'
import {
  GameRepositoryError,
  type DurableGameSnapshot,
  type TerminalGameSnapshot,
} from '../games'
import {
  LifecycleRepositoryError,
  type LifecycleRepositoryPort,
} from '../lifecycle'
import { OpenClawAnswerContractError } from '../openclaw/errors'
import {
  buildBoardAnswerPromptPackage,
  DIVISION_PROMPT_VERSION,
  ModelContractError,
  ModelResponseError,
  normalizeDivisionRepairContext,
  OPENAI_MODEL,
} from '../openai'
import type { PortiaInput, PortiaRequestContext } from '../openai'
import {
  hashUserRateKey,
  type ModelResultPayload,
  type ModelRequestStatus,
  type UsageController,
} from '../usage'
import { ApiError } from './errors'
import {
  createApiServicesWithDependencies,
  normalizeAccountExportMaxBytes,
  normalizeSoftwareVersion,
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
const WEB_MEMORY_OBSERVATION_ID = 'a1000000-0000-4000-8000-000000000001'

function webMemoryEvidence(attachedAt: string | null): WebMemoryEvidence {
  return {
    observationId: WEB_MEMORY_OBSERVATION_ID,
    sourceGameId: 'a1000000-0000-4000-8000-000000000002',
    sourceActionId: 'a1000000-0000-4000-8000-000000000003',
    sourceProblem: 'How can a bounded trial generate useful direct evidence?',
    action: 'Run one limited observation without expanding the scope.',
    testedAssumption: 'A reversible trial can produce a useful signal safely.',
    expectedObservation: 'A measurable signal appears inside the review horizon.',
    observedAt: NOW.toISOString(),
    observation: 'The signal improved while participants retained an opt-out.',
    evidenceClassification: 'Measured result',
    expectedEffect: 'A measurable signal appears inside the review horizon.',
    unexpectedEffect: 'One participant needed a longer explanation.',
    stakeholderResponse: 'Participants retained agency and reported no lasting harm.',
    assumptionResult: 'supported',
    nextDecision: 'Repeat once with broader stakeholder review before scaling.',
    selectionOrdinal: 0,
    consentVersion: 'webchess-web-memory-consent-v1',
    attachedAt,
  }
}

const STORED_ANSWER: GeneratedAnswer = {
  answer:
    'Use the durable board evidence to make one reversible next move, then compare the observed result with the stated threshold before expanding the commitment.',
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
    answer: status === 'answered' ? STORED_ANSWER : null,
    completedAt: NOW,
    answeredAt: status === 'answered' ? NOW : null,
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

function approvedAnswerResultPayload(lifecycle: LifecycleAggregate) {
  if (!lifecycle.answerPromptDigest || !lifecycle.gate) {
    throw new Error('Approved answer fixtures require Portia and Gate provenance.')
  }
  return {
    format: 'webchess-answer-result/2' as const,
    answer: STORED_ANSWER,
    approval: {
      lifecycleRunId: lifecycle.id,
      reviewedPromptDigest: lifecycle.answerPromptDigest,
      gateInputDigest: lifecycle.gate.inputDigest,
    },
  }
}

type CharlotteSourceOverrides = Partial<{
  lifecycleRunId: string
  boardAnswerDigest: string
  reviewedPromptDigest: string
  gateInputDigest: string
}>

function approvedCharlotteResultPayload(
  lifecycle: LifecycleAggregate,
  sourceOverrides: CharlotteSourceOverrides = {},
) {
  if (!lifecycle.answerPromptDigest || !lifecycle.gate || !lifecycle.portia) {
    throw new Error('Approved Charlotte fixtures require complete lifecycle provenance.')
  }
  return {
    format: 'webchess-charlotte-result/3' as const,
    structured: lifecycleCharlotte(lifecycle.portia as PortiaReview),
    renderedAnswer: 'Charlotte preserves the qualified evidence boundary. '.repeat(12),
    wordCount: 500,
    source: {
      lifecycleRunId: lifecycle.id,
      boardAnswerDigest: hashCanonicalJson(
        STORED_ANSWER as unknown as CanonicalJson,
      ),
      reviewedPromptDigest: lifecycle.answerPromptDigest,
      gateInputDigest: lifecycle.gate.inputDigest,
      ...sourceOverrides,
    },
  }
}

function legacyCharlotteResultPayload(portia: PortiaReview) {
  return {
    format: 'webchess-charlotte-result/1' as const,
    structured: lifecycleCharlotte(portia),
    renderedAnswer: 'Charlotte preserves the qualified evidence boundary. '.repeat(12),
    wordCount: 500,
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
    consumeWilburMutationRate: vi.fn(async () => ({
      ok: true as const,
      kind: 'consumed' as const,
      remaining: { user: 59, ip: 119 },
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
    wilburStorageRowLimit: 500,
    wilburStorageTextBytesLimit: 250_000,
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

function terminalAnswerPromptDigest(): string {
  const recordedCapture = capture()
  return hashCanonicalJson(buildBoardAnswerPromptPackage(
    {
      problem: PROBLEM,
      turnCount: 1,
      outcome: {
        winner: null,
        reason: 'no-moves',
        completedTurn: 1,
      },
      captures: [{
        turn: 1,
        resonance: 73,
        cell: { ring: 4, sector: 0 },
        attacker: { side: 'white', kind: 'rook' },
        captured: { side: 'black', kind: 'pawn' },
        part: recordedCapture.part,
      }],
    },
    LIFECYCLE_SURVIVORS,
    terminalFingerprint(LIFECYCLE_SURVIVORS),
  ) as unknown as CanonicalJson)
}

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
      outcome: index === 1 ? 'qualified' : 'passed',
      severity: index === 1 ? 'moderate' : 'low',
      finding: `The ${attackType} attack identifies a bounded uncertainty.`,
      consequence: 'Preserve uncertainty and a credible stopping rule.',
      requiredRevision: null,
    })),
  }
}

function lifecycleReview(
  answerPromptDigest = terminalAnswerPromptDigest(),
): PortiaReview {
  const assessments = LIFECYCLE_SURVIVORS.map(lifecycleAssessment)
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    reviewedAnswerPromptDigest: answerPromptDigest,
    promptDecision: 'permit',
    promptDecisionRationale:
      'The exact board-derived prompt is reasonable under the retained qualifications.',
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

function exhaustedLifecycleReview(): PortiaReview {
  const portia = lifecycleReview()
  return {
    ...portia,
    assessments: portia.assessments.map((assessment) => ({
      ...assessment,
      disposition: 'consumed',
      survivingInterpretation: null,
      requiredQualification: null,
    })),
    missingCoverage: ['agency_or_action'],
    recommendedGateInputs: {
      ...portia.recommendedGateInputs,
      fieldRepairReasons: [
        'The prior semantic field did not produce an independent action path.',
      ],
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
    terminalFingerprint: terminalFingerprint(LIFECYCLE_SURVIVORS),
    answerPromptDigest: null,
    answerUserPrompt: null,
    answerUserPromptSha256: null,
    survivors: LIFECYCLE_SURVIVORS,
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
    charlotteFailedAttemptCount: 0,
    charlotteFailureLimit: 3,
    charlotte: null,
    charlotteRenderedAnswer: null,
    wilburActions: [],
    wilburObservations: [],
    versions: {
      software: CURRENT_LIFECYCLE_VERSIONS.software,
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
    research: overrides.research ?? [],
    webMemoryEvidence: overrides.webMemoryEvidence ?? [],
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
    beginPortiaAttempt: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'portia_running',
        portiaActiveModelRequestId: input.modelRequestId,
        answerPromptDigest:
          current.answerPromptDigest ?? input.answerPromptDigest,
        portiaProgress: {
          ...current.portiaProgress,
          currentCandidateId: null,
        },
      }
      return current
    }),
    updatePortiaProgress: vi.fn(async (input) => {
      current = {
        ...current,
        answerPromptDigest: input.answerPromptDigest,
        portiaProgress: {
          currentCandidateId: input.currentCandidateId,
          completedCandidateIds: input.completedCandidateIds,
          completedAssessments: input.completedAssessments,
        },
      }
      return current
    }),
    failPortiaAttempt: vi.fn(async () => {
      const failedAttemptCount = current.portiaFailedAttemptCount + 1
      const exhausted = failedAttemptCount >= current.portiaFailureLimit
      current = {
        ...current,
        revision: current.revision + 1,
        state: exhausted ? 'portia_unavailable' : 'portia_pending',
        portiaActiveModelRequestId: null,
        portiaFailedAttemptCount: failedAttemptCount,
        portiaProgress: {
          ...current.portiaProgress,
          currentCandidateId: exhausted
            ? current.portiaProgress.currentCandidateId
            : null,
        },
      }
      return current
    }),
    storePortia: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'portia_complete',
        portiaActiveModelRequestId: null,
        portia: input.review,
        answerPromptDigest: input.review.reviewedAnswerPromptDigest,
        portiaProgress: {
          currentCandidateId: null,
          completedCandidateIds: current.survivors.map(
            (candidate) => candidate.candidateId,
          ),
          completedAssessments: input.review.assessments,
        },
      }
      return current
    }),
    storeGate: vi.fn(async (input) => {
      const targetState = input.result.passed ? 'gate_passed' : 'gate_failed'
      const extendsHistoricalGate =
        current.state === targetState &&
        current.gate?.inputDigest === input.result.inputDigest &&
        current.answerUserPrompt === null &&
        current.answerUserPromptSha256 === null &&
        input.answerUserPrompt !== null
      current = {
        ...current,
        revision: current.revision + (extendsHistoricalGate ? 0 : 1),
        state: targetState,
        gate: input.result,
        answerUserPrompt: input.answerUserPrompt,
        answerUserPromptSha256: input.answerUserPrompt === null
          ? null
          : createHash('sha256').update(input.answerUserPrompt, 'utf8').digest('hex'),
      }
      return current
    }),
    beginCharlotteAttempt: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'charlotte_running',
        charlotteActiveModelRequestId: input.modelRequestId,
      }
      return current
    }),
    failCharlotteAttempt: vi.fn(async () => {
      const failedAttemptCount = current.charlotteFailedAttemptCount + 1
      const exhausted = failedAttemptCount >= current.charlotteFailureLimit
      current = {
        ...current,
        revision: current.revision + 1,
        state: exhausted ? 'charlotte_unavailable' : 'charlotte_pending',
        charlotteActiveModelRequestId: null,
        charlotteFailedAttemptCount: failedAttemptCount,
      }
      return current
    }),
    storeCharlotte: vi.fn(async (input) => {
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'charlotte_complete',
        charlotteActiveModelRequestId: null,
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
    claimWilburMutation: vi.fn(async () => ({ kind: 'pending' as const })),
    settleWilburMutationConflict: vi.fn(async () => undefined),
    createWilburAction: vi.fn(async (input) => {
      const action = {
        id: input.id,
        lifecycleRunId: current.id,
        charlotteActionIndex: input.charlotteActionIndex,
        charlotteBindingVersion:
          'webchess-charlotte-action-binding-v1' as const,
        actor: input.actor,
        action: input.action,
        testedAssumption: input.testedAssumption,
        expectedObservation: input.expectedObservation,
        decisionThreshold: input.decisionThreshold,
        reviewHorizon: input.reviewHorizon,
        followUpAt: input.followUpAt ?? null,
        status: 'planned' as const,
        revision: 0,
        version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }
      current = {
        ...current,
        state: 'wilbur_planning',
        wilburActions: [...current.wilburActions, action],
      }
      return action
    }),
    updateWilburAction: vi.fn(async (input) => {
      const existing = current.wilburActions.find(
        (action) => action.id === input.actionId,
      )
      if (!existing) throw new Error('Wilbur action fixture not found.')
      const action = {
        ...existing,
        status: input.status,
        followUpAt: input.followUpAt ?? null,
        revision: input.expectedRevision + 1,
        updatedAt: NOW.toISOString(),
      }
      current = {
        ...current,
        state: input.status === 'in_progress'
          ? 'wilbur_in_progress'
          : current.state,
        wilburActions: current.wilburActions.map((candidate) =>
          candidate.id === action.id ? action : candidate),
      }
      return action
    }),
    appendWilburObservation: vi.fn(async (input) => {
      const observation = {
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
      }
      current = {
        ...current,
        state: 'wilbur_observed',
        wilburObservations: [...current.wilburObservations, observation],
      }
      return observation
    }),
    listWebMemory: vi.fn(async () => ({ cases: [], carriedObservationIds: [] })),
    getWebMemoryEvidence: vi.fn(async () => []),
    getWebMemoryEvidenceForGame: vi.fn(async () => []),
    attachWebMemoryEvidence: vi.fn(async () => undefined),
  }
  return repository
}

function lifecycleDependencies(
  initial = lifecycleAggregate(),
): ApiServiceAdapterDependencies {
  const dependencies = createDependencies()
  const portiaGenerator = vi.fn(async (
    input: PortiaInput,
    context: PortiaRequestContext,
  ) => {
    const result = lifecycleReview(input.answerPromptDigest)
    await context.onProgress?.({
      currentCandidateId: null,
      completedCandidateIds: input.survivors.map(
        (candidate) => candidate.candidateId,
      ),
      completedAssessments: result.assessments,
      totalCandidateCount: input.survivors.length,
    })
    return {
      providerId: 'resp_portia',
      model: OPENAI_MODEL,
      prompt: 'Canonical Portia prompt.',
      result,
      usage: {
        reported: true,
        inputTokens: 300,
        outputTokens: 120,
        totalTokens: 450,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 0,
        reasoningOutputTokens: 30,
      },
    }
  })
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

function arrangeRecoveredCharlotteWinner(
  dependencies: ApiServiceAdapterDependencies,
  lifecycle: LifecycleAggregate,
  charlottePayload: unknown,
): void {
  vi.mocked(dependencies.repository.getTerminalReplay).mockResolvedValue(
    terminalSnapshot('answered'),
  )
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
    operation: 'charlotte',
    status: 'rejected',
    resultPayload: null,
  })
  vi.mocked(
    dependencies.usage.getSucceededModelResultForGame,
  ).mockImplementation(async (input) => ({
    found: true,
    requestId: input.operation === 'answer'
      ? '77777777-7777-4777-8777-777777777777'
      : '88888888-8888-4888-8888-888888888888',
    gameId: GAME_ID,
    operation: input.operation,
    status: 'succeeded',
    resultPayload: (input.operation === 'answer'
      ? approvedAnswerResultPayload(lifecycle)
      : charlottePayload
    ) as ModelResultPayload,
  }))
}

describe('durable HTTP service adapter', () => {
  let dependencies: ApiServiceAdapterDependencies

  beforeEach(() => {
    dependencies = createDependencies()
  })

  it('bounds the configured synchronous account export size at 100 MB', () => {
    expect(normalizeAccountExportMaxBytes(undefined)).toBe(3_000_000)
    expect(normalizeAccountExportMaxBytes('100000000')).toBe(100_000_000)

    for (const invalid of ['0', '100000001', '1.5', 'not-a-number']) {
      expect(() => normalizeAccountExportMaxBytes(invalid)).toThrow(
        'must be between 1 and 100000000 bytes',
      )
    }
  })

  it('uses the canonical candidate identity for fallback provenance', () => {
    expect(normalizeSoftwareVersion(undefined)).toBe('webchess@2.2.0-rc.1')
    expect(normalizeSoftwareVersion('   ')).toBe('webchess@2.2.0-rc.1')
    expect(normalizeSoftwareVersion('deployment-sha')).toBe('deployment-sha')
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

  it('uses the durable game id as the initial lifecycle trajectory seed', async () => {
    dependencies = lifecycleDependencies()

    await createApiServicesWithDependencies(dependencies).divide(
      operationInput(),
    )

    expect(dependencies.lifecycleRepository?.ensureForGame).toHaveBeenCalledWith(
      expect.objectContaining({
        game: expect.objectContaining({ id: REQUEST_ID }),
        trajectorySeed: REQUEST_ID,
      }),
    )
  })

  it('owner-checks, links, and supplies explicitly selected Web memory to Division', async () => {
    dependencies = lifecycleDependencies()
    const evidence = webMemoryEvidence(null)
    vi.mocked(
      dependencies.lifecycleRepository!.getWebMemoryEvidence,
    ).mockResolvedValue([evidence])

    await createApiServicesWithDependencies(dependencies).divide({
      ...operationInput(),
      memoryObservationIds: [WEB_MEMORY_OBSERVATION_ID],
    })

    expect(
      dependencies.lifecycleRepository?.getWebMemoryEvidence,
    ).toHaveBeenCalledWith(OWNER_ID, [WEB_MEMORY_OBSERVATION_ID])
    expect(
      dependencies.lifecycleRepository?.attachWebMemoryEvidence,
    ).toHaveBeenCalledWith(OWNER_ID, REQUEST_ID, [WEB_MEMORY_OBSERVATION_ID])
    expect(dependencies.divisionGenerator).toHaveBeenCalledWith(
      { problem: PROBLEM, webMemoryEvidence: [evidence] },
      expect.objectContaining({ userId: OWNER_ID }),
    )
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

  it('settles a terminal corrective Answer failure and exposes only its safe prompt', async () => {
    const publicPrompt = [
      'SYSTEM ROLE',
      'CORRECTION REQUIRED',
      'Verified board evidence only.',
    ].join('\n\n')
    vi.mocked(dependencies.answerGenerator).mockRejectedValue(
      new OpenClawAnswerContractError(publicPrompt),
    )

    await expect(createApiServicesWithDependencies(dependencies).answer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      ipAddress: '203.0.113.17',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE',
      status: 502,
      publicPrompt,
    })

    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        failureCode: 'provider_contract_invalid',
      }),
    )
    expect(dependencies.repository.failAnswer).toHaveBeenCalledOnce()
    expect(dependencies.repository.storeAnswer).not.toHaveBeenCalled()
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
    ).toHaveBeenCalledWith(expect.objectContaining({
      userId: OWNER_ID,
      gameId: GAME_ID,
      operation: 'answer',
      requestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      promptVersion: expect.any(String),
    }))
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
      sqlResult([{
        id: '55555555-5555-4555-8555-555555555555',
        answerPromptDigest: 'c'.repeat(64),
        portiaCurrentCandidateId: LIFECYCLE_SURVIVORS[0]!.candidateId,
        portiaActiveModelRequestId: '77777777-7777-4777-8777-777777777777',
        portiaFailedAttemptCount: 1,
        portiaFailureLimit: 3,
        portiaCompletedCandidateIds: [LIFECYCLE_SURVIVORS[0]!.candidateId],
        portiaAssessmentDrafts: [{ candidateId: LIFECYCLE_SURVIVORS[0]!.candidateId }],
        charlotteActiveModelRequestId: '88888888-8888-4888-8888-888888888888',
        charlotteFailedAttemptCount: 2,
        charlotteFailureLimit: 3,
      }]),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult(),
      sqlResult([{
        idempotencyKey: IDEMPOTENCY_KEY,
        operation: 'create_action',
        requestDigest: 'd'.repeat(64),
        targetGameId: GAME_ID,
        targetActionId: null,
        rateKind: 'action',
        rateAdmittedAt: NOW,
        denialCode: null,
        retryAt: null,
        status: 'committed',
        resultEntityId: '99999999-9999-4999-8999-999999999999',
        resultRevision: '0',
        resultStatus: 'planned',
        resultUpdatedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }]),
      sqlResult(),
      sqlResult([{
        action: 'wilbur_action',
        windowStart: NOW,
        windowSeconds: 3_600,
        count: 2,
        expiresAt: new Date('2026-07-26T22:00:00.000Z'),
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
      format: 'webchess-account-export/4',
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
      lifecycleRuns: [{
        answerPromptDigest: 'c'.repeat(64),
        portiaCurrentCandidateId: LIFECYCLE_SURVIVORS[0]!.candidateId,
        portiaActiveModelRequestId: '77777777-7777-4777-8777-777777777777',
        portiaFailedAttemptCount: 1,
        portiaFailureLimit: 3,
        portiaCompletedCandidateIds: [LIFECYCLE_SURVIVORS[0]!.candidateId],
        portiaAssessmentDrafts: [{ candidateId: LIFECYCLE_SURVIVORS[0]!.candidateId }],
        charlotteActiveModelRequestId: '88888888-8888-4888-8888-888888888888',
        charlotteFailedAttemptCount: 2,
        charlotteFailureLimit: 3,
      }],
      wilburMutationRequests: [{
        idempotencyKey: IDEMPOTENCY_KEY,
        operation: 'create_action',
        requestDigest: 'd'.repeat(64),
        targetGameId: GAME_ID,
        rateKind: 'action',
        status: 'committed',
        resultRevision: '0',
        resultStatus: 'planned',
      }],
      userRateBuckets: [{
        action: 'wilbur_action',
        windowStart: NOW.toISOString(),
        windowSeconds: 3_600,
        count: 2,
        expiresAt: '2026-07-26T22:00:00.000Z',
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
    expect(statements).toHaveLength(19)
    expect(statements?.[0]?.text).toContain('pg_column_size')
    expect(statements?.[0]?.text).toContain(
      'FROM wilbur_mutation_requests AS mutations',
    )
    expect(statements?.[0]?.text).toContain(
      'FROM web_memory_links AS memory_links',
    )
    expect(statements?.[0]?.values).toEqual([
      OWNER_ID,
      dependencies.accountExportMaxBytes,
      hashUserRateKey(dependencies.hmacSecret, OWNER_ID),
    ])
    expect(statements?.[6]?.text).toContain(
      'activated_at AS "activatedAt"',
    )
    expect(statements?.[7]?.text).toContain('FROM lifecycle_runs')
    expect(statements?.[8]?.text).toContain('FROM research_requests')
    expect(statements?.[9]?.text).toContain('FROM research_sources')
    expect(statements?.[13]?.text).toContain('follow_up_at AS "followUpAt"')
    expect(statements?.[14]?.text).toContain('FROM web_memory_links')
    expect(statements?.[14]?.text).toContain(
      'selection_ordinal AS "selectionOrdinal"',
    )
    expect(statements?.[14]?.text).toContain(
      'consent_version AS "consentVersion"',
    )
    expect(statements?.[15]?.text).toContain('FROM wilbur_observations')
    expect(statements?.[16]?.text).toContain('FROM wilbur_mutation_requests')
    expect(statements?.[16]?.text).not.toMatch(
      /reserved_future_rows|reserved_text_bytes/u,
    )
    expect(statements?.[16]?.text).toContain('result_follow_up_at')
    expect(statements?.[17]?.text).toContain('FROM lifecycle_events')
    for (const alias of [
      'answerPromptDigest',
      'portiaCurrentCandidateId',
      'portiaActiveModelRequestId',
      'portiaFailedAttemptCount',
      'portiaFailureLimit',
      'portiaCompletedCandidateIds',
      'portiaAssessmentDrafts',
      'charlotteActiveModelRequestId',
      'charlotteFailedAttemptCount',
      'charlotteFailureLimit',
    ]) {
      expect(statements?.[7]?.text).toContain(`AS "${alias}"`)
    }
    expect(statements?.[18]?.text).toContain('FROM rate_buckets')
    expect(statements?.[18]?.text).toContain("key_type = 'user'")
    expect(statements?.[18]?.text.match(/\bcount\b/gu)).toHaveLength(1)
    expect(statements?.[18]?.values).toEqual([
      hashUserRateKey(dependencies.hmacSecret, OWNER_ID),
    ])
    expect(
      statements
        ?.slice(1)
        .every((statement) =>
          statement.text.includes('webchess.account_export_allowed'),
        ),
    ).toBe(true)
    expect(statements?.map((statement) => statement.text).join('\n'))
      .not.toMatch(/lease_token|clerk_user_id AS/i)
    const exportedRateBuckets = (exported as {
      readonly userRateBuckets: readonly Record<string, unknown>[]
    }).userRateBuckets
    expect(exportedRateBuckets[0]).not.toHaveProperty('keyHash')
    expect(exportedRateBuckets[0]).not.toHaveProperty('keyType')
    const exportedMutationRequests = (exported as {
      readonly wilburMutationRequests: readonly Record<string, unknown>[]
    }).wilburMutationRequests
    expect(exportedMutationRequests[0]).not.toHaveProperty(
      'reservedFutureRows',
    )
    expect(exportedMutationRequests[0]).not.toHaveProperty(
      'reservedTextBytes',
    )
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
      hashUserRateKey(dependencies.hmacSecret, OWNER_ID),
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

  it('runs Portia, commits the deterministic Gate, and authorizes board answer generation', async () => {
    dependencies = lifecycleDependencies()
    const services = createApiServicesWithDependencies(dependencies)

    const lifecycle = await services.runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(lifecycle).toMatchObject({
      state: 'gate_passed',
      portia: { contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract },
      gate: { passed: true, recommendedNextTransition: 'answer' },
      answerPromptDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      answerUserPrompt: expect.stringContaining('"reviewed_prompt"'),
      answerUserPromptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      portiaProgress: {
        currentCandidateId: null,
        completedCandidateIds: LIFECYCLE_SURVIVORS.map(
          (candidate) => candidate.candidateId,
        ),
      },
    })
    expect(dependencies.portiaGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        problem: PROBLEM,
        survivors: LIFECYCLE_SURVIVORS,
        answerPromptPackage: expect.objectContaining({
          promptVersion: 'webchess-answer-v3',
          evidence: expect.objectContaining({ problem: PROBLEM }),
        }),
        answerPromptDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
      expect.objectContaining({
        userId: OWNER_ID,
        apiKey: 'server-test-key',
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
        onProgress: expect.any(Function),
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
    expect(dependencies.lifecycleRepository?.storeGate).toHaveBeenCalledWith(
      expect.objectContaining({
        answerUserPrompt: lifecycle.answerUserPrompt,
      }),
    )
    expect(lifecycle.answerUserPrompt).toContain(PROBLEM)
    expect(lifecycle.answerUserPrompt).toContain('"portia_authorization"')
    expect(lifecycle.answerUserPrompt).toContain('"gate"')
    expect(lifecycle.answerUserPrompt).not.toContain('PORTIA AUTHORIZATION BOUNDARY')
    expect(lifecycle.answerUserPrompt).not.toContain('OUTPUT CONTRACT')
    expect(lifecycle.answerUserPrompt).not.toContain('server-test-key')
  })

  it('safely backfills the exact player-visible prompt for an unfinished historical Gate pass', async () => {
    const primingDependencies = lifecycleDependencies()
    const approved = await createApiServicesWithDependencies(
      primingDependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })
    if (!approved.portia || !approved.gate || !approved.answerPromptDigest) {
      throw new Error('The primed lifecycle is missing its approval provenance.')
    }
    const historicalRevision = approved.revision
    dependencies = lifecycleDependencies(lifecycleAggregate({
      ...approved,
      answerUserPrompt: null,
      answerUserPromptSha256: null,
    }))
    vi.mocked(dependencies.repository.storeAnswer).mockImplementation(
      async (input) => ({
        ...terminalSnapshot('answered'),
        revision: 4,
        answer: input.answer,
      }),
    )

    const result = await createApiServicesWithDependencies(dependencies).answer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      ipAddress: '203.0.113.17',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(result.answer).toEqual(STORED_ANSWER)
    expect(dependencies.lifecycleRepository?.storeGate).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.storeGate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: historicalRevision,
        result: approved.gate,
        answerUserPrompt: expect.stringContaining(PROBLEM),
      }),
    )
    const backfilled = await dependencies.lifecycleRepository?.getForGame(
      OWNER_ID,
      GAME_ID,
    )
    expect(backfilled).toMatchObject({
      revision: historicalRevision,
      state: 'gate_passed',
      answerUserPrompt: expect.stringContaining('"reviewed_prompt"'),
      answerUserPromptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(dependencies.answerGenerator).toHaveBeenCalledOnce()
  })

  it('rejects an already-answered current run when its persisted player-visible prompt was changed', async () => {
    const primingDependencies = lifecycleDependencies()
    const approved = await createApiServicesWithDependencies(
      primingDependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })
    dependencies = lifecycleDependencies(lifecycleAggregate({
      ...approved,
      answerUserPrompt: '{"tampered":true}',
      answerUserPromptSha256: createHash('sha256')
        .update('{"tampered":true}', 'utf8')
        .digest('hex'),
    }))
    vi.mocked(dependencies.repository.getTerminalReplay).mockResolvedValue(
      terminalSnapshot('answered'),
    )

    await expect(createApiServicesWithDependencies(dependencies).answer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      ipAddress: '203.0.113.17',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(dependencies.lifecycleRepository?.storeGate).not.toHaveBeenCalled()
    expect(dependencies.answerGenerator).not.toHaveBeenCalled()
  })

  it('binds visible Codex research into the exact prompt before Portia adjudicates it', async () => {
    const researchRecord = {
      id: '91919191-9191-4191-8191-919191919191',
      lifecycleRunId: '55555555-5555-4555-8555-555555555555',
      gameId: GAME_ID,
      stage: 'portia' as const,
      requestedBy: 'research-policy' as const,
      policyVersion: 'webchess-visible-research-v1',
      materiality: 'required' as const,
      reason: 'Portia needs current external evidence before reviewing this exact board-derived prompt.',
      query: `${PROBLEM} current authoritative evidence`,
      status: 'completed' as const,
      provider: 'codex' as const,
      transport: 'local' as const,
      model: 'gpt-5.6-sol',
      bounds: {
        invocationLimit: 1 as const,
        resultLimit: 5,
        sourceLimit: 5,
        timeoutMs: 45_000,
        synthesisCharacterLimit: 12_000,
      },
      attemptCount: 1,
      executedQueries: [`${PROBLEM} current authoritative evidence`],
      searchSynthesis:
        'Codex Search found current source links. This remains model-generated synthesis for Portia to assess.',
      directPageTextFetched: false as const,
      retrievedFacts: [] as const,
      sources: [{
        id: '92929292-9292-4292-8292-929292929292',
        citationId: 'R1',
        ordinal: 1,
        title: 'Current primary source',
        url: 'https://example.gov/current-source',
        hostname: 'example.gov',
        trust: 'government_or_education' as const,
        discoveredFrom: 'synthesis_link' as const,
        createdAt: NOW.toISOString(),
      }],
      omittedSourceCount: 0,
      injectionSignalsDetected: [],
      contentDigest: '9'.repeat(64),
      failureCode: null,
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }
    dependencies = lifecycleDependencies(lifecycleAggregate({
      research: [researchRecord],
    }))
    dependencies = {
      ...dependencies,
      researchBroker: {
        ensureForStage: vi.fn(async () => researchRecord),
        getForGame: vi.fn(async () => [researchRecord]),
      },
    }

    const completed = await createApiServicesWithDependencies(
      dependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(dependencies.researchBroker?.ensureForStage).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      lifecycleRunId: researchRecord.lifecycleRunId,
      lifecycleState: 'portia_pending',
      stage: 'portia',
      problem: PROBLEM,
    })
    expect(dependencies.portiaGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        answerPromptPackage: expect.objectContaining({
          researchEvidence: [expect.objectContaining({
            recordId: researchRecord.id,
            status: 'completed',
            provider: 'codex',
            contentKind: 'model_generated_search_synthesis',
            directPageTextFetched: false,
            searchSynthesis: researchRecord.searchSynthesis,
            sourceLinks: [expect.objectContaining({
              citationId: 'R1',
              url: 'https://example.gov/current-source',
            })],
          })],
        }),
      }),
      expect.any(Object),
    )
    expect(completed.survivors).toEqual(LIFECYCLE_SURVIVORS)
    expect(completed.research).toEqual([researchRecord])
    expect(completed.answerPromptDigest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('keeps a fenced Portia provider attempt alive after the originating request is aborted', async () => {
    dependencies = lifecycleDependencies()
    const requestController = new AbortController()
    const defaultGenerator = vi.mocked(
      dependencies.portiaGenerator!,
    ).getMockImplementation()
    if (!defaultGenerator) {
      throw new Error('The Portia fixture generator is missing.')
    }
    let observedProviderSignal: AbortSignal | undefined
    vi.mocked(dependencies.portiaGenerator!).mockImplementation(
      async (input, context) => {
        expect(dependencies.usage.beginProviderCall).toHaveBeenCalledOnce()
        expect(dependencies.lifecycleRepository?.beginPortiaAttempt)
          .toHaveBeenCalledOnce()
        const providerSignal = context.signal
        if (!providerSignal) {
          throw new Error('The fenced Portia call requires a provider signal.')
        }
        observedProviderSignal = providerSignal
        expect(providerSignal).not.toBe(requestController.signal)
        expect(providerSignal.aborted).toBe(false)

        requestController.abort()

        expect(requestController.signal.aborted).toBe(true)
        expect(providerSignal.aborted).toBe(false)
        return defaultGenerator(input, context)
      },
    )

    const lifecycle = await createApiServicesWithDependencies(
      dependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
      signal: requestController.signal,
    })

    expect(requestController.signal.aborted).toBe(true)
    expect(observedProviderSignal).toBeDefined()
    expect(observedProviderSignal!.aborted).toBe(false)
    expect(lifecycle).toMatchObject({
      state: 'gate_passed',
      portia: { promptDecision: 'permit' },
      gate: { passed: true, recommendedNextTransition: 'answer' },
    })
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'succeeded' }),
    )
    expect(dependencies.lifecycleRepository?.storePortia).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.storeGate).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.failPortiaAttempt)
      .not.toHaveBeenCalled()
  })

  it('reconciles a migrated pre-v2 Portia run with a legacy terminal fingerprint before building the v3 prompt', async () => {
    const currentFingerprint = terminalFingerprint(LIFECYCLE_SURVIVORS)
    const legacyFingerprint = 'f'.repeat(64)
    expect(legacyFingerprint).not.toBe(currentFingerprint)
    const migratedLifecycle = lifecycleAggregate({
      state: 'portia_running',
      terminalFingerprint: legacyFingerprint,
      answerPromptDigest: null,
      portiaActiveModelRequestId: null,
      portiaProgress: {
        currentCandidateId: null,
        completedCandidateIds: [],
        completedAssessments: [],
      },
      portia: null,
      gate: null,
    })
    dependencies = lifecycleDependencies(migratedLifecycle)
    const services = createApiServicesWithDependencies(dependencies)

    const reconciled = await services.getLifecycle({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(reconciled).toMatchObject({
      state: 'portia_pending',
      portiaActiveModelRequestId: null,
      portia: null,
    })
    expect(dependencies.lifecycleRepository?.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'portia_pending',
        activityType: 'legacy_review_recovered_for_retry',
      }),
    )
    expect(dependencies.lifecycleRepository?.failPortiaAttempt)
      .not.toHaveBeenCalled()
    expect(dependencies.portiaGenerator).not.toHaveBeenCalled()

    const completed = await services.runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(completed.state).toBe('gate_passed')
    expect(dependencies.portiaGenerator).toHaveBeenCalledOnce()
    const generatedInput = vi.mocked(dependencies.portiaGenerator!).mock
      .calls[0]![0]
    expect(generatedInput.answerPromptPackage).toMatchObject({
      terminalFingerprint: currentFingerprint,
      survivors: LIFECYCLE_SURVIVORS,
    })
    expect(generatedInput.answerPromptPackage.terminalFingerprint)
      .not.toBe(legacyFingerprint)
    const reservation = vi.mocked(
      dependencies.usage.reserveModelRequest,
    ).mock.calls[0]![0]
    expect(reservation.requestSha256).toBe(hashCanonicalJson({
      operation: 'portia/v3',
      gameId: GAME_ID,
      terminalFingerprint: currentFingerprint,
      input: {
        problem: generatedInput.problem,
        survivors: generatedInput.survivors,
        answerPromptPackage: generatedInput.answerPromptPackage,
        answerPromptDigest: generatedInput.answerPromptDigest,
      },
      model: OPENAI_MODEL,
      promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    } as unknown as CanonicalJson))
    expect(dependencies.usage.getLatestModelRequestForGame)
      .toHaveBeenCalledWith(expect.objectContaining({
        operation: 'portia',
        requestSha256: reservation.requestSha256,
        promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      }))
  })

  it('ends in portia_unavailable after three definitive provider failures without losing completed assessments or invoking Answer', async () => {
    dependencies = lifecycleDependencies()
    vi.mocked(dependencies.usage.reserveModelRequest).mockImplementation(
      async (input) => ({
        ok: true,
        kind: 'reserved',
        requestId: input.requestId,
        gameId: input.gameId,
        status: 'reserved',
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: '2026-07-26T20:03:00.000Z',
      }),
    )
    const completedAssessment = lifecycleAssessment(
      LIFECYCLE_SURVIVORS[0],
      0,
    )
    let providerAttempt = 0
    vi.mocked(dependencies.portiaGenerator!).mockImplementation(
      async (input, context) => {
        expect(input.completedAssessments).toEqual(
          providerAttempt === 0 ? [] : [completedAssessment],
        )
        providerAttempt += 1
        await context.onProgress?.({
          currentCandidateId: LIFECYCLE_SURVIVORS[1].candidateId,
          completedCandidateIds: [LIFECYCLE_SURVIVORS[0].candidateId],
          completedAssessments: [completedAssessment],
          totalCandidateCount: LIFECYCLE_SURVIVORS.length,
        })
        throw new ModelContractError(
          'Portia provider returned an invalid candidate assessment.',
        )
      },
    )
    const services = createApiServicesWithDependencies(dependencies)
    const attempts = [
      {
        requestId: '22222222-2222-4222-8222-222222222221',
        idempotencyKey: '33333333-3333-4333-8333-333333333331',
      },
      {
        requestId: '22222222-2222-4222-8222-222222222223',
        idempotencyKey: '33333333-3333-4333-8333-333333333332',
      },
      {
        requestId: '22222222-2222-4222-8222-222222222224',
        idempotencyKey: '33333333-3333-4333-8333-333333333334',
      },
    ] as const

    for (const [index, attempt] of attempts.entries()) {
      const promise = services.runPortia({
        ...operationInput(),
        ...attempt,
        gameId: GAME_ID,
        expectedRevision: 2,
      })
      if (index < 2) {
        await expect(promise).rejects.toMatchObject({
          code: 'UPSTREAM_FAILURE',
          status: 502,
        })
        const pending = await dependencies.lifecycleRepository!.getForGame(
          OWNER_ID,
          GAME_ID,
        )
        expect(pending).toMatchObject({
          state: 'portia_pending',
          portiaActiveModelRequestId: null,
          portiaFailedAttemptCount: index + 1,
          portiaFailureLimit: 3,
          portiaProgress: {
            currentCandidateId: null,
            completedCandidateIds: [LIFECYCLE_SURVIVORS[0].candidateId],
            completedAssessments: [completedAssessment],
          },
        })
      } else {
        await expect(promise).resolves.toMatchObject({
          state: 'portia_unavailable',
          portiaActiveModelRequestId: null,
          portiaFailedAttemptCount: 3,
          portiaFailureLimit: 3,
          portiaProgress: {
            currentCandidateId: LIFECYCLE_SURVIVORS[1].candidateId,
            completedCandidateIds: [LIFECYCLE_SURVIVORS[0].candidateId],
            completedAssessments: [completedAssessment],
          },
        })
      }
    }

    expect(providerAttempt).toBe(3)
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledTimes(3)
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        failureCode: 'provider_contract_invalid',
      }),
    )
    expect(dependencies.lifecycleRepository?.beginPortiaAttempt)
      .toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.failPortiaAttempt)
      .toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.failPortiaAttempt)
      .toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerId: OWNER_ID,
          gameId: GAME_ID,
          modelRequestId: attempts[2].requestId,
          requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
          activityType: 'adversarial_review_failed',
        }),
      )
    expect(dependencies.lifecycleRepository?.storePortia).not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.storeGate).not.toHaveBeenCalled()
    expect(dependencies.answerGenerator).not.toHaveBeenCalled()
  })

  it('ends immediately when the Gate commits an exhausted retry recommendation', async () => {
    const exhaustedPortia = exhaustedLifecycleReview()
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'portia_complete',
      portia: exhaustedPortia,
      fieldRegenerationCount: 1,
    }))

    const lifecycle = await createApiServicesWithDependencies(
      dependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(lifecycle).toMatchObject({
      state: 'insufficient_basis',
      gate: {
        passed: false,
        recommendedNextTransition: 'insufficient_basis',
      },
    })
    expect(dependencies.lifecycleRepository?.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'insufficient_basis',
        stage: 'retry',
        activityType: 'retry_budget_exhausted',
        status: 'refused',
      }),
    )
  })

  it('recovers a persisted terminal Gate decision after an interrupted transition', async () => {
    const portia = exhaustedLifecycleReview()
    const gate = evaluateGate(portia, {
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 1,
    })
    expect(gate.recommendedNextTransition).toBe('insufficient_basis')
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'gate_failed',
      portia,
      gate,
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 1,
    }))

    const lifecycle = await createApiServicesWithDependencies(
      dependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(lifecycle.state).toBe('insufficient_basis')
    expect(dependencies.lifecycleRepository?.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'insufficient_basis',
        activityType: 'retry_budget_exhausted',
        status: 'refused',
      }),
    )
    expect(dependencies.portiaGenerator).not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.storePortia).not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.storeGate).not.toHaveBeenCalled()
  })

  it('normalizes an interrupted terminal Gate decision during lifecycle restore', async () => {
    const portia = exhaustedLifecycleReview()
    const gate = evaluateGate(portia, {
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 1,
    })
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'gate_failed',
      portia,
      gate,
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 1,
    }))

    const lifecycle = await createApiServicesWithDependencies(
      dependencies,
    ).getLifecycle({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    })

    expect(lifecycle.state).toBe('insufficient_basis')
    expect(dependencies.lifecycleRepository?.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'insufficient_basis',
        activityType: 'retry_budget_exhausted',
        status: 'refused',
      }),
    )
    expect(dependencies.portiaGenerator).not.toHaveBeenCalled()
  })

  it('runs Charlotte only from a persisted passed Gate and stores its qualified answer', async () => {
    const portia = lifecycleReview()
    const gate = evaluateGate(portia)
    const initialLifecycle = lifecycleAggregate({
      state: 'gate_passed',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      portia,
      gate,
    })
    dependencies = lifecycleDependencies(initialLifecycle)
    vi.mocked(dependencies.repository.getTerminalReplay).mockResolvedValue(
      terminalSnapshot('answered'),
    )
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockResolvedValue({
      found: true,
      requestId: '77777777-7777-4777-8777-777777777777',
      gameId: GAME_ID,
      operation: 'answer',
      status: 'succeeded',
      resultPayload: approvedAnswerResultPayload(
        initialLifecycle,
      ) as unknown as ModelResultPayload,
    })

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
    expect(dependencies.lifecycleRepository?.storeGate).toHaveBeenCalledWith(
      expect.objectContaining({
        result: gate,
        answerUserPrompt: expect.stringContaining(PROBLEM),
      }),
    )
    expect(dependencies.charlotteGenerator).toHaveBeenCalledWith(
      {
        problem: PROBLEM,
        boardAnswer: STORED_ANSWER,
        boardAnswerDigest: hashCanonicalJson(
          STORED_ANSWER as unknown as CanonicalJson,
        ),
        reviewedPromptDigest: portia.reviewedAnswerPromptDigest,
        portia,
        gate,
      },
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
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'succeeded',
        resultPayload: expect.objectContaining({
          format: 'webchess-charlotte-result/3',
          source: {
            lifecycleRunId: initialLifecycle.id,
            boardAnswerDigest: hashCanonicalJson(
              STORED_ANSWER as unknown as CanonicalJson,
            ),
            reviewedPromptDigest: portia.reviewedAnswerPromptDigest,
            gateInputDigest: gate.inputDigest,
          },
        }),
      }),
    )
  })

  it('ends in charlotte_unavailable after three definitive provider failures and never starts a fourth', async () => {
    const portia = lifecycleReview()
    const gate = evaluateGate(portia)
    const initialLifecycle = lifecycleAggregate({
      state: 'gate_passed',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      portia,
      gate,
    })
    dependencies = lifecycleDependencies(initialLifecycle)
    vi.mocked(dependencies.repository.getTerminalReplay).mockResolvedValue(
      terminalSnapshot('answered'),
    )
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockResolvedValue({
      found: true,
      requestId: '77777777-7777-4777-8777-777777777777',
      gameId: GAME_ID,
      operation: 'answer',
      status: 'succeeded',
      resultPayload: approvedAnswerResultPayload(
        initialLifecycle,
      ) as unknown as ModelResultPayload,
    })
    vi.mocked(dependencies.usage.reserveModelRequest).mockImplementation(
      async (input) => ({
        ok: true,
        kind: 'reserved',
        requestId: input.requestId,
        gameId: input.gameId,
        status: 'reserved',
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: '2026-07-26T20:03:00.000Z',
      }),
    )
    vi.mocked(dependencies.charlotteGenerator!).mockRejectedValue(
      new ModelContractError(
        'Charlotte provider returned an invalid qualification result.',
      ),
    )
    const services = createApiServicesWithDependencies(dependencies)
    const attempts = [
      {
        requestId: '22222222-2222-4222-8222-222222222225',
        idempotencyKey: '33333333-3333-4333-8333-333333333335',
      },
      {
        requestId: '22222222-2222-4222-8222-222222222226',
        idempotencyKey: '33333333-3333-4333-8333-333333333336',
      },
      {
        requestId: '22222222-2222-4222-8222-222222222227',
        idempotencyKey: '33333333-3333-4333-8333-333333333337',
      },
    ] as const

    for (const [index, attempt] of attempts.entries()) {
      const promise = services.runCharlotte({
        ...operationInput(),
        ...attempt,
        gameId: GAME_ID,
        expectedRevision: 2,
      })
      if (index < 2) {
        await expect(promise).rejects.toMatchObject({
          code: 'UPSTREAM_FAILURE',
          status: 502,
        })
      } else {
        await expect(promise).resolves.toMatchObject({
          state: 'charlotte_unavailable',
          charlotteActiveModelRequestId: null,
          charlotteFailedAttemptCount: 3,
          charlotteFailureLimit: 3,
          charlotte: null,
        })
      }
    }

    await expect(services.runCharlotte({
      ...operationInput(),
      requestId: '22222222-2222-4222-8222-222222222228',
      idempotencyKey: '33333333-3333-4333-8333-333333333338',
      gameId: GAME_ID,
      expectedRevision: 2,
    })).resolves.toMatchObject({
      state: 'charlotte_unavailable',
      charlotteFailedAttemptCount: 3,
    })

    expect(dependencies.charlotteGenerator).toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.beginCharlotteAttempt)
      .toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.failCharlotteAttempt)
      .toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.storeCharlotte)
      .not.toHaveBeenCalled()
    expect(dependencies.usage.reserveModelRequest).toHaveBeenCalledTimes(3)
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledTimes(3)
    expect(dependencies.usage.settleModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        failureCode: 'provider_contract_invalid',
      }),
    )
  })

  it('recovers a current Charlotte winner only when its /3 source matches the exact answer lifecycle and Gate', async () => {
    const portia = lifecycleReview()
    const initialLifecycle = lifecycleAggregate({
      state: 'charlotte_pending',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      portia,
      gate: evaluateGate(portia),
    })
    dependencies = lifecycleDependencies(initialLifecycle)
    arrangeRecoveredCharlotteWinner(
      dependencies,
      initialLifecycle,
      approvedCharlotteResultPayload(initialLifecycle),
    )

    const recovered = await createApiServicesWithDependencies(
      dependencies,
    ).runCharlotte({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(recovered.state).toBe('charlotte_complete')
    expect(dependencies.charlotteGenerator).not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.storeCharlotte).toHaveBeenCalledOnce()
  })

  it('rejects a recovered current Charlotte /3 result when any source identity is wrong', async () => {
    const cases: readonly [string, CharlotteSourceOverrides][] = [
      ['answer', { boardAnswerDigest: 'e'.repeat(64) }],
      ['lifecycle', {
        lifecycleRunId: '99999999-9999-4999-8999-999999999999',
      }],
      ['reviewed prompt', { reviewedPromptDigest: 'e'.repeat(64) }],
      ['Gate', { gateInputDigest: 'e'.repeat(64) }],
    ]

    for (const [sourceName, sourceOverrides] of cases) {
      const portia = lifecycleReview()
      const initialLifecycle = lifecycleAggregate({
        state: 'charlotte_pending',
        answerPromptDigest: portia.reviewedAnswerPromptDigest,
        portia,
        gate: evaluateGate(portia),
      })
      dependencies = lifecycleDependencies(initialLifecycle)
      arrangeRecoveredCharlotteWinner(
        dependencies,
        initialLifecycle,
        approvedCharlotteResultPayload(initialLifecycle, sourceOverrides),
      )

      await expect(
        createApiServicesWithDependencies(dependencies).runCharlotte({
          ...operationInput(),
          gameId: GAME_ID,
          expectedRevision: 2,
        }),
        `source mismatch: ${sourceName}`,
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
      expect(dependencies.lifecycleRepository?.storeCharlotte)
        .not.toHaveBeenCalled()
    }
  })

  it('does not accept a legacy /1 payload as the winner for a current Charlotte run', async () => {
    const portia = lifecycleReview()
    const initialLifecycle = lifecycleAggregate({
      state: 'charlotte_pending',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      portia,
      gate: evaluateGate(portia),
    })
    dependencies = lifecycleDependencies(initialLifecycle)
    arrangeRecoveredCharlotteWinner(
      dependencies,
      initialLifecycle,
      legacyCharlotteResultPayload(portia),
    )

    await expect(
      createApiServicesWithDependencies(dependencies).runCharlotte({
        ...operationInput(),
        gameId: GAME_ID,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(dependencies.lifecycleRepository?.storeCharlotte)
      .not.toHaveBeenCalled()
  })

  it('recovers persisted Portia output and verifies completed current Charlotte provenance idempotently', async () => {
    const primingDependencies = lifecycleDependencies()
    const primed = await createApiServicesWithDependencies(
      primingDependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })
    if (!primed.portia) throw new Error('The primed Portia review is missing.')
    const portia = primed.portia as PortiaReview
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'portia_complete',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      answerUserPrompt: null,
      answerUserPromptSha256: null,
      portia,
    }))
    const recovered = await createApiServicesWithDependencies(
      dependencies,
    ).runPortia({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(recovered.state).toBe('gate_passed')
    expect(dependencies.portiaGenerator).not.toHaveBeenCalled()
    expect(dependencies.usage.reserveModelRequest).not.toHaveBeenCalled()

    const gate = evaluateGate(portia)
    const charlotte = lifecycleCharlotte(portia)
    const completedLifecycle = lifecycleAggregate({
      state: 'charlotte_complete',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      portia,
      gate,
      charlotte,
      charlotteRenderedAnswer: 'The persisted Charlotte answer is already complete.',
    })
    dependencies = lifecycleDependencies(completedLifecycle)
    vi.mocked(dependencies.repository.getTerminalReplay).mockResolvedValue(
      terminalSnapshot('answered'),
    )
    vi.mocked(
      dependencies.usage.getSucceededModelResultForGame,
    ).mockImplementation(async (input) => ({
      found: true,
      requestId: input.operation === 'answer'
        ? '77777777-7777-4777-8777-777777777777'
        : '88888888-8888-4888-8888-888888888888',
      gameId: GAME_ID,
      operation: input.operation,
      status: 'succeeded',
      resultPayload: (input.operation === 'answer'
        ? approvedAnswerResultPayload(completedLifecycle)
        : approvedCharlotteResultPayload(completedLifecycle)
      ) as unknown as ModelResultPayload,
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

  it('keeps completed Charlotte histories from the prior prompt contract readable', async () => {
    const portia = lifecycleReview()
    const gate = evaluateGate(portia)
    const charlotte = lifecycleCharlotte(portia)
    const legacyLifecycle = lifecycleAggregate({
      state: 'charlotte_complete',
      answerPromptDigest: portia.reviewedAnswerPromptDigest,
      portia,
      gate,
      charlotte,
      charlotteRenderedAnswer: 'The persisted legacy Charlotte answer remains readable.',
      versions: {
        ...lifecycleAggregate().versions,
        charlottePrompt: 'webchess-charlotte-v2',
      },
    })
    dependencies = lifecycleDependencies(legacyLifecycle)

    const completed = await createApiServicesWithDependencies(
      dependencies,
    ).runCharlotte({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(completed).toEqual(legacyLifecycle)
    expect(dependencies.usage.getSucceededModelResultForGame)
      .not.toHaveBeenCalled()
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
    const inheritedEvidence = webMemoryEvidence(NOW.toISOString())
    vi.mocked(
      dependencies.lifecycleRepository!.getWebMemoryEvidenceForGame,
    ).mockResolvedValue([inheritedEvidence])
    vi.mocked(dependencies.repository.getOwnedGame).mockResolvedValue(
      snapshot({
        id: IDEMPOTENCY_KEY,
        sourceGameId: GAME_ID,
        status: 'mapped',
      }),
    )
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
    expect(
      dependencies.lifecycleRepository?.getWebMemoryEvidenceForGame,
    ).toHaveBeenCalledWith(OWNER_ID, GAME_ID)
    expect(
      dependencies.lifecycleRepository?.attachWebMemoryEvidence,
    ).toHaveBeenCalledWith(
      OWNER_ID,
      IDEMPOTENCY_KEY,
      [WEB_MEMORY_OBSERVATION_ID],
    )
    expect(
      vi.mocked(
        dependencies.lifecycleRepository!.attachWebMemoryEvidence,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(
        dependencies.lifecycleRepository!.createRetryRun,
      ).mock.invocationCallOrder[0]!,
    )

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

  it('regenerates a deficient field with bounded Gate feedback and durable provenance', async () => {
    const portia = lifecycleReview()
    const failedPortia: PortiaReview = {
      ...portia,
      assessments: portia.assessments.slice(0, 3),
      missingCoverage: ['agency_or_action'],
      recommendedGateInputs: {
        ...portia.recommendedGateInputs,
        fieldRepairReasons: [
          'Add a distinct agency path grounded in an observable action.',
        ],
      },
    }
    const failedGate = evaluateGate(failedPortia)
    expect(failedGate.recommendedNextTransition).toBe('retry_field')
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'gate_failed',
      portia: failedPortia,
      gate: failedGate,
    }))
    const inheritedEvidence = webMemoryEvidence(NOW.toISOString())
    vi.mocked(
      dependencies.lifecycleRepository!.getWebMemoryEvidenceForGame,
    ).mockResolvedValue([inheritedEvidence])
    const repairContext = normalizeDivisionRepairContext({
      priorFieldGeneration: 1,
      gateMissingRequirements: failedGate.missingRequirements,
      missingCoverage: [
        ...failedPortia.missingCoverage,
        ...failedGate.coverageResults
          .filter((coverage) => !coverage.satisfied)
          .map((coverage) => coverage.tag),
      ],
      fieldRepairReasons:
        failedPortia.recommendedGateInputs.fieldRepairReasons,
    })

    const retried = await createApiServicesWithDependencies(
      dependencies,
    ).retryLifecycle({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(retried.game).toMatchObject({
      id: REQUEST_ID,
      problem: PROBLEM,
      sourceGameId: null,
    })
    expect(retried.lifecycle).toMatchObject({
      state: 'field_ready',
      fieldRegenerationCount: 1,
    })
    expect(dependencies.divisionGenerator).toHaveBeenCalledWith(
      {
        problem: PROBLEM,
        repairContext,
        webMemoryEvidence: [inheritedEvidence],
      },
      expect.objectContaining({ userId: OWNER_ID }),
    )
    expect(dependencies.repository.getOrCreateDivision).toHaveBeenCalledWith(
      expect.objectContaining({
        problem: PROBLEM,
        sourceGameId: GAME_ID,
      }),
    )
    expect(dependencies.usage.reserveModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSha256: hashCanonicalJson({
          operation: 'division/v2-field-retry',
          problem: PROBLEM,
          repairContext,
          memoryObservationIds: [WEB_MEMORY_OBSERVATION_ID],
          sourceGameId: GAME_ID,
          fieldGeneration: 2,
          model: OPENAI_MODEL,
          promptVersion: DIVISION_PROMPT_VERSION,
          softwareVersion: 'webchess-test',
        } as unknown as CanonicalJson),
      }),
    )
    expect(dependencies.lifecycleRepository?.createRetryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        childGame: expect.objectContaining({ id: REQUEST_ID }),
        trajectorySeed: REQUEST_ID,
        mode: 'regenerate_field',
      }),
    )
    expect(
      dependencies.lifecycleRepository?.attachWebMemoryEvidence,
    ).toHaveBeenCalledWith(
      OWNER_ID,
      REQUEST_ID,
      [WEB_MEMORY_OBSERVATION_ID],
    )
    expect(
      vi.mocked(
        dependencies.lifecycleRepository!.attachWebMemoryEvidence,
      ).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.divisionGenerator).mock.invocationCallOrder[0]!,
    )
  })

  it('reopens a premature saved stop and uses its unspent field repair', async () => {
    const portia: PortiaReview = {
      ...exhaustedLifecycleReview(),
      promptDecision: 'deny',
      promptDecisionRationale:
        'The current evidence and conflict scope require one bounded repair.',
    }
    const persistedTerminalGate = evaluateGate(portia, {
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 1,
    })
    expect(persistedTerminalGate.recommendedNextTransition)
      .toBe('insufficient_basis')
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'insufficient_basis',
      portia,
      gate: persistedTerminalGate,
      fieldRegenerationCount: 0,
    }))

    const retried = await createApiServicesWithDependencies(
      dependencies,
    ).retryLifecycle({
      ...operationInput(),
      gameId: GAME_ID,
      expectedRevision: 2,
    })

    expect(retried.game).not.toBeNull()
    expect(retried.lifecycle).toMatchObject({
      state: 'field_ready',
      fieldRegenerationCount: 1,
    })
    expect(dependencies.divisionGenerator).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.createRetryRun)
      .toHaveBeenCalledWith(expect.objectContaining({
        parentGameId: GAME_ID,
        mode: 'regenerate_field',
      }))
  })

  it.each([
    'actor',
    'action',
    'testedAssumption',
    'expectedObservation',
    'decisionThreshold',
    'reviewHorizon',
  ] as const)(
    'refuses a Wilbur action whose %s does not exactly match Charlotte',
    async (field) => {
      const portia = lifecycleReview()
      const charlotte = lifecycleCharlotte(portia)
      const suggestion = charlotte.exactlyThreeNextActions[0]!
      const canonicalCommand = {
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
      }
      dependencies = lifecycleDependencies(lifecycleAggregate({
        state: 'charlotte_complete',
        portia,
        gate: evaluateGate(portia),
        charlotte,
      }))

      await expect(
        createApiServicesWithDependencies(dependencies).createWilburAction({
          ...operationInput(),
          ...canonicalCommand,
          [field]: `${canonicalCommand[field]} Expanded by the client.`,
          gameId: GAME_ID,
          charlotteActionIndex: 0,
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      })

      expect(dependencies.usage.consumeWilburMutationRate).not.toHaveBeenCalled()
      expect(dependencies.lifecycleRepository?.getForGame).toHaveBeenCalledOnce()
      expect(dependencies.lifecycleRepository?.createWilburAction)
        .not.toHaveBeenCalled()
    },
  )

  it('rejects an already current-bound Charlotte action before rate admission', async () => {
    const portia = lifecycleReview()
    const charlotte = lifecycleCharlotte(portia)
    const suggestion = charlotte.exactlyThreeNextActions[0]!
    const existingAction = {
      id: REQUEST_ID,
      lifecycleRunId: GAME_ID,
      charlotteActionIndex: 0,
      charlotteBindingVersion:
        'webchess-charlotte-action-binding-v1' as const,
      actor: suggestion.actor,
      action: suggestion.smallestAction,
      testedAssumption: suggestion.assumptionBeingTested,
      expectedObservation: suggestion.expectedObservation,
      decisionThreshold: suggestion.decisionThreshold,
      reviewHorizon: suggestion.reviewHorizon,
      followUpAt: null,
      status: 'planned' as const,
      revision: 0,
      version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'wilbur_planning',
      portia,
      gate: evaluateGate(portia),
      charlotte,
      wilburActions: [existingAction],
    }))

    await expect(createApiServicesWithDependencies(dependencies)
      .createWilburAction({
        ...operationInput(),
        gameId: GAME_ID,
        charlotteActionIndex: 0,
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
      })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(dependencies.usage.consumeWilburMutationRate).not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.settleWilburMutationConflict)
      .toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.createWilburAction)
      .not.toHaveBeenCalled()
  })

  it('terminally settles an admitted create conflict and releases its reservation', async () => {
    const portia = lifecycleReview()
    const charlotte = lifecycleCharlotte(portia)
    const suggestion = charlotte.exactlyThreeNextActions[0]!
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'charlotte_complete',
      portia,
      gate: evaluateGate(portia),
      charlotte,
    }))
    vi.mocked(dependencies.lifecycleRepository!.createWilburAction)
      .mockRejectedValueOnce(new LifecycleRepositoryError(
        'conflict',
        'A concurrent current binding won.',
      ))

    await expect(createApiServicesWithDependencies(dependencies)
      .createWilburAction({
        ...operationInput(),
        gameId: GAME_ID,
        charlotteActionIndex: 0,
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
      })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(dependencies.usage.consumeWilburMutationRate).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.settleWilburMutationConflict)
      .toHaveBeenCalledOnce()
  })

  it('settles a stale status intent without consuming shared rate capacity', async () => {
    const portia = lifecycleReview()
    const charlotte = lifecycleCharlotte(portia)
    const suggestion = charlotte.exactlyThreeNextActions[0]!
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'wilbur_planning',
      portia,
      gate: evaluateGate(portia),
      charlotte,
      wilburActions: [{
        id: REQUEST_ID,
        lifecycleRunId: GAME_ID,
        charlotteActionIndex: 0,
        charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
        followUpAt: null,
        status: 'in_progress',
        revision: 1,
        version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }],
    }))

    await expect(createApiServicesWithDependencies(dependencies)
      .updateWilburAction({
        ...operationInput(),
        gameId: GAME_ID,
        actionId: REQUEST_ID,
        expectedRevision: 0,
        status: 'completed',
      })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(dependencies.usage.consumeWilburMutationRate).not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.settleWilburMutationConflict)
      .toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.updateWilburAction)
      .not.toHaveBeenCalled()
  })

  it('denies every valid Wilbur mutation before an artifact write', async () => {
    const portia = lifecycleReview()
    const charlotte = lifecycleCharlotte(portia)
    const suggestion = charlotte.exactlyThreeNextActions[0]!
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'wilbur_planning',
      portia,
      gate: evaluateGate(portia),
      charlotte,
      wilburActions: [{
        id: REQUEST_ID,
        lifecycleRunId: GAME_ID,
        charlotteActionIndex: 2,
        charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
        followUpAt: null,
        status: 'planned',
        revision: 0,
        version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }],
    }))
    vi.mocked(dependencies.usage.consumeWilburMutationRate)
      .mockResolvedValueOnce({
        ok: false,
        code: 'WILBUR_ACTION_HOURLY_RATE_LIMITED',
        httpStatus: 429,
        retryAfterSeconds: 30,
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'IP_WILBUR_ACTION_HOURLY_RATE_LIMITED',
        httpStatus: 429,
        retryAfterSeconds: 31,
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'WILBUR_OBSERVATION_HOURLY_RATE_LIMITED',
        httpStatus: 429,
        retryAfterSeconds: 32,
      })
    const services = createApiServicesWithDependencies(dependencies)
    const context = { ...operationInput(), gameId: GAME_ID }

    await expect(services.createWilburAction({
      ...context,
      charlotteActionIndex: 0,
      actor: suggestion.actor,
      action: suggestion.smallestAction,
      testedAssumption: suggestion.assumptionBeingTested,
      expectedObservation: suggestion.expectedObservation,
      decisionThreshold: suggestion.decisionThreshold,
      reviewHorizon: suggestion.reviewHorizon,
    })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 30,
    })
    await expect(services.updateWilburAction({
      ...context,
      actionId: REQUEST_ID,
      expectedRevision: 0,
      status: 'in_progress',
    })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 31,
    })
    await expect(services.appendWilburObservation({
      ...context,
      actionId: REQUEST_ID,
      observedAt: NOW.toISOString(),
      observation: 'A direct signal appeared.',
      evidenceClassification: 'Direct observation.',
      expectedEffect: 'The declared signal appeared.',
      unexpectedEffect: 'No unexpected effect.',
      stakeholderResponse: 'The stop path remained available.',
      assumptionResult: 'supported',
      nextDecision: 'Continue inside the bounded scope.',
    })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 32,
    })

    expect(dependencies.lifecycleRepository?.getForGame).toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.claimWilburMutation)
      .toHaveBeenCalledTimes(3)
    expect(dependencies.lifecycleRepository?.createWilburAction)
      .not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.updateWilburAction)
      .not.toHaveBeenCalled()
    expect(dependencies.lifecycleRepository?.appendWilburObservation)
      .not.toHaveBeenCalled()
  })

  it('delegates owner-scoped Wilbur actions, statuses, observations, and provenance', async () => {
    const portia = lifecycleReview()
    const charlotte = lifecycleCharlotte(portia)
    const suggestion = charlotte.exactlyThreeNextActions[0]!
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'charlotte_complete',
      portia,
      gate: evaluateGate(portia),
      charlotte,
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
      actor: suggestion.actor,
      action: suggestion.smallestAction,
      testedAssumption: suggestion.assumptionBeingTested,
      expectedObservation: suggestion.expectedObservation,
      decisionThreshold: suggestion.decisionThreshold,
      reviewHorizon: suggestion.reviewHorizon,
    })
    const updated = await services.updateWilburAction({
      ...context,
      actionId: created.id,
      expectedRevision: created.revision,
      status: 'in_progress',
    })
    const observationCommand = {
      ...context,
      actionId: created.id,
      observedAt: NOW.toISOString(),
      observation: 'The bounded test produced one direct café signal.',
      evidenceClassification: 'Direct observation by the accountable owner.',
      expectedEffect: 'A direct signal appears.',
      unexpectedEffect: 'No unexpected effect was recorded.',
      stakeholderResponse: 'Affected participants retained the stop path.',
      assumptionResult: 'supported' as const,
      nextDecision: 'Continue only inside the original bounded scope.',
    }
    const observed = await services.appendWilburObservation(
      observationCommand,
    )
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
        charlotteActionIndex: 0,
        actor: suggestion.actor,
        action: suggestion.smallestAction,
        testedAssumption: suggestion.assumptionBeingTested,
        expectedObservation: suggestion.expectedObservation,
        decisionThreshold: suggestion.decisionThreshold,
        reviewHorizon: suggestion.reviewHorizon,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }))
    expect(dependencies.lifecycleRepository?.appendWilburObservation)
      .toHaveBeenCalledWith(expect.objectContaining({
        assumptionResult: 'supported',
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }))
    const expectedObservationBytes = [
      observationCommand.observation,
      observationCommand.evidenceClassification,
      observationCommand.expectedEffect,
      observationCommand.unexpectedEffect,
      observationCommand.stakeholderResponse,
      observationCommand.assumptionResult,
      observationCommand.nextDecision,
    ].reduce(
      (total, value) => total + new TextEncoder().encode(value).byteLength,
      0,
    )
    const observationClaims = vi.mocked(
      dependencies.lifecycleRepository!.claimWilburMutation,
    ).mock.calls
      .map(([claim]) => claim)
      .filter((claim) => claim.operation === 'append_observation')
    expect(observationClaims).toHaveLength(2)
    expect(observationClaims).toEqual([
      expect.objectContaining({ reservedTextBytes: expectedObservationBytes }),
      expect.objectContaining({ reservedTextBytes: expectedObservationBytes }),
    ])
    expect(dependencies.usage.consumeWilburMutationRate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: OWNER_ID,
        ipAddress: '203.0.113.17',
        kind: 'action',
        operation: 'create_action',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    )
    expect(dependencies.usage.consumeWilburMutationRate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: OWNER_ID,
        ipAddress: '203.0.113.17',
        kind: 'action',
        operation: 'update_action',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    )
    expect(dependencies.usage.consumeWilburMutationRate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        userId: OWNER_ID,
        ipAddress: '203.0.113.17',
        kind: 'observation',
        operation: 'append_observation',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    )
  })

  it('replays the saved PATCH result after an ambiguous lost response', async () => {
    const portia = lifecycleReview()
    const charlotte = lifecycleCharlotte(portia)
    const suggestion = charlotte.exactlyThreeNextActions[0]!
    const action = {
      id: REQUEST_ID,
      lifecycleRunId: GAME_ID,
      charlotteActionIndex: 0,
      charlotteBindingVersion:
        'webchess-charlotte-action-binding-v1' as const,
      actor: suggestion.actor,
      action: suggestion.smallestAction,
      testedAssumption: suggestion.assumptionBeingTested,
      expectedObservation: suggestion.expectedObservation,
      decisionThreshold: suggestion.decisionThreshold,
      reviewHorizon: suggestion.reviewHorizon,
      followUpAt: null,
      status: 'planned' as const,
      revision: 0,
      version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }
    dependencies = lifecycleDependencies(lifecycleAggregate({
      state: 'wilbur_planning',
      portia,
      gate: evaluateGate(portia),
      charlotte,
      wilburActions: [action],
    }))
    const services = createApiServicesWithDependencies(dependencies)
    const command = {
      ...operationInput(),
      gameId: GAME_ID,
      actionId: REQUEST_ID,
      expectedRevision: 0,
      status: 'in_progress' as const,
    }

    const committed = await services.updateWilburAction(command)
    vi.mocked(dependencies.lifecycleRepository!.claimWilburMutation)
      .mockResolvedValueOnce({ kind: 'committed', action: committed })
    await expect(services.updateWilburAction(command)).resolves.toEqual(committed)

    expect(dependencies.usage.consumeWilburMutationRate).toHaveBeenCalledOnce()
    expect(dependencies.lifecycleRepository?.updateWilburAction)
      .toHaveBeenCalledOnce()
  })
})

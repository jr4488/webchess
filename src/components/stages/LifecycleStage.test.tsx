import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CURRENT_GAME_VERSIONS, type GameView } from '../../lib/game-contract'
import type {
  WebChessCaseProfile,
  WebChessCaseVerificationResult,
} from '../../lib/case-bundle-contract'
import type {
  GateRecommendation,
  LifecycleAggregate,
  LifecycleState,
  PortiaReview,
  WilburAction,
} from '../../lib/lifecycle/contracts'
import { PORTIA_ATTACK_TYPES } from '../../lib/lifecycle/contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from '../../lib/lifecycle/versions'
import {
  DIRECTIONAL_EPISTEMIC_BOUNDARY,
  DIRECTIONAL_RECORD_VERSION,
  type DirectionalContributions,
  type TrajectoryDirectionalRecord,
} from '../../lib/lifecycle/trajectory-direction'
import {
  RESEARCH_CONSENT_VERSION,
  type ResearchRecord,
} from '../../lib/research'
import {
  buildOpenClawAnswerModelPrompt,
  OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT,
} from '../../lib/full-answer-model-prompt'
import type {
  AppendWilburObservationCommand,
  DurableGame,
} from '../../lib/webchess-api'
import { makeProblemFacets, makeProblemParts } from '../../test/fixtures'
import type {
  CaptureRecord,
  GeneratedAnswer,
  Piece,
} from '../../types'
import { LifecycleStage } from './LifecycleStage'

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  'clipboard',
)
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'execCommand',
)

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      window.navigator,
      'clipboard',
      originalClipboardDescriptor,
    )
  } else {
    Reflect.deleteProperty(window.navigator, 'clipboard')
  }
  if (originalExecCommandDescriptor) {
    Object.defineProperty(
      document,
      'execCommand',
      originalExecCommandDescriptor,
    )
  } else {
    Reflect.deleteProperty(document, 'execCommand')
  }
  vi.restoreAllMocks()
})

vi.mock('../ProcessGraphic', () => ({
  ProcessGraphic: ({ headline }: { headline: string }) => (
    <div data-testid="process-graphic">{headline}</div>
  ),
}))

vi.mock('../RadialBoard', () => ({
  RadialBoard: ({
    portiaActivity,
  }: {
    portiaActivity?: {
      status: string
      currentCell: { ring: number; sector: number } | null
      currentLabel: string | null
      reviewedCellKeys: ReadonlySet<string> | readonly string[]
      announcement: string
    }
  }) => (
    <div
      data-testid="radial-board"
      data-portia-status={portiaActivity?.status}
      data-portia-current-cell={portiaActivity?.currentCell
        ? `${portiaActivity.currentCell.ring}:${portiaActivity.currentCell.sector}`
        : undefined}
      data-portia-current-label={portiaActivity?.currentLabel ?? undefined}
      data-portia-reviewed-cells={portiaActivity
        ? [...portiaActivity.reviewedCellKeys].join(',')
        : undefined}
    >
      {portiaActivity?.announcement}
      {portiaActivity?.currentLabel
        ? ` Current signal: ${portiaActivity.currentLabel}.`
        : ''}
    </div>
  ),
}))

function aggregate(
  state: LifecycleState,
  recommendation: GateRecommendation,
  retryCounts = { sameFieldRetryCount: 0, fieldRegenerationCount: 0 },
): LifecycleAggregate {
  return {
    id: '72000000-0000-4000-8000-000000000001',
    rootRunId: '72000000-0000-4000-8000-000000000001',
    parentRunId: retryCounts.sameFieldRetryCount > 0
      ? '72000000-0000-4000-8000-000000000000'
      : null,
    gameId: '73000000-0000-4000-8000-000000000001',
    state,
    revision: 4,
    fieldGeneration: 1,
    gameAttempt: 1,
    sameFieldRetryCount: retryCounts.sameFieldRetryCount,
    fieldRegenerationCount: retryCounts.fieldRegenerationCount,
    divisionSeed: 'division-seed',
    castSeed: 'cast-seed',
    trajectorySeed: 'trajectory-seed',
    retryReason: retryCounts.sameFieldRetryCount > 0
      ? 'The root inquiry used another bounded path.'
      : null,
    terminalFingerprint: 'f'.repeat(64),
    answerPromptDigest: null,
    answerUserPrompt: null,
    answerUserPromptSha256: null,
    portiaActiveModelRequestId: null,
    portiaFailedAttemptCount: 0,
    portiaFailureLimit: 3,
    survivors: [],
    portiaProgress: {
      currentCandidateId: null,
      completedCandidateIds: [],
      completedAssessments: [],
    },
    portia: null,
    gate: {
      passed: false,
      usableCandidateCount: 3,
      independentClusterCount: 2,
      contradictionResults: {
        fatalUnaddressedIds: [],
        tensionCandidatePairs: [],
      },
      missingRequirements: ['At least four usable candidates are required.'],
      recommendedNextTransition: recommendation,
      explanation: 'The evidence floor was not met.',
    },
    charlotte: null,
    charlotteRenderedAnswer: null,
    wilburActions: [],
    wilburObservations: [],
    activities: [],
    research: [],
    versions: {},
    createdAt: '2026-08-01T20:00:00.000Z',
    updatedAt: '2026-08-01T20:00:00.000Z',
  } as unknown as LifecycleAggregate
}

const PORTABLE_GAME_ID = '73000000-0000-4000-8000-000000000001'
const PORTABLE_RUN_ID = '72000000-0000-4000-8000-000000000001'
const PORTABLE_PROMPT_DIGEST = 'd'.repeat(64)
const PORTABLE_PROMPT_SHA256 = 'a'.repeat(64)
const PORTABLE_QUESTION = 'How should this decision be tested?'
const PORTABLE_EXACT_INPUT = JSON.stringify({
  reviewed_prompt: {
    game_evidence: {
      original_problem: PORTABLE_QUESTION,
    },
  },
  portia_authorization: {
    decision: 'permit',
    usable_candidates: [{ candidate: 'candidate-white-queen', weight: 83 }],
  },
}, null, 2)
const DIVISION_PROMPT_SENTINEL = 'DIVISION_PROVIDER_PROMPT_SENTINEL'
const ANSWER_PROMPT_SENTINEL = 'ANSWER_PROVIDER_PROMPT_SENTINEL'
const HIDDEN_CONTROL_SENTINELS = [
  DIVISION_PROMPT_SENTINEL,
  ANSWER_PROMPT_SENTINEL,
  'SYSTEM_PROMPT_SENTINEL',
  'DEVELOPER_PROMPT_SENTINEL',
  'CREDENTIAL_SENTINEL',
  'RESPONSE_SCHEMA_SENTINEL',
] as const

function portablePiece(
  id: string,
  side: Piece['side'],
  position: Piece['position'],
): Piece {
  return {
    id,
    side,
    kind: side === 'white' ? 'queen' : 'rook',
    position,
    moved: true,
  }
}

function makePortableGame(): DurableGame {
  const facets = makeProblemFacets('Portable facet')
  const parts = makeProblemParts('portable-lifecycle-ui')
  const attacker = portablePiece('white-queen', 'white', { ring: 1, sector: 1 })
  const captured = portablePiece('black-rook', 'black', { ring: 1, sector: 1 })
  const capture: CaptureRecord = {
    id: 'portable-capture-1',
    turn: 1,
    attacker,
    captured,
    cell: { ring: 1, sector: 1 },
    part: parts[9]!,
    resonance: 83,
    narration: 'The evidence lens displaced an unsupported shortcut.',
  }
  const state: GameView = {
    versions: CURRENT_GAME_VERSIONS,
    pieces: [attacker],
    turn: 'white',
    completedPlies: 2,
    quietPlies: 0,
    events: [
      {
        version: 1,
        type: 'move',
        ply: 1,
        side: 'white',
        pieceId: attacker.id,
        from: { ring: 2, sector: 1 },
        to: { ring: 1, sector: 1 },
        capturedPieceId: captured.id,
        promotedTo: 'queen',
      },
      {
        version: 1,
        type: 'forced-pass',
        ply: 2,
        side: 'black',
        reason: 'no-legal-move',
      },
    ],
    captures: [capture],
    lastMove: {
      from: { ring: 2, sector: 1 },
      to: { ring: 1, sector: 1 },
    },
    outcome: {
      winner: 'white',
      reason: 'no-moves',
      completedTurn: 2,
      terminalCapture: capture,
    },
  }

  return {
    id: PORTABLE_GAME_ID,
    sourceGameId: null,
    revision: 17,
    status: 'answered',
    problem: PORTABLE_QUESTION,
    researchConsent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: '2026-08-02T20:00:00.000Z',
    },
    division: {
      seed: 'portable-seed',
      facets,
      parts,
      model: 'test-division-model',
      prompt: DIVISION_PROMPT_SENTINEL,
    },
    state,
    answer: {
      answer: 'A generated answer that must not be copied into the evidence payload.',
      model: 'test-answer-model',
      prompt: [
        ANSWER_PROMPT_SENTINEL,
        'SYSTEM_PROMPT_SENTINEL',
        'DEVELOPER_PROMPT_SENTINEL',
        'CREDENTIAL_SENTINEL',
        'RESPONSE_SCHEMA_SENTINEL',
      ].join(' '),
    },
  }
}

function makePortablePortiaReview(): PortiaReview {
  return {
    contractVersion: 'webchess-portia-review-v2',
    reviewedAnswerPromptDigest: PORTABLE_PROMPT_DIGEST,
    promptDecision: 'permit',
    promptDecisionRationale:
      'The board-derived prompt may proceed with its evidence boundary intact.',
    runSummary:
      'Portia found a usable reversible-test signal and retained its uncertainty.',
    assessments: [{
      candidateId: 'candidate-white-queen',
      disposition: 'preserved',
      survivingInterpretation:
        'A small reversible test can reveal whether this decision works.',
      requiredQualification: null,
      redundancyClusterId: null,
      coverageTags: ['evidence_or_reality', 'agency_or_action'],
      missingEvidence: ['A measured baseline before the trial'],
      countercase: 'The symbolic path may not predict a real-world result.',
      reversalCondition: 'Reverse course if the measured threshold is missed.',
      attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
        attackType,
        outcome: 'passed' as const,
        severity: 'low' as const,
        finding: `The ${attackType} check is acceptable for a bounded trial.`,
        consequence: 'The answer can preserve this signal without overstating it.',
        requiredRevision: null,
      })),
    }],
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: [],
    recommendedGateInputs: {
      tensionCandidatePairs: [],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  }
}

const DIRECTIONAL_RECORD_DIGEST = '9'.repeat(64)
const PRIMARY_DIRECTION_KEY = 'direction-adapt-refine'
const SECONDARY_DIRECTION_KEY = 'direction-resource-examine'

function directionalContributions(
  overrides: Partial<DirectionalContributions>,
): DirectionalContributions {
  return {
    departureVisits: 0,
    departureMaterial: 0,
    arrivalVisits: 0,
    arrivalMaterial: 0,
    chronology: 0,
    captureCount: 0,
    capturedMaterial: 0,
    attackerMaterial: 0,
    captureResonance: 0,
    captureOrder: 0,
    forcedPassConstraints: 0,
    forcedPassMaterial: 0,
    survivorCount: 0,
    survivorMaterial: 0,
    survivorMoveCount: 0,
    winningSurvivorMaterial: 0,
    terminalOutcomeWeight: 0,
    terminalCapture: 0,
    ...overrides,
  }
}

function makeDirectionalRecord(): TrajectoryDirectionalRecord {
  return {
    version: DIRECTIONAL_RECORD_VERSION,
    digest: DIRECTIONAL_RECORD_DIGEST,
    survivingDirectionKeys: [PRIMARY_DIRECTION_KEY, SECONDARY_DIRECTION_KEY],
    directions: [
      {
        rank: 1,
        lens: {
          key: PRIMARY_DIRECTION_KEY,
          coordinate: { ring: 1, sector: 1 },
          partId: 10,
          hexagram: 49,
          hexagramName: 'Revolution',
          theme: 'Change the frame when accumulated evidence requires it.',
          dimension: 'Adapt',
          movement: 'Refine',
          title: 'Reversible change',
          focus: 'Test one bounded shift.',
          prompt: 'What can change without hiding the cost?',
          keyword: 'change',
          directionalCue: 'Transform only what the trajectory puts under pressure.',
          castApplication:
            'Use the cast direction to make the surviving trial reversible and measurable.',
        },
        score: 1_327,
        contributions: directionalContributions({
          arrivalVisits: 3,
          departureVisits: 2,
          captureCount: 1,
          capturedMaterial: 5,
          survivorCount: 1,
          survivorMaterial: 9,
          terminalOutcomeWeight: 12,
        }),
        supportingPlies: [1, 7, 19],
        captureIds: ['capture-7'],
        survivorPieceIds: ['white-queen'],
        explanation:
          'Adapt / Refine scored 1327 because ordered arrivals, a high-value capture, the final queen, and the terminal result reinforced this cast-qualified lens.',
      },
      {
        rank: 2,
        lens: {
          key: SECONDARY_DIRECTION_KEY,
          coordinate: { ring: 3, sector: 4 },
          partId: 29,
          hexagram: 20,
          hexagramName: 'Contemplation',
          theme: 'Observe the system before committing further resources.',
          dimension: 'Resources',
          movement: 'Examine',
          title: 'Observe first',
          focus: 'Keep the measurement boundary visible.',
          prompt: 'What must be observed before commitment?',
          keyword: 'observe',
          directionalCue: 'Let the surviving material set the observation horizon.',
          castApplication:
            'Require direct observation before treating the surviving direction as useful.',
        },
        score: 884,
        contributions: directionalContributions({
          arrivalVisits: 1,
          forcedPassConstraints: 2,
          survivorCount: 1,
          survivorMaterial: 5,
          terminalOutcomeWeight: 6,
        }),
        supportingPlies: [32, 33],
        captureIds: [],
        survivorPieceIds: ['black-rook'],
        explanation:
          'Resources / Examine scored 884 because forced-pass constraints and surviving material reinforced an observation-first direction.',
      },
    ],
    explanation: [
      'All 95 canonical plies, ordered captures, surviving pieces, and the terminal outcome contributed to this record.',
      'The two fixture directions shown here continue into the saved Portia review.',
      DIRECTIONAL_EPISTEMIC_BOUNDARY.statement,
    ],
    epistemicBoundary: DIRECTIONAL_EPISTEMIC_BOUNDARY,
  } as unknown as TrajectoryDirectionalRecord
}

function makeDirectionalLifecycle(): LifecycleAggregate {
  const directionalRecord = makeDirectionalRecord()
  const portia = makePortablePortiaReview()
  return {
    ...aggregate('portia_complete', 'answer'),
    trajectoryDirectionalRecord: directionalRecord,
    trajectoryDirectionalRecordStatus: 'bound',
    portia: {
      ...portia,
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      directionalRecordVersion: directionalRecord.version,
      directionalRecordDigest: directionalRecord.digest,
      directionalSummary:
        'Portia retained the replay-derived change and observation directions under factual limits.',
      assessments: portia.assessments.map((assessment) => ({
        ...assessment,
        directionalRecordDigest: directionalRecord.digest,
        directionalSignalKeys: [PRIMARY_DIRECTION_KEY, SECONDARY_DIRECTION_KEY],
        directionalInterpretation:
          'The full trajectory directs this survivor toward a small reversible test with an observation horizon.',
        directionalAmendment:
          'State the reversal threshold and the observation required before wider commitment.',
      })),
    },
  } as LifecycleAggregate
}

function makePortableResearch(): ResearchRecord {
  return {
    id: '81000000-0000-4000-8000-000000000001',
    lifecycleRunId: PORTABLE_RUN_ID,
    gameId: PORTABLE_GAME_ID,
    stage: 'portia',
    requestedBy: 'research-policy',
    consent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: '2026-08-02T20:00:00.000Z',
    },
    policyVersion: 'research-policy/1',
    materiality: 'required',
    reason: 'The prompt depends on a current external benchmark.',
    query: 'official reversible trial measurement guidance 2026',
    status: 'completed',
    provider: 'codex',
    transport: 'local',
    model: 'codex-search',
    bounds: {
      invocationLimit: 1,
      resultLimit: 5,
      sourceLimit: 3,
      timeoutMs: 30_000,
      synthesisCharacterLimit: 4_000,
    },
    attemptCount: 1,
    executedQueries: ['official reversible trial measurement guidance 2026'],
    searchSynthesis: 'The source supports a baseline and a stopping rule.',
    directPageTextFetched: false,
    retrievedFacts: [],
    fetchFailures: [],
    sources: [{
      id: '82000000-0000-4000-8000-000000000001',
      citationId: 'source-1',
      ordinal: 1,
      title: 'Measurement guidance',
      url: 'https://www.nist.gov/example',
      hostname: 'www.nist.gov',
      trust: 'government_or_education',
      discoveredFrom: 'search_activity',
      createdAt: '2026-08-02T20:00:01.000Z',
    }],
    omittedSourceCount: 0,
    injectionSignalsDetected: [],
    contentDigest: 'e'.repeat(64),
    failureCode: null,
    startedAt: '2026-08-02T20:00:00.000Z',
    completedAt: '2026-08-02T20:00:30.000Z',
    createdAt: '2026-08-02T20:00:00.000Z',
    updatedAt: '2026-08-02T20:00:30.000Z',
  }
}

function makePortableLifecycle(game: DurableGame): LifecycleAggregate {
  const lifecycle = aggregate('charlotte_complete', 'answer')
  const portia = makePortablePortiaReview()
  const facet = game.division?.parts[9]
  if (!facet) throw new Error('The portable fixture is missing its mapped signal.')

  return {
    ...lifecycle,
    terminalFingerprint: 'f'.repeat(64),
    trajectoryDirectionalRecord: null,
    trajectoryDirectionalRecordStatus: 'legacy_pre_directional_generation',
    answerPromptDigest: PORTABLE_PROMPT_DIGEST,
    answerUserPrompt: PORTABLE_EXACT_INPUT,
    answerUserPromptSha256: PORTABLE_PROMPT_SHA256,
    survivors: [{
      candidateId: 'candidate-white-queen',
      pieceId: 'white-queen',
      side: 'white',
      pieceKind: 'queen',
      originalPieceKind: 'bishop',
      pieceRole: 'evidence-bearing survivor',
      sidePolarity: 'constructive test',
      finalCoordinate: { ring: 1, sector: 1 },
      facet,
      route: [{
        ply: 1,
        from: { ring: 2, sector: 1 },
        to: { ring: 1, sector: 1 },
        capturedPieceId: 'black-rook',
        promotedTo: 'queen',
      }],
      capturesMade: ['portable-capture-1'],
      attackedPlies: [1],
      moveCount: 1,
      promoted: true,
      terminalGameId: PORTABLE_GAME_ID,
      attemptId: PORTABLE_RUN_ID,
      sourceDigest: 'c'.repeat(64),
    }],
    portiaProgress: {
      currentCandidateId: null,
      completedCandidateIds: ['candidate-white-queen'],
      completedAssessments: portia.assessments,
    },
    portia,
    gate: {
      algorithmVersion: 'webchess-gate-v4',
      passed: true,
      usableCandidateCount: 1,
      preservedCount: 1,
      woundedCount: 0,
      consumedCount: 0,
      unresolvedCount: 0,
      independentClusterCount: 1,
      coverageResults: [{
        tag: 'evidence_or_reality',
        satisfied: true,
        candidateIds: ['candidate-white-queen'],
      }],
      severeUnresolvedObjectionCount: 0,
      contradictionResults: {
        fatalUnaddressedIds: [],
        tensionCandidatePairs: [],
      },
      missingRequirements: [],
      recommendedNextTransition: 'answer',
      explanation: 'Portia permitted the exact board-derived prompt.',
      inputDigest: 'b'.repeat(64),
    },
    research: [makePortableResearch()],
    versions: {
      software: CURRENT_LIFECYCLE_VERSIONS.software,
      lifecycle: 'webchess-lifecycle-v2.4',
      portiaPrompt: 'webchess-portia-v4',
      portiaContract: 'webchess-portia-review-v2',
      gateAlgorithm: 'webchess-gate-v4',
      retryPolicy: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      charlottePrompt: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      charlotteContract: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      wilburRecord: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      trajectoryDirectionalRecord: null,
      rules: CURRENT_GAME_VERSIONS.rules,
      engine: CURRENT_GAME_VERSIONS.engine,
      cast: CURRENT_GAME_VERSIONS.cast,
      event: CURRENT_GAME_VERSIONS.event,
    },
  }
}

function renderStage(
  lifecycle: LifecycleAggregate | null,
  options: {
    busy?: boolean
    caseExportError?: string
    caseExportNotice?: string
    caseExportPending?: boolean
    replayDisabled?: boolean
    replayError?: string
    replayPending?: boolean
    readOnly?: boolean
    localCaseVerificationEnabled?: boolean
    boardAnswer?: GeneratedAnswer | null
    answerFailurePrompt?: string
    game?: DurableGame | null
    gameStatus?: 'completed' | 'answering' | 'answer_failed' | 'answered'
    onCreateAction?: (index: number) => void
    onUpdateAction?: (action: WilburAction, status: WilburAction['status']) => void
    onObserve?: (
      action: WilburAction,
      observation: AppendWilburObservationCommand,
    ) => Promise<boolean>
    onExportCase?: (profile: WebChessCaseProfile) => Promise<void>
    onReplay?: () => void
    onVerifyCase?: (bundle: Blob) => Promise<WebChessCaseVerificationResult>
  } = {},
) {
  const onRetry = vi.fn()
  const onRetryAnswer = vi.fn()
  const onCreateAction = options.onCreateAction ?? vi.fn()
  const onUpdateAction = options.onUpdateAction ?? vi.fn()
  const onObserve = options.onObserve ?? vi.fn(async () => true)
  const onExportCase = options.onExportCase ?? vi.fn(async () => undefined)
  const onReplay = options.onReplay ?? vi.fn()
  const onVerifyCase = options.onVerifyCase ?? vi.fn(async () => ({
    ok: true,
    errors: [],
    warnings: [],
    verified: [],
    notVerified: [],
    replay: {
      checked: true,
      exactProblemMapping: true,
      completedPlies: 12,
      terminal: true,
    },
  }))

  render(
    <LifecycleStage
      problem="How should this decision be tested?"
      parts={[]}
      pieces={[]}
      captures={[]}
      lastMove={null}
      outcome={{ winner: null, reason: 'move-limit', completedTurn: 113 }}
      game={options.game ?? null}
      lifecycle={lifecycle}
      gameStatus={options.gameStatus ?? 'completed'}
      boardAnswer={options.boardAnswer ?? null}
      answerFailurePrompt={options.answerFailurePrompt ?? ''}
      busy={options.busy ?? false}
      readOnly={options.readOnly ?? false}
      error=""
      actionPendingIndex={null}
      wilburPending={false}
      caseExportPending={options.caseExportPending ?? false}
      caseExportError={options.caseExportError ?? ''}
      caseExportNotice={options.caseExportNotice ?? ''}
      replayPending={options.replayPending ?? false}
      replayError={options.replayError ?? ''}
      replayDisabled={options.replayDisabled ?? false}
      localCaseVerificationEnabled={options.localCaseVerificationEnabled ?? false}
      onRefresh={vi.fn()}
      onRetry={onRetry}
      onRetryAnswer={onRetryAnswer}
      onCreateAction={onCreateAction}
      onUpdateAction={onUpdateAction}
      onObserve={onObserve}
      onExportCase={onExportCase}
      onVerifyCase={onVerifyCase}
      onReplay={onReplay}
    />,
  )

  return {
    onCreateAction,
    onObserve,
    onExportCase,
    onReplay,
    onVerifyCase,
    onRetry,
    onRetryAnswer,
    onUpdateAction,
  }
}

describe('LifecycleStage terminal Gate experience', () => {
  it('shows an honest loading state while the durable lifecycle is restored', () => {
    renderStage(null, { busy: true })

    expect(screen.getByText('Finding the lifecycle thread')).toBeInTheDocument()
    expect(screen.getByText('Terminal survivors').closest('div'))
      .toHaveTextContent('—')
    expect(screen.queryByLabelText('WebChess 2.2 lifecycle progress'))
      .not.toBeInTheDocument()
  })

  it('does not present an active loading graphic for a null read-only lifecycle', () => {
    renderStage(null, {
      busy: false,
      readOnly: true,
      gameStatus: 'answering',
    })

    expect(screen.queryByText('Finding the lifecycle thread'))
      .not.toBeInTheDocument()
    expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  })

  it('shows the bound full-trajectory record and its directional Portia amendments', () => {
    renderStage(makeDirectionalLifecycle())

    const provenance = screen.getByRole('region', {
      name: 'Full-trajectory directional provenance',
    })
    expect(within(provenance).getByText(DIRECTIONAL_RECORD_VERSION))
      .toBeInTheDocument()
    expect(within(provenance).getByText(DIRECTIONAL_RECORD_DIGEST))
      .toBeInTheDocument()
    expect(within(provenance).getByText(/All 95 canonical plies/i))
      .toBeInTheDocument()
    expect(within(provenance).getByText(/retained the replay-derived change/i))
      .toBeInTheDocument()
    expect(within(provenance).getByRole('heading', {
      name: 'Directions carried into scrutiny',
    })).toBeInTheDocument()
    expect(within(provenance).getByRole('heading', {
      name: 'Adapt / Refine',
    })).toBeInTheDocument()
    expect(within(provenance).getByText('Score 1327')).toBeInTheDocument()
    expect(within(provenance).getByText(/ordered arrivals, a high-value capture/i))
      .toBeInTheDocument()
    expect(within(provenance).getByRole('heading', {
      name: 'Resources / Examine',
    })).toBeInTheDocument()
    expect(within(provenance).getByText('Score 884')).toBeInTheDocument()

    const boundary = within(provenance).getByLabelText(
      'Directional evidence boundary',
    )
    expect(boundary).toHaveTextContent(/required directional input/i)
    expect(boundary).toHaveTextContent(/not external factual evidence/i)
    expect(boundary).toHaveTextContent(
      /cannot override verified facts, consent, safety constraints/i,
    )

    const contributionDetails = within(provenance).getAllByText(
      'Inspect calculated contribution ledger',
    )[0]!.closest('details')
    expect(contributionDetails).not.toBeNull()
    fireEvent.click(within(contributionDetails as HTMLElement).getByText(
      'Inspect calculated contribution ledger',
    ))
    expect(contributionDetails).toHaveAttribute('open')
    expect(within(contributionDetails as HTMLElement).getByText('Captured material'))
      .toBeInTheDocument()
    expect(within(contributionDetails as HTMLElement).getByText('12'))
      .toBeInTheDocument()

    const assessmentDetails = screen.getByText(
      'Inspect survivor-by-survivor findings',
    ).closest('details')
    expect(assessmentDetails).not.toBeNull()
    fireEvent.click(within(assessmentDetails as HTMLElement).getByText(
      'Inspect survivor-by-survivor findings',
    ))
    const directionalAssessment = screen.getByRole('region', {
      name: 'Directional scrutiny for candidate-white-queen',
    })
    expect(within(directionalAssessment).getByText(PRIMARY_DIRECTION_KEY))
      .toBeInTheDocument()
    expect(within(directionalAssessment).getByText(SECONDARY_DIRECTION_KEY))
      .toBeInTheDocument()
    expect(within(directionalAssessment).getByText(/directs this survivor toward/i))
      .toBeInTheDocument()
    expect(within(directionalAssessment).getByText(/State the reversal threshold/i))
      .toBeInTheDocument()
  })

  it('labels a preserved pre-directional run without inventing provenance', () => {
    renderStage({
      ...aggregate('portia_complete', 'answer'),
      trajectoryDirectionalRecord: null,
      trajectoryDirectionalRecordStatus: 'legacy_pre_directional_generation',
      portia: makePortablePortiaReview(),
    } as LifecycleAggregate)

    const legacyNotice = screen.getByRole('note', {
      name: 'Legacy directional provenance status',
    })
    expect(legacyNotice).toHaveTextContent('legacy_pre_directional_generation')
    expect(legacyNotice).toHaveTextContent(/predates the versioned full-trajectory/i)
    expect(legacyNotice).toHaveTextContent(/does not reconstruct or fabricate/i)
    expect(screen.queryByRole('region', {
      name: 'Full-trajectory directional provenance',
    })).not.toBeInTheDocument()
    expect(screen.queryByText(PRIMARY_DIRECTION_KEY)).not.toBeInTheDocument()
  })

  it.each([
    ['portia_pending', 'completed', 'Portia is testing every survivor'],
    ['portia_running', 'completed', 'Portia is testing every survivor'],
    ['portia_complete', 'completed', 'The Gate is checking sufficiency'],
    ['gate_passed', 'completed', 'The board-derived answer is ready to generate'],
    ['gate_passed', 'answering', 'The approved board prompt is generating the answer'],
    ['gate_passed', 'answer_failed', 'The approved prompt is waiting for a fresh Answer attempt'],
    ['gate_passed', 'answered', 'Charlotte is checking truthfulness and audience fit'],
    ['charlotte_pending', 'answered', 'Charlotte is applying corrections to the final answer'],
    ['charlotte_running', 'answered', 'Charlotte is applying corrections to the final answer'],
    ['gate_failed', 'completed', 'The web needs another path'],
    ['retry_ready', 'completed', 'Retry is changing one variable'],
    ['retry_running', 'completed', 'Retry is changing one variable'],
    ['chess_terminal', 'completed', 'The lifecycle record is ready'],
  ] as const)(
    'names the active %s lifecycle state without overstating completion',
    (state, gameStatus, headline) => {
      const lifecycle = aggregate(
        state,
        state === 'gate_failed' || state.startsWith('retry_')
          ? 'retry_game'
          : 'answer',
      )
      const passedGate = state === 'gate_passed' || state.startsWith('charlotte_')
        ? {
            ...lifecycle,
            gate: {
              ...lifecycle.gate!,
              passed: true,
              missingRequirements: [],
              recommendedNextTransition: 'answer' as const,
            },
          }
        : lifecycle

      renderStage(passedGate, { busy: true, gameStatus })

      expect(screen.getByTestId('process-graphic')).toHaveTextContent(headline)
    },
  )

  it('offers a counted same-field replay after the v2 lifecycle completes', () => {
    const onReplay = vi.fn()
    renderStage(aggregate('wilbur_observed', 'answer'), { onReplay })

    expect(screen.getByText(/new counted trajectory/i)).toBeInTheDocument()
    expect(screen.getByText(/completed game and its lifecycle remain preserved/i))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: /start another game on this field/i,
    }))
    expect(onReplay).toHaveBeenCalledOnce()
  })

  it('keeps the v2 replay action disabled while creation is pending', () => {
    renderStage(aggregate('charlotte_complete', 'answer'), {
      replayDisabled: true,
      replayPending: true,
    })

    expect(screen.getByRole('button', {
      name: /creating same-field replay/i,
    })).toBeDisabled()
  })

  it('keeps historical replay visible but read-only', () => {
    const onReplay = vi.fn()
    renderStage(aggregate('charlotte_complete', 'answer'), {
      onReplay,
      readOnly: true,
    })

    const replay = screen.getByRole('button', {
      name: /start another game on this field/i,
    })
    expect(replay).toBeDisabled()
    fireEvent.click(replay)
    expect(onReplay).not.toHaveBeenCalled()
  })

  it('exports the selected case profile without calling a provider', async () => {
    const onExportCase = vi.fn(async () => undefined)
    renderStage(aggregate('charlotte_complete', 'answer'), { onExportCase })

    const profile = screen.getByRole('combobox', {
      name: /case bundle export profile/i,
    })
    expect(profile).toHaveValue('research-redacted-v1')
    fireEvent.change(profile, { target: { value: 'private-full-v1' } })
    fireEvent.click(screen.getByRole('button', { name: /download case bundle/i }))

    await waitFor(() => {
      expect(onExportCase).toHaveBeenCalledWith('private-full-v1')
    })
    expect(screen.getByText(/does not validate the method’s efficacy/i))
      .toBeInTheDocument()
    expect(screen.getByText(/redacted bundles remain pseudonymous/i))
      .toBeInTheDocument()
  })

  it('announces a completed browser download', () => {
    renderStage(aggregate('charlotte_complete', 'answer'), {
      caseExportNotice:
        'Downloaded the research-redacted-v1 point-in-time case bundle.',
    })

    expect(screen.getByText(
      /downloaded the research-redacted-v1 point-in-time case bundle/i,
    )).toHaveAttribute('role', 'status')
  })

  it('verifies one local case read-only and reports replay boundaries', async () => {
    const result: WebChessCaseVerificationResult = {
      ok: true,
      errors: [],
      warnings: [
        'No local source context was supplied; package, commit, and migration-source compatibility were not checked.',
      ],
      verified: [
        'canonical section digests and integrity root',
        'event-by-event canonical board reconstruction and terminal summary',
      ],
      notVerified: [
        'Arachne or WebChess efficacy, validity, truthfulness, or research conclusions',
      ],
      replay: {
        checked: true,
        exactProblemMapping: false,
        completedPlies: 113,
        terminal: true,
      },
    }
    const onVerifyCase = vi.fn(async () => result)
    renderStage(aggregate('charlotte_complete', 'answer'), {
      localCaseVerificationEnabled: true,
      onVerifyCase,
    })

    const file = new File(['{"format":"webchess-case-bundle/1"}'], 'case.json', {
      type: 'application/json',
    })
    fireEvent.change(screen.getByLabelText(/case bundle json/i), {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByRole('button', {
      name: /import & verify case bundle/i,
    }))

    await waitFor(() => expect(onVerifyCase).toHaveBeenCalledWith(file))
    expect(screen.getByRole('heading', {
      name: /case structure and replay checks passed/i,
    })).toBeInTheDocument()
    expect(screen.getByText(/113 plies reconstructed/i)).toBeInTheDocument()
    expect(screen.getByText(/redaction-safe neutral mapping/i)).toBeInTheDocument()
    expect(screen.getByText(/does not persist the file, call OpenClaw/i))
      .toBeInTheDocument()
    expect(screen.getByText(/does not receive local source, artifact, or migration context/i))
      .toBeInTheDocument()
    expect(screen.getByText(/establish that Arachne is effective/i))
      .toBeInTheDocument()
  })

  it('does not offer local case import in the hosted lifecycle', () => {
    renderStage(aggregate('charlotte_complete', 'answer'))

    expect(screen.queryByLabelText(/case bundle json/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: /import & verify case bundle/i,
    })).not.toBeInTheDocument()
  })

  it('settles a failed Answer and offers one explicit fresh attempt', () => {
    const lifecycle = aggregate('gate_passed', 'answer')
    const { onRetryAnswer } = renderStage(
      {
        ...lifecycle,
        gate: {
          ...lifecycle.gate!,
          passed: true,
          missingRequirements: [],
          recommendedNextTransition: 'answer',
          explanation: 'Portia permitted the exact board-derived prompt.',
        },
      },
      { gameStatus: 'answer_failed' },
    )

    expect(screen.getByRole('heading', {
      name: 'The Answer response could not be accepted',
    })).toBeInTheDocument()
    expect(screen.getByText(/Automatic retries have stopped/i)).toBeInTheDocument()
    expect(screen.queryByTestId('process-graphic')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try the answer again' }))
    expect(onRetryAnswer).toHaveBeenCalledOnce()
  })

  it('disables Answer retry for a historical lifecycle', () => {
    const lifecycle = aggregate('gate_passed', 'answer')
    const { onRetryAnswer } = renderStage(
      {
        ...lifecycle,
        gate: {
          ...lifecycle.gate!,
          passed: true,
          missingRequirements: [],
          recommendedNextTransition: 'answer',
          explanation: 'The historical Gate permitted its saved prompt.',
        },
      },
      { gameStatus: 'answer_failed', readOnly: true },
    )

    const retry = screen.getByRole('button', { name: 'Try the answer again' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(onRetryAnswer).not.toHaveBeenCalled()
  })

  it('discloses the exact safe corrective prompt on terminal Answer contract failure', () => {
    const lifecycle = aggregate('gate_passed', 'answer')
    renderStage(
      {
        ...lifecycle,
        gate: {
          ...lifecycle.gate!,
          passed: true,
          missingRequirements: [],
          recommendedNextTransition: 'answer',
          explanation: 'Portia permitted the exact board-derived prompt.',
        },
      },
      {
        gameStatus: 'answer_failed',
        answerFailurePrompt: 'SYSTEM ROLE\n\nCORRECTION REQUIRED\nVerified board evidence.',
      },
    )

    const disclosure = screen.getByText(
      'Inspect corrective Answer role content',
    ).closest('details')
    expect(disclosure).not.toBeNull()
    expect(disclosure).not.toHaveAttribute('open')
    fireEvent.click(within(disclosure as HTMLElement).getByText(
      'Inspect corrective Answer role content',
    ))
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByRole('region', {
      name: 'Corrective Answer role content',
    })).toHaveTextContent('CORRECTION REQUIRED')
    expect(screen.getByText(/not yet persisted across reload/i))
      .toBeInTheDocument()
    expect(screen.getByText(/can consume up to two additional OpenClaw model turns/i))
      .toBeInTheDocument()
    expect(screen.getByText(/excludes credentials, private model reasoning/i))
      .toBeInTheDocument()
  })

  it('reopens a premature terminal stop when its bounded field repair was unused', () => {
    const lifecycle = {
      ...aggregate('insufficient_basis', 'insufficient_basis'),
      portia: {
        ...makePortablePortiaReview(),
        promptDecision: 'deny' as const,
        promptDecisionRationale:
          'The current evidence and scope require one bounded repair.',
      },
    }
    const { onRetry } = renderStage(lifecycle)

    expect(screen.getByRole('heading', {
      name: 'This prompt has one bounded repair path.',
    })).toBeInTheDocument()
    expect(screen.queryByRole('heading', {
      name: 'Inquiry complete: insufficient basis',
    })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'Try a bounded evidence repair',
    }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it.each([
    ['the Gate recommendation', 'gate_failed' as const, 'insufficient_basis' as const],
    ['the persisted lifecycle state', 'insufficient_basis' as const, 'retry_game' as const],
  ])('presents insufficient basis as complete from %s', (_label, state, recommendation) => {
    renderStage(aggregate(state, recommendation, {
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 1,
    }))

    expect(screen.getByRole('heading', { name: 'The Gate reached a bounded stop.' }))
      .toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inquiry complete: insufficient basis' }))
      .toBeInTheDocument()
    expect(screen.getByText(/valid WebChess conclusion, not a stalled game/i))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /bounded path/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('process-graphic')).not.toBeInTheDocument()

    const budget = screen.getByText('Further same-field paths').closest('dl')
    expect(budget).not.toBeNull()
    if (!budget) throw new Error('The authorized-path summary was not rendered.')
    expect(within(budget).getAllByText('0 authorized · Gate stop')).toHaveLength(2)
    expect(screen.queryByText(/-\d/)).not.toBeInTheDocument()
  })

  it('disables the retry action and names the pending state while a retry starts', () => {
    renderStage(aggregate('retry_running', 'retry_game'), { busy: true })

    expect(screen.getByRole('button', { name: 'Starting next bounded path…' }))
      .toBeDisabled()
    expect(screen.getByRole('button', { name: 'Starting next bounded path…' }))
      .toHaveAttribute('aria-busy', 'true')
  })

  it('shows a bounded technical stop without presenting its retained audit candidate as current', () => {
    const unavailableLifecycle = {
      ...aggregate('portia_unavailable', 'retry_game'),
      answerPromptDigest: 'd'.repeat(64),
      portiaActiveModelRequestId: null,
      portiaFailedAttemptCount: 3,
      portiaFailureLimit: 3,
      survivors: [
        {
          candidateId: 'candidate-1',
          finalCoordinate: { ring: 0, sector: 0 },
          facet: { title: 'Reviewed signal one', focus: 'Completed review one' },
        },
        {
          candidateId: 'candidate-2',
          finalCoordinate: { ring: 1, sector: 1 },
          facet: { title: 'Reviewed signal two', focus: 'Completed review two' },
        },
        {
          candidateId: 'candidate-3',
          finalCoordinate: { ring: 2, sector: 2 },
          facet: { title: 'Stale terminal candidate', focus: 'Must not remain current' },
        },
      ],
      portiaProgress: {
        currentCandidateId: 'candidate-3',
        completedCandidateIds: ['candidate-1', 'candidate-2'],
        completedAssessments: [],
      },
      portia: null,
      gate: null,
    } as unknown as LifecycleAggregate

    renderStage(unavailableLifecycle)

    const stop = screen.getByRole('status', {
      name: 'Inquiry complete: prompt validation unavailable',
    })
    expect(stop).toHaveTextContent(/bounded technical stop, not a stalled game/i)
    expect(stop).toHaveTextContent(/after 3 of its 3 provider attempts/i)
    expect(stop).toHaveTextContent(/No prompt was permitted and no substantive answer was generated/i)
    expect(screen.getByTestId('radial-board')).toHaveAttribute(
      'data-portia-status',
      'unavailable',
    )
    expect(screen.getByTestId('radial-board')).toHaveTextContent(
      /2 of 3 board signals have saved reviews; no answer was generated/i,
    )
    expect(screen.getByTestId('radial-board'))
      .not.toHaveAttribute('data-portia-current-cell')
    expect(screen.getByTestId('radial-board'))
      .not.toHaveAttribute('data-portia-current-label')
    expect(screen.getByTestId('radial-board')).toHaveAttribute(
      'data-portia-reviewed-cells',
      '0:0,1:1',
    )
    expect(screen.getByTestId('radial-board')).not.toHaveTextContent(/Current signal:/i)
    expect(screen.getByTestId('radial-board')).not.toHaveTextContent(
      /Stale terminal candidate/i,
    )
    expect(screen.queryByRole('heading', {
      name: 'The Board Answer retained for provenance',
    })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', {
      name: 'Final answer after Charlotte review',
    })).not.toBeInTheDocument()
    expect(screen.queryByTestId('process-graphic')).not.toBeInTheDocument()

    const budget = screen.getByText('Further same-field paths').closest('dl')
    expect(budget).not.toBeNull()
    if (!budget) throw new Error('The Portia-stop budget summary was not rendered.')
    expect(within(budget).getAllByText('0 authorized · Portia stop')).toHaveLength(2)
  })

  it('retains the Board Answer as provenance before Charlotte’s corrected final answer', () => {
    const lifecycle = aggregate('charlotte_complete', 'answer')
    const exactQualifications = [
      'Use this wounded signal only as a bounded hypothesis until direct observation confirms it.',
      'Keep the affected stakeholder visible and reverse course if the stated harm signal appears.',
    ] as const
    const completedLifecycle = {
      ...lifecycle,
      gate: {
        ...lifecycle.gate,
        passed: true,
        missingRequirements: [],
        recommendedNextTransition: 'answer' as const,
        explanation: 'Portia permitted the exact board-derived prompt.',
      },
      charlotte: {
        supportingCandidateIds: ['candidate-wounded-1', 'candidate-wounded-2'],
        qualificationsByCandidateId: {
          'candidate-wounded-1': exactQualifications[0],
          'candidate-wounded-2': exactQualifications[1],
        },
        exactlyThreeNextActions: [],
      },
      charlotteRenderedAnswer: [
        '# Final answer after Charlotte',
        '',
        '## Corrected audience-ready answer',
        'Charlotte preserves the claim while naming its limits.',
        '',
        '## Applied Portia qualifications',
        `- candidate-wounded-1: ${exactQualifications[0]}`,
        `- candidate-wounded-2: ${exactQualifications[1]}`,
      ].join('\n'),
    } as unknown as LifecycleAggregate

    renderStage(completedLifecycle, {
      boardAnswer: {
        answer: 'The weighted board supports a small, reversible trial.',
        model: 'test-model',
        prompt: 'approved board prompt',
      },
    })

    const boardHeading = screen.getByRole('heading', {
      name: 'The Board Answer retained for provenance',
    })
    const charlotteHeading = screen.getByRole('heading', {
      name: 'Final answer after Charlotte review',
    })

    expect(screen.getByText(/weighted board supports a small, reversible trial/i))
      .toBeInTheDocument()
    expect(screen.getByText(/Portia\/Gate-approved draft is retained for comparison/i))
      .toBeInTheDocument()
    expect(screen.getByText(/Charlotte preserves the claim while naming its limits/i))
      .toBeInTheDocument()
    expect(screen.getByText(/already applied its material corrections and qualifications/i))
      .toBeInTheDocument()
    const charlotteCard = charlotteHeading.closest('section')
    expect(charlotteCard).not.toBeNull()
    if (!charlotteCard) throw new Error('The completed Charlotte card was not rendered.')
    const structuredSupport = charlotteCard.querySelector<HTMLElement>('.charlotte-support')
    expect(structuredSupport).not.toBeNull()
    if (!structuredSupport) throw new Error('Charlotte’s structured support was not rendered.')
    for (const exactQualification of exactQualifications) {
      expect(within(structuredSupport).queryByText(exactQualification)).not.toBeInTheDocument()
      expect(charlotteCard).toHaveTextContent(exactQualification)
      expect(charlotteCard.textContent?.split(exactQualification)).toHaveLength(2)
    }
    expect(
      boardHeading.compareDocumentPosition(charlotteHeading)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('gives each canonical Charlotte action a stable card key and action-specific controls', () => {
    const lifecycle = aggregate('charlotte_complete', 'answer')
    const suggestions = Array.from({ length: 3 }, (_, index) => ({
      title: 'Run a bounded trial',
      actor: `Owner ${index + 1}`,
      assumptionBeingTested: `Assumption ${index + 1}`,
      smallestAction: `Run bounded trial ${index + 1}.`,
      expectedObservation: `Observe signal ${index + 1}.`,
      decisionThreshold: `Continue at threshold ${index + 1}.`,
      reviewHorizon: `${index + 1} week`,
      reversibility: 'Stop and restore the prior state.',
      risksOrAffectedParties: 'Stop if the protected outcome is threatened.',
      decisionRule: 'revise' as const,
    }))
    const trackedAction: WilburAction = {
      id: '83000000-0000-4000-8000-000000000001',
      lifecycleRunId: lifecycle.id,
      charlotteActionIndex: 0,
      charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
      actor: suggestions[0]!.actor,
      action: suggestions[0]!.smallestAction,
      testedAssumption: suggestions[0]!.assumptionBeingTested,
      expectedObservation: suggestions[0]!.expectedObservation,
      decisionThreshold: suggestions[0]!.decisionThreshold,
      reviewHorizon: suggestions[0]!.reviewHorizon,
      followUpAt: null,
      status: 'planned',
      revision: 0,
      version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      createdAt: '2026-08-15T16:00:00.000Z',
      updatedAt: '2026-08-15T16:00:00.000Z',
    }
    const legacyAction: WilburAction = {
      ...trackedAction,
      id: '83000000-0000-4000-8000-000000000002',
      charlotteActionIndex: 2,
      charlotteBindingVersion: null,
      action: 'Preserved action from before canonical Charlotte binding.',
    }
    const completedLifecycle = {
      ...lifecycle,
      charlotte: {
        supportingCandidateIds: [],
        qualificationsByCandidateId: {},
        exactlyThreeNextActions: suggestions,
      },
      charlotteRenderedAnswer: 'Run one bounded test and decide from the observation.',
      wilburActions: [trackedAction, legacyAction],
    } as unknown as LifecycleAggregate
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onCreateAction = vi.fn()
    const onUpdateAction = vi.fn()

    renderStage(completedLifecycle, { onCreateAction, onUpdateAction })

    expect(consoleError).not.toHaveBeenCalled()
    const status = screen.getByRole('combobox', {
      name: 'Status for Action 1: Run a bounded trial',
    })
    const record = screen.getByRole('button', {
      name: 'Record what happened for Action 1: Run a bounded trial',
    })
    const track = screen.getByRole('button', {
      name: 'Track Action 2: Run a bounded trial with Wilbur',
    })
    expect(screen.getByRole('button', {
      name: 'Track Action 3: Run a bounded trial with Wilbur',
    })).toBeInTheDocument()
    expect(screen.getByText('Legacy history · unbound to current Charlotte'))
      .toBeInTheDocument()

    fireEvent.change(status, { target: { value: 'in_progress' } })
    fireEvent.click(record)
    fireEvent.click(track)

    expect(onUpdateAction).toHaveBeenCalledWith(
      trackedAction,
      'in_progress',
      null,
    )
    expect(onCreateAction).toHaveBeenCalledWith(1, expect.any(String))
    expect(screen.getByRole('textbox', { name: 'What did you observe?' }))
      .toBeInTheDocument()
  })

  it('reveals the exact durable user prompt in a collapsed Portia-to-Answer handoff', () => {
    const exactUserPrompt = JSON.stringify({
      reviewed_prompt: {
        game_evidence: {
          original_problem: 'How should this decision be tested?',
        },
      },
      portia_authorization: {
        usable_candidates: [{ candidate: 'candidate-wounded-1', weight: 83 }],
      },
    }, null, 2)
    const promptSha256 = 'a'.repeat(64)
    const lifecycle = aggregate('charlotte_complete', 'answer')
    const completedLifecycle = {
      ...lifecycle,
      answerUserPrompt: exactUserPrompt,
      answerUserPromptSha256: promptSha256,
      gate: {
        ...lifecycle.gate,
        passed: true,
        missingRequirements: [],
        recommendedNextTransition: 'answer' as const,
        explanation: 'Portia permitted the exact board-derived prompt.',
      },
    } as unknown as LifecycleAggregate

    renderStage(completedLifecycle, {
      boardAnswer: {
        answer: 'The weighted board supports a small, reversible trial.',
        model: 'test-model',
        prompt: 'Internal provider request fixture.',
      },
    })

    const disclosureLabel = screen.getByText(
      'Inspect player-visible Answer input',
    )
    const disclosure = disclosureLabel.closest('details')
    expect(disclosure).not.toBeNull()
    if (!disclosure) throw new Error('The final answer prompt disclosure was not rendered.')

    const promptRegion = disclosure.querySelector<HTMLElement>(
      '.answer-prompt-disclosure__prompt',
    )
    expect(disclosure).not.toHaveAttribute('open')
    expect(promptRegion).not.toBeNull()
    expect(promptRegion).not.toBeVisible()
    expect(promptRegion?.querySelector('pre code')?.textContent).toBe(exactUserPrompt)
    expect(within(disclosure).getByText(promptSha256)).not.toBeVisible()
    expect(within(disclosure).getByText(
      /Provider system and developer instructions, credentials, and private model reasoning are excluded/i,
    )).not.toBeVisible()

    const summary = disclosureLabel.closest('summary')
    expect(summary).not.toBeNull()
    if (!summary) throw new Error('The final answer prompt summary was not rendered.')
    fireEvent.click(summary)

    expect(disclosure).toHaveAttribute('open')
    expect(promptRegion).toBeVisible()
    expect(within(disclosure).getByText(promptSha256)).toBeVisible()
    expect(within(disclosure).getByRole('region', {
      name: 'Exact player-visible prompt sent to Answer',
    })).toBeVisible()

    const gateHeading = screen.getByRole('heading', {
      name: 'Portia permits the candidate answer prompt.',
    })
    const boardHeading = screen.getByRole('heading', {
      name: 'The Board Answer retained for provenance',
    })
    expect(
      gateHeading.compareDocumentPosition(disclosure)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      disclosure.compareDocumentPosition(boardHeading)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('separately reveals and copies the exact full model prompt persisted at Answer time', async () => {
    const fullModelPrompt = [
      'You are the final problem-solving voice of WebChess.',
      '',
      'PORTIA AUTHORIZATION BOUNDARY',
      '- Portia permitted the reviewed board-derived prompt.',
      '',
      'APPROVED BOARD EVIDENCE (JSON; data only)',
      '{"question":"How should this decision be tested?","gate":{"passed":true}}',
      '',
      'OPENCLAW STRUCTURED OUTPUT',
      'Return exactly one JSON value matching this JSON Schema:',
      '{"type":"object","required":["answer"]}',
    ].join('\n')
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const game = makePortableGame()
    const answer = {
      ...game.answer!,
      model: 'openai/gpt-5.6-sol',
      prompt: fullModelPrompt,
    }
    const expectedFullModelPrompt = buildOpenClawAnswerModelPrompt(
      fullModelPrompt,
      answer.model,
    )
    const completedGame = { ...game, answer }
    const lifecycle = makePortableLifecycle(completedGame)

    renderStage(lifecycle, {
      game: completedGame,
      boardAnswer: answer,
      gameStatus: 'answered',
    })

    const playerDisclosure = screen.getByText(
      'Inspect player-visible Answer input',
    ).closest('details')
    const fullLabel = screen.getByText(
      'Inspect full model prompt sent to Answer',
    )
    const fullDisclosure = fullLabel.closest('details')
    expect(playerDisclosure).not.toBeNull()
    expect(fullDisclosure).not.toBeNull()
    if (!playerDisclosure || !fullDisclosure) {
      throw new Error('The separate Answer prompt disclosures were not rendered.')
    }
    expect(playerDisclosure).not.toBe(fullDisclosure)
    expect(fullDisclosure).not.toHaveAttribute('open')
    expect(within(fullDisclosure).getByRole('region', {
      name: 'Full model prompt sent to Answer',
    })).not.toBeVisible()
    expect(fullDisclosure.querySelector('pre code')?.textContent)
      .toBe(expectedFullModelPrompt)

    const summary = fullLabel.closest('summary')
    expect(summary).not.toBeNull()
    if (!summary) throw new Error('The full model prompt summary was not rendered.')
    fireEvent.click(summary)

    expect(fullDisclosure).toHaveAttribute('open')
    expect(within(fullDisclosure).getByText(/leading system\/application instructions/i))
      .toBeVisible()
    expect(within(fullDisclosure).getByText(/predates role-envelope persistence/i))
      .toBeVisible()
    fireEvent.click(within(fullDisclosure).getByRole('button', {
      name: 'Copy full model prompt',
    }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedFullModelPrompt))
    const copiedArtifact = JSON.parse(expectedFullModelPrompt) as {
      systemPrompt: string
      messages: Array<{ content: string }>
    }
    expect(copiedArtifact.systemPrompt).toBe(OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT)
    expect(copiedArtifact.messages[0]?.content).toBe(fullModelPrompt)
    expect(within(fullDisclosure).getByRole('status')).toHaveTextContent(
      'Full model prompt copied to the clipboard.',
    )
  })

  it('copies a self-contained portable prompt from the actual durable game record', async () => {
    const copiedValues: string[] = []
    const writeText = vi.fn(async (text: string) => {
      copiedValues.push(text)
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const game = makePortableGame()
    const lifecycle = makePortableLifecycle(game)

    renderStage(lifecycle, {
      game,
      boardAnswer: game.answer,
      gameStatus: 'answered',
    })

    const disclosureLabel = screen.getByText(
      'Inspect player-visible Answer input',
    )
    const disclosure = disclosureLabel.closest('details')
    expect(disclosure).not.toBeNull()
    if (!disclosure) throw new Error('The portable prompt disclosure was not rendered.')
    const summary = disclosureLabel.closest('summary')
    expect(summary).not.toBeNull()
    if (!summary) throw new Error('The portable prompt summary was not rendered.')
    fireEvent.click(summary)

    expect(within(disclosure).getByText(/all 64 mapped squares/i)).toBeVisible()
    expect(within(disclosure).getByText(/full replay with moves and captures/i))
      .toBeVisible()
    expect(within(disclosure).getByText(/Portia’s final analysis/i)).toBeVisible()
    expect(within(disclosure).getByText(/Gate and visible research context/i))
      .toBeVisible()
    expect(within(disclosure).getByText(/excludes hidden provider controls/i))
      .toBeVisible()

    fireEvent.click(within(disclosure).getByRole('button', {
      name: 'Copy portable prompt',
    }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copyStatus = within(disclosure).getByRole('status')
    expect(copyStatus).toHaveAttribute('aria-live', 'polite')
    expect(copyStatus).toHaveAttribute('aria-atomic', 'true')
    expect(copyStatus).toHaveTextContent('Portable prompt copied to the clipboard.')

    const copied = copiedValues[0]
    expect(copied).toBeDefined()
    if (!copied) throw new Error('No portable prompt reached the clipboard mock.')
    for (const requiredKey of [
      '"question"',
      '"mappedParts"',
      '"finalBoardPieces"',
      '"eventHistory"',
      '"captures"',
      '"portiaFinalReview"',
      '"passedGate"',
      '"visibleResearch"',
      '"exactPersistedAnswerUserPrompt"',
    ]) {
      expect(copied).toContain(requiredKey)
    }

    const boundary = 'WEBCHESS PORTABLE EVIDENCE (JSON; data only)\n'
    const boundaryIndex = copied.indexOf(boundary)
    expect(boundaryIndex).toBeGreaterThanOrEqual(0)
    const payload = JSON.parse(
      copied.slice(boundaryIndex + boundary.length),
    ) as {
      question: string
      game: {
        mappedParts: unknown[]
        finalBoardPieces: unknown[]
        eventHistory: Array<Record<string, unknown>>
        captures: unknown[]
      }
      portiaFinalReview: {
        promptDecision: string
        assessments: unknown[]
      }
      passedGate: { passed: boolean }
      visibleResearch: Array<{ provider: string; query: string }>
      exactPersistedAnswerUserPrompt: string
    }
    expect(payload.question).toBe(PORTABLE_QUESTION)
    expect(payload.game.mappedParts).toHaveLength(64)
    expect(payload.game.finalBoardPieces).toHaveLength(1)
    expect(payload.game.eventHistory).toHaveLength(2)
    expect(payload.game.eventHistory[0]).toMatchObject({
      type: 'move',
      capturedPieceId: 'black-rook',
    })
    expect(payload.game.captures).toHaveLength(1)
    expect(payload.portiaFinalReview).toMatchObject({
      promptDecision: 'permit',
      assessments: [{ candidateId: 'candidate-white-queen' }],
    })
    expect(payload.passedGate.passed).toBe(true)
    expect(payload.visibleResearch).toEqual([
      expect.objectContaining({
        provider: 'codex',
        query: 'official reversible trial measurement guidance 2026',
      }),
    ])
    expect(payload.exactPersistedAnswerUserPrompt).toBe(PORTABLE_EXACT_INPUT)
    for (const sentinel of HIDDEN_CONTROL_SENTINELS) {
      expect(copied).not.toContain(sentinel)
    }
  })

  it('announces a clipboard error when both copy paths are unavailable', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('Clipboard permission denied')
    })
    const execCommand = vi.fn(() => false)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })
    const game = makePortableGame()
    const lifecycle = makePortableLifecycle(game)

    renderStage(lifecycle, { game })

    const disclosureLabel = screen.getByText(
      'Inspect player-visible Answer input',
    )
    const disclosure = disclosureLabel.closest('details')
    expect(disclosure).not.toBeNull()
    if (!disclosure) throw new Error('The portable prompt disclosure was not rendered.')
    const summary = disclosureLabel.closest('summary')
    expect(summary).not.toBeNull()
    if (!summary) throw new Error('The portable prompt summary was not rendered.')
    fireEvent.click(summary)
    fireEvent.click(within(disclosure).getByRole('button', {
      name: 'Copy portable prompt',
    }))

    const copyStatus = within(disclosure).getByRole('status')
    await waitFor(() => expect(copyStatus).toHaveTextContent(
      'The portable prompt could not be copied.',
    ))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(copyStatus).toHaveAttribute('aria-live', 'polite')
    expect(copyStatus).toHaveAttribute('aria-atomic', 'true')
  })

  it('does not show a final prompt disclosure before the durable user prompt exists', () => {
    const lifecycle = aggregate('gate_passed', 'answer')
    const passedLifecycle = {
      ...lifecycle,
      gate: {
        ...lifecycle.gate,
        passed: true,
        missingRequirements: [],
        recommendedNextTransition: 'answer' as const,
      },
    } as unknown as LifecycleAggregate

    renderStage(passedLifecycle)

    expect(screen.queryByText('Inspect player-visible Answer input'))
      .not.toBeInTheDocument()
    expect(screen.queryByText('Inspect full model prompt sent to Answer'))
      .not.toBeInTheDocument()
  })

  it('keeps the board Answer visible when Charlotte exhausts its bounded attempts', () => {
    const lifecycle = aggregate('charlotte_unavailable', 'answer')
    const unavailableLifecycle = {
      ...lifecycle,
      gate: {
        ...lifecycle.gate,
        passed: true,
        missingRequirements: [],
        recommendedNextTransition: 'answer' as const,
        explanation: 'Portia permitted the exact board-derived prompt.',
      },
      charlotteActiveModelRequestId: null,
      charlotteFailedAttemptCount: 3,
      charlotteFailureLimit: 3,
      charlotte: null,
      charlotteRenderedAnswer: null,
      wilburActions: [],
      wilburObservations: [],
    } as unknown as LifecycleAggregate

    renderStage(unavailableLifecycle, {
      boardAnswer: {
        answer: 'The weighted board supports a small, reversible trial.',
        model: 'test-model',
        prompt: 'approved board prompt',
      },
      busy: true,
      gameStatus: 'answered',
    })

    expect(screen.getByRole('heading', {
      name: 'The Board Answer retained for provenance',
    })).toBeInTheDocument()
    expect(screen.getByText(/weighted board supports a small, reversible trial/i))
      .toBeInTheDocument()
    const unavailable = screen.getByRole('status', {
      name: 'Charlotte qualification is unavailable',
    })
    expect(unavailable).toHaveTextContent(/after 3 of 3 bounded provider attempts/i)
    expect(unavailable).toHaveTextContent(
      /Answer above remains available exactly as generated.*not Charlotte-qualified/i,
    )
    expect(unavailable).toHaveTextContent(/No Wilbur actions were issued/i)
    expect(screen.queryByRole('heading', { name: /Let the web meet reality/i }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Track with Wilbur/i }))
      .not.toBeInTheDocument()
    expect(screen.queryByTestId('process-graphic')).not.toBeInTheDocument()
  })

  it('nests visible research inside the seven stages and preserves its record IDs in Web provenance', () => {
    const research: ResearchRecord = {
      id: '81000000-0000-4000-8000-000000000001',
      lifecycleRunId: '72000000-0000-4000-8000-000000000001',
      gameId: '73000000-0000-4000-8000-000000000001',
      stage: 'portia',
      requestedBy: 'research-policy',
      consent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: 'allow_search_and_page_fetch',
        recordedAt: '2026-08-02T20:00:00.000Z',
      },
      policyVersion: 'research-policy/1',
      materiality: 'required',
      reason: 'The prompt depends on a current external benchmark.',
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
      searchSynthesis: 'The available links separate latency from throughput.',
      directPageTextFetched: false,
      retrievedFacts: [],
      fetchFailures: [],
      sources: [{
        id: '82000000-0000-4000-8000-000000000001',
        citationId: 'source-1',
        ordinal: 1,
        title: 'Measurement guidance',
        url: 'https://www.nist.gov/example',
        hostname: 'www.nist.gov',
        trust: 'government_or_education',
        discoveredFrom: 'search_activity',
        createdAt: '2026-08-02T20:00:01.000Z',
      }],
      omittedSourceCount: 0,
      injectionSignalsDetected: [],
      contentDigest: 'a'.repeat(64),
      failureCode: null,
      startedAt: '2026-08-02T20:00:00.000Z',
      completedAt: '2026-08-02T20:00:30.000Z',
      createdAt: '2026-08-02T20:00:00.000Z',
      updatedAt: '2026-08-02T20:00:30.000Z',
    }
    const lifecycle = {
      ...aggregate('portia_complete', 'answer'),
      research: [research],
      activities: [{
        id: '83000000-0000-4000-8000-000000000001',
        sequence: 4,
        stage: 'portia',
        activityType: 'research_completed',
        stateFrom: 'portia_running',
        stateTo: 'portia_complete',
        inputEntityIds: [research.id],
        outputEntityIds: [research.sources[0]!.id],
        responsibleAgentIds: ['research-broker'],
        configurationDigest: 'b'.repeat(64),
        status: 'completed',
        eventVersion: 1,
        createdAt: '2026-08-02T20:00:30.000Z',
      }],
    } as unknown as LifecycleAggregate

    renderStage(lifecycle)

    const railLabels = Array.from(
      document.querySelectorAll('.lifecycle-step > strong'),
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
    expect(screen.getByRole('heading', { name: 'Automatic web research' }))
      .toBeInTheDocument()
    expect(screen.getAllByText('official LLM inference latency benchmark 2026'))
      .toHaveLength(2)
    expect(screen.getByText(/available links separate latency from throughput/i))
      .toBeInTheDocument()

    const provenance = document.querySelector<HTMLElement>('.research-provenance')
    expect(provenance).not.toBeNull()
    if (!provenance) throw new Error('The research provenance detail was not rendered.')
    expect(within(provenance).getByText(/Portia research · terminal completed/i))
      .toBeInTheDocument()
    expect(provenance).toHaveTextContent(research.id)
    expect(provenance).toHaveTextContent(research.sources[0]!.id)
  })
})

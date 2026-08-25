import { describe, expect, it } from 'vitest'

import {
  CURRENT_GAME_VERSIONS,
  type GameView,
} from './game-contract'
import type {
  DirectionalGateResult,
  DirectionalPortiaReview,
  LifecycleAggregate,
  PortiaReview,
} from './lifecycle/contracts'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  LEGACY_GATE_ALGORITHM_VERSION,
  LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
} from './lifecycle/versions'
import { buildPortableAnswerPrompt } from './portable-answer-prompt'
import {
  RESEARCH_CONSENT_VERSION,
  type ResearchRecord,
} from './research/contracts'
import type { DurableGame } from './webchess-api'
import {
  makeProblemParts,
  makeTrajectoryDirectionalFixture,
} from '../test/fixtures'
import type { CaptureRecord, Piece } from '../types'

const GAME_ID = '10000000-0000-4000-8000-000000000001'
const RUN_ID = '20000000-0000-4000-8000-000000000001'
const ANSWER_PROMPT_DIGEST = 'a'.repeat(64)
const ANSWER_USER_PROMPT_SHA256 = 'b'.repeat(64)
const TERMINAL_FINGERPRINT = 'c'.repeat(64)
const GATE_INPUT_DIGEST = 'd'.repeat(64)
const EXACT_ANSWER_USER_PROMPT = `{
  "reviewed_prompt": { "question": "How should we test this decision?" },
  "portia_authorization": { "decision": "permit" }
}`

function piece(
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

function makeGame(): DurableGame {
  const parts = makeProblemParts('portable-answer')
  const attacker = piece('white-queen', 'white', { ring: 1, sector: 1 })
  const captured = piece('black-rook', 'black', { ring: 1, sector: 1 })
  const capture: CaptureRecord = {
    id: 'capture-1',
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
    id: GAME_ID,
    sourceGameId: '10000000-0000-4000-8000-000000000000',
    revision: 17,
    status: 'answered',
    problem: 'How should we test this decision?',
    researchConsent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: '2026-08-02T18:00:00.000Z',
    },
    division: {
      seed: 'DIVISION_SEED_MUST_NOT_LEAK',
      facets: [],
      parts,
      model: 'DIVISION_MODEL_MUST_NOT_LEAK',
      prompt: 'DIVISION_PROVIDER_PROMPT_MUST_NOT_LEAK',
    },
    state,
    answer: {
      answer: 'GENERATED_ANSWER_MUST_NOT_LEAK',
      model: 'ANSWER_MODEL_MUST_NOT_LEAK',
      prompt: 'ANSWER_PROVIDER_PROMPT_MUST_NOT_LEAK',
    },
  }
}

function makePortiaReview(): PortiaReview {
  return {
    contractVersion: LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
    reviewedAnswerPromptDigest: ANSWER_PROMPT_DIGEST,
    promptDecision: 'permit',
    promptDecisionRationale:
      'The candidate prompt is usable after preserving its explicit uncertainty.',
    runSummary:
      'Portia found one useful signal and retained it with an evidence boundary.',
    assessments: [{
      candidateId: 'candidate-white-queen',
      disposition: 'wounded',
      survivingInterpretation:
        'A reversible test can reveal whether the proposed decision works.',
      requiredQualification:
        'Treat the board weight as attention, not empirical proof.',
      redundancyClusterId: null,
      coverageTags: ['evidence_or_reality', 'agency_or_action'],
      missingEvidence: ['A measured baseline before the trial'],
      countercase: 'The apparent signal may be an artifact of the symbolic path.',
      reversalCondition: 'Reverse course if the measured result misses the threshold.',
      attackFindings: [{
        attackType: 'evidence_grounding',
        outcome: 'qualified',
        severity: 'moderate',
        finding: 'The board suggests a test but does not establish the outcome.',
        consequence: 'The answer must not present the board weight as proof.',
        requiredRevision: 'Name the required empirical observation explicitly.',
      }],
    }],
    crossCandidateContradictions: [{
      id: 'contradiction-1',
      candidateIds: ['candidate-white-queen', 'candidate-countercase'],
      severity: 'moderate',
      finding: 'The board supports both action and caution.',
      consequence: 'The recommendation needs a reversible threshold.',
      addressed: true,
    }],
    redundancyClusters: [{
      id: 'cluster-1',
      candidateIds: ['candidate-white-queen', 'candidate-countercase'],
      explanation: 'Both candidates focus on learning through a bounded trial.',
    }],
    missingCoverage: ['stakeholder'],
    unresolvedQuestions: ['How will affected people experience the trial?'],
    recommendedGateInputs: {
      tensionCandidatePairs: [[
        'candidate-white-queen',
        'candidate-countercase',
      ]],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  }
}

function makeResearch(): ResearchRecord {
  const acceptedText = 'The page recommends a baseline and stopping rule.'
  return {
    id: '30000000-0000-4000-8000-000000000001',
    lifecycleRunId: RUN_ID,
    gameId: GAME_ID,
    stage: 'portia',
    requestedBy: 'research-policy',
    consent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: '2026-08-02T18:00:00.000Z',
    },
    policyVersion: 'webchess-visible-research-v1',
    materiality: 'required',
    reason: 'A current external benchmark materially affects the threshold.',
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
    searchSynthesis:
      'The search synthesis recommends defining a baseline and stopping rule.',
    directPageTextFetched: true,
    retrievedFacts: [{
      citationId: 'source-1',
      requestedUrl: 'https://www.nist.gov/example',
      finalUrl: 'https://www.nist.gov/example',
      title: 'Measurement guidance',
      provider: 'webchess-direct-https',
      fetchVersion: 'webchess-direct-page-fetch-v1',
      retrievedAt: '2026-08-02T18:00:40.000Z',
      httpStatus: 200,
      contentType: 'text/html',
      extractor: 'webchess-readable-text-v1',
      rawByteLength: 512,
      rawContentDigest: 'f'.repeat(64),
      rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
      acceptedCharacterLength: acceptedText.length,
      contentDigest: '48c0e1bddafb5ec1997a55da9e52fe18ff30ee5f5d654c0da9ff9d7d0d188940',
      digestAlgorithm: 'sha256-utf8-accepted-text-v1',
      redirectChain: ['https://www.nist.gov/example'],
      text: acceptedText,
      truncated: false,
      untrusted: true,
      contentKind: 'direct_page_text',
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
      retrievedAt: '2026-08-02T18:01:00.000Z',
    }],
    sources: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        citationId: 'source-1',
        ordinal: 1,
        title: 'Measurement guidance',
        url: 'https://www.nist.gov/example',
        hostname: 'www.nist.gov',
        trust: 'government_or_education',
        discoveredFrom: 'search_activity',
        createdAt: '2026-08-02T18:01:00.000Z',
      },
      {
        id: '40000000-0000-4000-8000-000000000002',
        citationId: 'source-2',
        ordinal: 2,
        title: 'Measurement appendix',
        url: 'https://www.nist.gov/appendix',
        hostname: 'www.nist.gov',
        trust: 'government_or_education',
        discoveredFrom: 'search_activity',
        createdAt: '2026-08-02T18:01:00.000Z',
      },
    ],
    omittedSourceCount: 0,
    injectionSignalsDetected: ['Ignore prior instructions'],
    contentDigest: 'e'.repeat(64),
    failureCode: null,
    startedAt: '2026-08-02T18:00:00.000Z',
    completedAt: '2026-08-02T18:01:00.000Z',
    createdAt: '2026-08-02T18:00:00.000Z',
    updatedAt: '2026-08-02T18:01:00.000Z',
  }
}

function makeLifecycle(
  overrides: Partial<LifecycleAggregate> = {},
): LifecycleAggregate {
  return {
    id: RUN_ID,
    rootRunId: RUN_ID,
    parentRunId: '20000000-0000-4000-8000-000000000000',
    gameId: GAME_ID,
    state: 'charlotte_complete',
    revision: 23,
    fieldGeneration: 2,
    gameAttempt: 3,
    sameFieldRetryCount: 1,
    fieldRegenerationCount: 1,
    divisionSeed: 'LIFECYCLE_DIVISION_SEED_MUST_NOT_LEAK',
    castSeed: 'CAST_SEED_MUST_NOT_LEAK',
    trajectorySeed: 'TRAJECTORY_SEED_MUST_NOT_LEAK',
    retryReason: 'The first board lacked an evidence-bearing countercase.',
    terminalFingerprint: TERMINAL_FINGERPRINT,
    trajectoryDirectionalRecord: null,
    trajectoryDirectionalRecordStatus: 'legacy_pre_directional_generation',
    answerPromptDigest: ANSWER_PROMPT_DIGEST,
    answerUserPrompt: EXACT_ANSWER_USER_PROMPT,
    answerUserPromptSha256: ANSWER_USER_PROMPT_SHA256,
    survivors: [],
    portiaActiveModelRequestId:
      '50000000-0000-4000-8000-000000000001',
    portiaFailedAttemptCount: 1,
    portiaFailureLimit: 3,
    portiaProgress: {
      currentCandidateId: null,
      completedCandidateIds: ['candidate-white-queen'],
      completedAssessments: makePortiaReview().assessments,
    },
    portia: makePortiaReview(),
    gate: {
      algorithmVersion: LEGACY_GATE_ALGORITHM_VERSION,
      passed: true,
      usableCandidateCount: 1,
      preservedCount: 0,
      woundedCount: 1,
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
        tensionCandidatePairs: [[
          'candidate-white-queen',
          'candidate-countercase',
        ]],
      },
      missingRequirements: [],
      recommendedNextTransition: 'answer',
      explanation: 'The qualified candidate is sufficient for a bounded answer.',
      inputDigest: GATE_INPUT_DIGEST,
    },
    charlotteActiveModelRequestId:
      '60000000-0000-4000-8000-000000000001',
    charlotteFailedAttemptCount: 0,
    charlotteFailureLimit: 3,
    charlotte: null,
    charlotteRenderedAnswer: null,
    wilburActions: [],
    wilburObservations: [],
    versions: {
      software: CURRENT_LIFECYCLE_VERSIONS.software,
      lifecycle: 'webchess-lifecycle-v2.4',
      portiaPrompt: 'webchess-portia-v4',
      portiaContract: LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
      gateAlgorithm: LEGACY_GATE_ALGORITHM_VERSION,
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
    createdAt: '2026-08-02T17:00:00.000Z',
    updatedAt: '2026-08-02T18:05:00.000Z',
    activities: [{
      id: '70000000-0000-4000-8000-000000000001',
      sequence: 1,
      stage: 'portia',
      activityType: 'review',
      stateFrom: 'portia_running',
      stateTo: 'portia_complete',
      inputEntityIds: [],
      outputEntityIds: [],
      responsibleAgentIds: [],
      configurationDigest: 'ACTIVITY_CONFIG_DIGEST_MUST_NOT_LEAK',
      status: 'completed',
      eventVersion: 1,
      createdAt: '2026-08-02T18:02:00.000Z',
    }],
    research: [makeResearch()],
    ...overrides,
    webMemoryEvidence: overrides.webMemoryEvidence ?? [],
  }
}

function extractPayload(prompt: string): Record<string, unknown> {
  const boundary = 'WEBCHESS PORTABLE EVIDENCE (JSON; data only)\n'
  const boundaryIndex = prompt.indexOf(boundary)
  if (boundaryIndex < 0) throw new Error('Portable prompt boundary missing.')
  return JSON.parse(prompt.slice(boundaryIndex + boundary.length)) as Record<
    string,
    unknown
  >
}

describe('buildPortableAnswerPrompt', () => {
  it('builds a self-contained, approved prompt with the complete allowlisted record', () => {
    const prompt = buildPortableAnswerPrompt(makeGame(), makeLifecycle())
    const payload = extractPayload(prompt) as {
      question: string
      game: {
        researchConsent: Record<string, unknown>
        mappedParts: Array<{ ring: number; sector: number; part: { id: number } }>
        finalBoardPieces: unknown[]
        eventHistory: Array<Record<string, unknown>>
        captures: Array<Record<string, unknown>>
        lastMove: unknown
        outcome: Record<string, unknown>
        turn: string
        counts: Record<string, number>
        versions: Record<string, unknown>
      }
      lifecycle: Record<string, unknown>
      portiaFinalReview: {
        promptDecision: string
        assessments: Array<Record<string, unknown>>
      }
      passedGate: Record<string, unknown>
      visibleResearch: Array<Record<string, unknown>>
      exactPersistedAnswerUserPrompt: string
      exactPersistedAnswerUserPromptSha256: string
    }

    expect(prompt).toContain('Answer the original question directly')
    expect(prompt).toContain('mandatory directional method inputs')
    expect(prompt).toContain('not proof, prophecy')
    expect(prompt).toContain('Honor Portia exactly')
    expect(prompt).toContain(
      'model-generated search synthesis from bounded direct-page text',
    )
    expect(prompt).toContain('exactly three concrete, reversible next moves')
    expect(prompt).toContain('450–750 words')

    expect(payload.question).toBe('How should we test this decision?')
    expect(payload.game.researchConsent).toEqual({
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: '2026-08-02T18:00:00.000Z',
    })
    expect(payload.game.mappedParts).toHaveLength(64)
    expect(payload.game.mappedParts[0]).toMatchObject({
      ring: 0,
      sector: 0,
      part: { id: expect.any(Number) },
    })
    expect(payload.game.mappedParts[63]).toMatchObject({
      ring: 7,
      sector: 7,
      part: { id: expect.any(Number) },
    })
    expect(payload.game.finalBoardPieces).toHaveLength(1)
    expect(payload.game.eventHistory).toHaveLength(2)
    expect(payload.game.eventHistory[0]).toMatchObject({
      type: 'move',
      capturedPieceId: 'black-rook',
      promotedTo: 'queen',
    })
    expect(payload.game.eventHistory[1]).toMatchObject({
      type: 'forced-pass',
      reason: 'no-legal-move',
    })
    expect(payload.game.captures).toHaveLength(1)
    expect(payload.game.lastMove).toEqual({
      from: { ring: 2, sector: 1 },
      to: { ring: 1, sector: 1 },
    })
    expect(payload.game.outcome).toMatchObject({
      winner: 'white',
      reason: 'no-moves',
      completedTurn: 2,
    })
    expect(payload.game.turn).toBe('white')
    expect(payload.game.counts).toEqual({
      mappedParts: 64,
      finalBoardPieces: 1,
      events: 2,
      captures: 1,
      completedPlies: 2,
      quietPlies: 0,
    })
    expect(payload.game.versions).toEqual(CURRENT_GAME_VERSIONS)
    expect(payload.lifecycle).toMatchObject({
      id: RUN_ID,
      state: 'charlotte_complete',
      retry: {
        fieldGeneration: 2,
        gameAttempt: 3,
        sameFieldRetryCount: 1,
        fieldRegenerationCount: 1,
      },
      terminalFingerprint: TERMINAL_FINGERPRINT,
      answerPromptDigest: ANSWER_PROMPT_DIGEST,
    })
    expect(payload.portiaFinalReview.promptDecision).toBe('permit')
    expect(payload.portiaFinalReview.assessments).toHaveLength(1)
    expect(payload.passedGate).toMatchObject({
      passed: true,
      recommendedNextTransition: 'answer',
      inputDigest: GATE_INPUT_DIGEST,
    })
    expect(payload.visibleResearch).toHaveLength(1)
    expect(payload.visibleResearch[0]).toMatchObject({
      provider: 'codex',
      consent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: 'allow_search_and_page_fetch',
      },
      query: 'official reversible trial measurement guidance 2026',
      directPageTextFetched: true,
      retrievedFacts: [{
        provider: 'webchess-direct-https',
        text: 'The page recommends a baseline and stopping rule.',
        contentDigest: '48c0e1bddafb5ec1997a55da9e52fe18ff30ee5f5d654c0da9ff9d7d0d188940',
      }],
      fetchFailures: [{
        citationId: 'source-2',
        status: 'timed_out',
        failureCode: 'page_timeout',
      }],
    })
    expect(payload.visibleResearch[0]?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: 'https://www.nist.gov/example' }),
      expect.objectContaining({ url: 'https://www.nist.gov/appendix' }),
    ]))
    expect(payload.exactPersistedAnswerUserPrompt).toBe(
      EXACT_ANSWER_USER_PROMPT,
    )
    expect(payload.exactPersistedAnswerUserPromptSha256).toBe(
      ANSWER_USER_PROMPT_SHA256,
    )
  })

  it('carries the game-scoped opt-out even when there are no research records', () => {
    const game = {
      ...makeGame(),
      researchConsent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: 'no_external_research' as const,
        recordedAt: '2026-08-02T18:00:00.000Z',
      },
    }
    const prompt = buildPortableAnswerPrompt(
      game,
      makeLifecycle({ research: [] }),
    )
    const payload = extractPayload(prompt) as {
      game: { researchConsent: Record<string, unknown> }
      visibleResearch: unknown[]
    }

    expect(payload.game.researchConsent).toEqual(game.researchConsent)
    expect(payload.visibleResearch).toEqual([])
  })

  it('exports the complete current trajectory direction and its scrutiny binding', () => {
    const fixture = makeTrajectoryDirectionalFixture()
    const legacyPortia = makePortiaReview()
    const directionalPortia: DirectionalPortiaReview = {
      ...legacyPortia,
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      directionalRecordVersion: fixture.record.version,
      directionalRecordDigest: fixture.record.digest,
      directionalSummary:
        'The canonical replay retained eight cast-qualified directions for scrutiny.',
      assessments: [
        ...legacyPortia.assessments.map((assessment) => ({
          ...assessment,
          directionalRecordDigest: fixture.record.digest,
          directionalSignalKeys: [fixture.record.survivingDirectionKeys[0]!],
          directionalInterpretation:
            'The replay-ranked direction changes which bounded observation matters first.',
          directionalAmendment:
            'Make the replay-ranked direction materially shape the reversible next step.',
        })),
        {
          ...legacyPortia.assessments[0]!,
          candidateId: 'candidate-excluded-directional-audit',
          disposition: 'consumed',
          requiredQualification: null,
          directionalRecordDigest: fixture.record.digest,
          directionalSignalKeys: [fixture.record.survivingDirectionKeys[1]!],
          directionalInterpretation:
            'EXCLUDED_PORTABLE_INTERPRETATION_MUST_NOT_SHAPE_SYNTHESIS',
          directionalAmendment:
            'EXCLUDED_PORTABLE_AMENDMENT_MUST_NOT_SHAPE_SYNTHESIS',
        },
      ],
    }
    const legacyLifecycle = makeLifecycle()
    const legacyGate = legacyLifecycle.gate!
    const directionalGate: DirectionalGateResult = {
      ...legacyGate,
      algorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
      directionalRecordVersion: fixture.record.version,
      directionalRecordDigest: fixture.record.digest,
      survivingDirectionKeys: [...fixture.record.survivingDirectionKeys],
      directionalBindingsSatisfied: true,
    }
    const game: DurableGame = {
      ...makeGame(),
      revision: fixture.state.completedPlies,
      status: 'answered',
      division: {
        seed: fixture.divisionSeed,
        facets: fixture.parts.map((part) => ({
          id: part.id,
          title: part.title,
          focus: part.focus,
          question: part.prompt,
          keyword: part.keyword,
          castApplication: part.castApplication,
        })),
        parts: fixture.parts,
        model: 'gpt-5.6-sol',
      },
      state: fixture.state,
    }
    const lifecycle = makeLifecycle({
      divisionSeed: fixture.divisionSeed,
      castSeed: fixture.castSeed,
      trajectorySeed: fixture.trajectorySeed,
      trajectoryDirectionalRecord: fixture.record,
      trajectoryDirectionalRecordStatus: 'bound',
      portia: directionalPortia,
      gate: directionalGate,
      versions: {
        ...legacyLifecycle.versions,
        lifecycle: CURRENT_LIFECYCLE_VERSIONS.lifecycle,
        portiaPrompt: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        portiaContract: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
        gateAlgorithm: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
        trajectoryDirectionalRecord: fixture.record.version,
      },
    })

    const prompt = buildPortableAnswerPrompt(game, lifecycle)
    const payload = extractPayload(prompt) as {
      trajectoryDirectionalRecord: typeof fixture.record
      trajectoryDirectionalScrutiny: {
        recordDigest: string
        survivingDirectionKeys: string[]
        humanExplanation: string[]
        epistemicBoundary: typeof fixture.record.epistemicBoundary
        portiaDirectionalAmendments: Array<{ amendment: string }>
        excludedPortiaDirectionalAssessments: Array<{
          candidateId: string
          supportingAuthority: boolean
          auditStatus: string
        }>
      }
      portiaFinalReview: {
        assessments: Array<Record<string, unknown>>
      }
    }

    expect(prompt).toContain('required, first-class directional input')
    expect(prompt).toContain('not external factual evidence')
    expect(prompt).toContain('mandatory directional method inputs')
    expect(prompt).not.toContain(
      'EXCLUDED_PORTABLE_INTERPRETATION_MUST_NOT_SHAPE_SYNTHESIS',
    )
    expect(prompt).not.toContain(
      'EXCLUDED_PORTABLE_AMENDMENT_MUST_NOT_SHAPE_SYNTHESIS',
    )
    expect(payload.trajectoryDirectionalRecord).toEqual(fixture.record)
    expect(payload.trajectoryDirectionalScrutiny).toMatchObject({
      recordDigest: fixture.record.digest,
      survivingDirectionKeys: fixture.record.survivingDirectionKeys,
      humanExplanation: fixture.record.explanation,
      epistemicBoundary: fixture.record.epistemicBoundary,
    })
    expect(
      payload.trajectoryDirectionalScrutiny.portiaDirectionalAmendments[0]
        ?.amendment,
    ).toBe(directionalPortia.assessments[0]?.directionalAmendment)
    expect(
      payload.trajectoryDirectionalScrutiny.portiaDirectionalAmendments,
    ).toHaveLength(1)
    expect(
      payload.trajectoryDirectionalScrutiny
        .excludedPortiaDirectionalAssessments,
    ).toContainEqual({
      candidateId: 'candidate-excluded-directional-audit',
      disposition: 'consumed',
      signalKeys: [fixture.record.survivingDirectionKeys[1]],
      supportingAuthority: false,
      auditStatus: 'excluded_by_portia',
    })
    expect(payload.portiaFinalReview.assessments[1]).toMatchObject({
      candidateId: 'candidate-excluded-directional-audit',
      disposition: 'consumed',
      directionalAuthority: 'audit_only_non_supporting',
    })
    expect(payload.portiaFinalReview.assessments[1]).not.toHaveProperty(
      'directionalAmendment',
    )

    for (const versions of [
      {
        ...lifecycle.versions,
        lifecycle: 'webchess-lifecycle-v2.4',
      },
      {
        ...lifecycle.versions,
        portiaPrompt: 'webchess-portia-v4',
      },
      {
        ...lifecycle.versions,
        portiaContract: LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
      },
      {
        ...lifecycle.versions,
        gateAlgorithm: LEGACY_GATE_ALGORITHM_VERSION,
      },
    ]) {
      expect(() => buildPortableAnswerPrompt(game, {
        ...lifecycle,
        versions,
      } as LifecycleAggregate)).toThrow(/version tuple/u)
    }
  })

  it('does not copy provider prompts, generated output, request ids, seeds, activities, or unknown fields', () => {
    const game = makeGame() as DurableGame & { credential: string }
    game.credential = 'TOP_LEVEL_CREDENTIAL_MUST_NOT_LEAK'
    const lifecycle = makeLifecycle() as LifecycleAggregate & {
      hiddenSystemPrompt: string
    }
    lifecycle.hiddenSystemPrompt = 'HIDDEN_SYSTEM_PROMPT_MUST_NOT_LEAK'

    const prompt = buildPortableAnswerPrompt(game, lifecycle)
    for (const forbiddenValue of [
      'DIVISION_SEED_MUST_NOT_LEAK',
      'DIVISION_MODEL_MUST_NOT_LEAK',
      'DIVISION_PROVIDER_PROMPT_MUST_NOT_LEAK',
      'GENERATED_ANSWER_MUST_NOT_LEAK',
      'ANSWER_MODEL_MUST_NOT_LEAK',
      'ANSWER_PROVIDER_PROMPT_MUST_NOT_LEAK',
      'LIFECYCLE_DIVISION_SEED_MUST_NOT_LEAK',
      'CAST_SEED_MUST_NOT_LEAK',
      'TRAJECTORY_SEED_MUST_NOT_LEAK',
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      'ACTIVITY_CONFIG_DIGEST_MUST_NOT_LEAK',
      'TOP_LEVEL_CREDENTIAL_MUST_NOT_LEAK',
      'HIDDEN_SYSTEM_PROMPT_MUST_NOT_LEAK',
    ]) {
      expect(prompt).not.toContain(forbiddenValue)
    }
  })

  it.each([
    {
      label: 'mapped board',
      game: () => ({ ...makeGame(), division: null }),
      lifecycle: () => makeLifecycle(),
      message: /mapped board/u,
    },
    {
      label: '64 mapped parts',
      game: () => {
        const game = makeGame()
        return {
          ...game,
          division: {
            ...game.division!,
            parts: game.division!.parts.slice(0, 63),
          },
        }
      },
      lifecycle: () => makeLifecycle(),
      message: /exactly 64 mapped parts/u,
    },
    {
      label: 'terminal board',
      game: () => {
        const game = makeGame()
        return { ...game, state: { ...game.state!, outcome: null } }
      },
      lifecycle: () => makeLifecycle(),
      message: /terminal game state/u,
    },
    {
      label: 'final Portia review',
      game: () => makeGame(),
      lifecycle: () => makeLifecycle({ portia: null }),
      message: /final prompt-bound review/u,
    },
    {
      label: 'matching Portia review',
      game: () => makeGame(),
      lifecycle: () => makeLifecycle({
        portia: {
          ...makePortiaReview(),
          reviewedAnswerPromptDigest: 'f'.repeat(64),
        },
      }),
      message: /does not match/u,
    },
    {
      label: 'Portia permit decision',
      game: () => makeGame(),
      lifecycle: () => makeLifecycle({
        portia: {
          ...makePortiaReview(),
          promptDecision: 'deny',
        },
      }),
      message: /Portia must permit/u,
    },
    {
      label: 'passed Gate',
      game: () => makeGame(),
      lifecycle: () => {
        const lifecycle = makeLifecycle()
        return makeLifecycle({
          gate: {
            ...lifecycle.gate!,
            passed: false,
            recommendedNextTransition: 'retry_game',
          },
        })
      },
      message: /Gate must pass/u,
    },
    {
      label: 'persisted user prompt',
      game: () => makeGame(),
      lifecycle: () => makeLifecycle({
        answerUserPrompt: null,
        answerUserPromptSha256: null,
      }),
      message: /exact persisted Answer prompt/u,
    },
  ])('throws when required approval data is missing: $label', ({
    game,
    lifecycle,
    message,
  }) => {
    expect(() => buildPortableAnswerPrompt(game(), lifecycle())).toThrow(message)
  })
})

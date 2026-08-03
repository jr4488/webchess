import { describe, expect, it } from 'vitest'

import { getLegalMoves, hasLegalMove } from '../game'
import { acceptMoveCommand, createReplayState } from '../game-replay'
import type { ReplayState } from '../game-contract'
import { makeProblemParts } from '../../test/fixtures'
import type {
  PortiaCandidateAssessment,
  PortiaReview,
  SurvivorCandidate,
} from './contracts'
import { PORTIA_ATTACK_TYPES } from './contracts'
import { validateCharlotteResult } from './charlotte'
import { evaluateGate } from './gate'
import { validatePortiaReview } from './portia'
import { decideRetry } from './retry'
import {
  assertLifecycleTransition,
  canTransitionLifecycle,
  LifecycleTransitionError,
} from './state-machine'
import {
  deriveSurvivorCandidates,
  terminalFingerprint,
} from './survivors'
import { CURRENT_LIFECYCLE_VERSIONS } from './versions'

const parts = makeProblemParts('webchess-2-lifecycle')

function candidate(id: string): SurvivorCandidate {
  return {
    candidateId: id,
    pieceId: id.split(':').at(-1) ?? id,
    side: 'white',
    pieceKind: 'rook',
    originalPieceKind: 'rook',
    pieceRole: 'the rules and structures holding things in place',
    sidePolarity: 'outside-in evidence',
    finalCoordinate: { ring: 4, sector: 2 },
    facet: parts[34],
    route: [],
    capturesMade: [],
    attackedPlies: [],
    moveCount: 0,
    promoted: false,
    terminalGameId: '00000000-0000-4000-8000-000000000001',
    attemptId: '00000000-0000-4000-8000-000000000002',
    sourceDigest: 'a'.repeat(64),
  }
}

function assessment(
  candidateId: string,
  overrides: Partial<PortiaCandidateAssessment> = {},
): PortiaCandidateAssessment {
  const disposition = overrides.disposition ?? 'preserved'
  const attackOutcome = disposition === 'preserved'
    ? 'passed'
    : disposition === 'wounded'
      ? 'qualified'
      : disposition === 'unresolved'
        ? 'unresolved'
        : 'failed'
  return {
    candidateId,
    disposition,
    survivingInterpretation: `A bounded interpretation for ${candidateId}.`,
    requiredQualification: null,
    redundancyClusterId: null,
    coverageTags: [],
    missingEvidence: ['A direct observation is still required.'],
    countercase: 'A plausible countercase would reverse this interpretation.',
    reversalCondition: 'A measured contradiction would require reversal.',
    attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
      attackType,
      outcome: attackOutcome,
      severity: disposition === 'preserved' ? 'low' : 'moderate',
      finding: `The ${attackType} attack identifies a bounded concern.`,
      consequence: 'The recommendation must preserve uncertainty.',
      requiredRevision: disposition === 'preserved'
        ? null
        : 'State the assumption and test it before scaling.',
    })),
    ...overrides,
  }
}

function review(
  assessments: readonly PortiaCandidateAssessment[],
  overrides: Partial<PortiaReview> = {},
): PortiaReview {
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    reviewedAnswerPromptDigest: 'a'.repeat(64),
    promptDecision: 'permit',
    promptDecisionRationale:
      'The reviewed board-derived prompt is reasonable under the stated qualifications.',
    runSummary: 'Portia attacked every terminal survivor without treating survival as proof.',
    assessments: [...assessments],
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: ['Which observation would most quickly reduce uncertainty?'],
    recommendedGateInputs: {
      tensionCandidatePairs: [],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
    ...overrides,
  }
}

describe('lifecycle state machine', () => {
  it('allows explicit idempotent and forward transitions', () => {
    expect(canTransitionLifecycle('chess_terminal', 'portia_pending')).toBe(true)
    expect(canTransitionLifecycle('gate_passed', 'gate_passed')).toBe(true)
    expect(() => assertLifecycleTransition('gate_passed', 'charlotte_pending')).not.toThrow()
  })

  it('fails closed for bypasses and terminal-state resurrection', () => {
    expect(() =>
      assertLifecycleTransition('chess_terminal', 'charlotte_running'),
    ).toThrow(LifecycleTransitionError)
    expect(() =>
      assertLifecycleTransition('insufficient_basis', 'charlotte_pending'),
    ).toThrow(LifecycleTransitionError)
    expect(() =>
      assertLifecycleTransition('abandoned', 'anansi_pending'),
    ).toThrow(LifecycleTransitionError)
  })
})

describe('terminal ecology fingerprints', () => {
  it('ignores retry identities while preserving meaningful ecology changes', () => {
    const first = candidate('attempt-one:white-rook')
    const sameEcology = {
      ...first,
      candidateId: 'attempt-two:white-rook',
      terminalGameId: '00000000-0000-4000-8000-000000000099',
      attemptId: '00000000-0000-4000-8000-000000000098',
      sourceDigest: 'b'.repeat(64),
    }
    const changedEcology = {
      ...sameEcology,
      attackedPlies: [12],
    }

    expect(terminalFingerprint([sameEcology])).toBe(
      terminalFingerprint([first]),
    )
    expect(terminalFingerprint([changedEcology])).not.toBe(
      terminalFingerprint([first]),
    )
  })
})

describe('Portia validation', () => {
  const survivors = [candidate('attempt:white-rook'), candidate('attempt:black-bishop')]

  it('requires every and only every canonical survivor ID', () => {
    const valid = review(survivors.map((item) => assessment(item.candidateId)))
    expect(validatePortiaReview(valid, survivors).assessments).toHaveLength(2)

    expect(() =>
      validatePortiaReview(
        review([assessment(survivors[0].candidateId)]),
        survivors,
      ),
    ).toThrow(/every and only every/u)
    expect(() =>
      validatePortiaReview(
        review([
          assessment(survivors[0].candidateId),
          assessment(survivors[0].candidateId),
        ]),
        survivors,
      ),
    ).toThrow(/duplicate/u)
  })

  it('enforces consumed and wounded semantics mechanically', () => {
    expect(() =>
      validatePortiaReview(
        review([
          assessment(survivors[0].candidateId, {
            disposition: 'consumed',
            survivingInterpretation: 'This must not survive.',
          }),
          assessment(survivors[1].candidateId),
        ]),
        survivors,
      ),
    ).toThrow()
    expect(() =>
      validatePortiaReview(
        review([
          assessment(survivors[0].candidateId, {
            disposition: 'wounded',
            requiredQualification: null,
          }),
          assessment(survivors[1].candidateId),
        ]),
        survivors,
      ),
    ).toThrow()
  })

  it('rejects dangling, duplicated, and self-referential Portia graph edges', () => {
    const validAssessments = survivors.map((item) => assessment(item.candidateId))
    const cluster = {
      id: 'cluster-1',
      candidateIds: survivors.map((item) => item.candidateId),
      explanation: 'Both candidates depend on the same underlying claim and evidence source.',
    }
    const clusteredAssessments = validAssessments.map((item) => ({
      ...item,
      redundancyClusterId: cluster.id,
    }))
    const contradiction = {
      id: 'contradiction-1',
      candidateIds: survivors.map((item) => item.candidateId),
      severity: 'severe' as const,
      finding: 'The candidates point toward materially different bounded actions.',
      consequence: 'The final recommendation must preserve rather than hide this tension.',
      addressed: true,
    }

    expect(() => validatePortiaReview(review(clusteredAssessments, {
      redundancyClusters: [cluster, { ...cluster }],
    }), survivors)).toThrow(/duplicate redundancy cluster/u)
    expect(() => validatePortiaReview(review(clusteredAssessments, {
      redundancyClusters: [{
        ...cluster,
        candidateIds: [survivors[0].candidateId, survivors[0].candidateId],
      }],
    }), survivors)).toThrow(/repeats a candidate/u)
    expect(() => validatePortiaReview(review(clusteredAssessments, {
      redundancyClusters: [{
        ...cluster,
        candidateIds: [survivors[0].candidateId, 'attempt:unknown'],
      }],
    }), survivors)).toThrow(/unknown candidate/u)

    expect(() => validatePortiaReview(review(validAssessments, {
      crossCandidateContradictions: [contradiction, { ...contradiction }],
    }), survivors)).toThrow(/duplicate contradiction/u)
    expect(() => validatePortiaReview(review(validAssessments, {
      crossCandidateContradictions: [{
        ...contradiction,
        candidateIds: [survivors[0].candidateId, 'attempt:unknown'],
      }],
    }), survivors)).toThrow(/unknown candidate/u)

    expect(() => validatePortiaReview(review([
      assessment(survivors[0].candidateId, {
        redundancyClusterId: 'missing-cluster',
      }),
      assessment(survivors[1].candidateId),
    ]), survivors)).toThrow(/unknown redundancy cluster/u)
    expect(() => validatePortiaReview(review(validAssessments, {
      recommendedGateInputs: {
        tensionCandidatePairs: [[
          survivors[0].candidateId,
          survivors[0].candidateId,
        ]],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    }), survivors)).toThrow(/known, distinct candidates/u)
    expect(() => validatePortiaReview(review(validAssessments, {
      recommendedGateInputs: {
        tensionCandidatePairs: [],
        fatalContradictionIds: ['missing-contradiction'],
        fieldRepairReasons: [],
      },
    }), survivors)).toThrow(/unknown fatal contradiction/u)
  })

  it('rejects duplicated and incomplete attack libraries after schema parsing', () => {
    const duplicateAttacks = assessment(survivors[0].candidateId)
      .attackFindings.map((finding, index) => index === 12
        ? { ...finding, attackType: PORTIA_ATTACK_TYPES[0] }
        : finding)
    expect(() => validatePortiaReview(review([
      assessment(survivors[0].candidateId, {
        attackFindings: duplicateAttacks,
      }),
      assessment(survivors[1].candidateId),
    ]), survivors)).toThrow(/every attack type exactly once/u)
  })
})

describe('deterministic Gate', () => {
  const ids = ['a', 'b', 'c', 'd'].map((id) => `attempt:${id}`)
  const requiredPromptRevision =
    'State the evidence threshold explicitly before recommending expansion.'
  const covered = [
    assessment(ids[0], { coverageTags: ['protected_outcome'] }),
    assessment(ids[1], { coverageTags: ['evidence_or_reality'] }),
    assessment(ids[2], { coverageTags: ['risk_or_countercase'] }),
    assessment(ids[3], { coverageTags: ['agency_or_action'] }),
  ]
  const qualifiedEvidenceBase = assessment(ids[1], {
    disposition: 'wounded',
    requiredQualification:
      'Use this signal only with the explicit evidence threshold.',
    coverageTags: ['evidence_or_reality'],
  })
  const qualifiedEvidence: PortiaCandidateAssessment = {
    ...qualifiedEvidenceBase,
    attackFindings: qualifiedEvidenceBase.attackFindings.map(
      (finding, index) => index === 0
        ? {
            ...finding,
            outcome: 'qualified' as const,
            severity: 'moderate' as const,
            requiredRevision: requiredPromptRevision,
          }
        : {
            ...finding,
            outcome: 'passed' as const,
            severity: 'low' as const,
            requiredRevision: null,
          },
    ),
  }
  const coveredWithRequiredRevision = [
    covered[0],
    qualifiedEvidence,
    covered[2],
    covered[3],
  ]

  it('passes a smaller independent and sufficiently covered set', () => {
    const result = evaluateGate(review(covered, {
      recommendedGateInputs: {
        tensionCandidatePairs: [[ids[0], ids[2]]],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    }))

    expect(result).toMatchObject({
      passed: true,
      usableCandidateCount: 4,
      independentClusterCount: 4,
      recommendedNextTransition: 'answer',
    })
    expect(result.inputDigest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('passes a permitted sufficient review whose usable qualified finding requires a prompt revision', () => {
    const result = evaluateGate(review(coveredWithRequiredRevision, {
      promptDecision: 'permit',
      recommendedGateInputs: {
        tensionCandidatePairs: [[ids[0], ids[2]]],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    }))

    expect(result).toMatchObject({
      passed: true,
      woundedCount: 1,
      severeUnresolvedObjectionCount: 0,
      missingRequirements: [],
      recommendedNextTransition: 'answer',
    })
  })

  it('fails the same sufficient review without a permit and explains why its revision cannot be applied', () => {
    const result = evaluateGate(review(coveredWithRequiredRevision, {
      promptDecision: 'retry_game',
      promptDecisionRationale:
        'The required amendment is not authorized for this prompt.',
      recommendedGateInputs: {
        tensionCandidatePairs: [[ids[0], ids[2]]],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    }))

    expect(result.passed).toBe(false)
    expect(result.recommendedNextTransition).toBe('retry_game')
    expect(result.missingRequirements).toEqual([
      'Portia did not permit the reviewed answer prompt: retry_game.',
      '1 Portia-required prompt revision cannot be applied without a permit decision.',
    ])
  })

  it('fails a numerically large but redundant set', () => {
    const redundantIds = Array.from({ length: 8 }, (_, index) => `attempt:r${index}`)
    const result = evaluateGate(review(
      redundantIds.map((id, index) => assessment(id, {
        redundancyClusterId: 'same-claim',
        coverageTags: index === 0
          ? ['protected_outcome', 'evidence_or_reality', 'risk_or_countercase', 'agency_or_action']
          : [],
      })),
      {
        redundancyClusters: [{
          id: 'same-claim',
          candidateIds: redundantIds,
          explanation: 'Every candidate depends on the same claim and evidence source.',
        }],
        recommendedGateInputs: {
          tensionCandidatePairs: [[redundantIds[0], redundantIds[1]]],
          fatalContradictionIds: [],
          fieldRepairReasons: ['The field repeats one semantic family.'],
        },
      },
    ))

    expect(result.passed).toBe(false)
    expect(result.independentClusterCount).toBe(1)
    expect(result.recommendedNextTransition).toBe('retry_field')
  })

  it('fails an unaddressed fatal contradiction', () => {
    const result = evaluateGate(review(covered, {
      crossCandidateContradictions: [{
        id: 'fatal-1',
        candidateIds: [ids[0], ids[1]],
        severity: 'fatal',
        finding: 'The two candidates require mutually exclusive protected outcomes.',
        consequence: 'Acting on both would defeat the declared non-negotiable outcome.',
        addressed: false,
      }],
      recommendedGateInputs: {
        tensionCandidatePairs: [[ids[0], ids[2]]],
        fatalContradictionIds: ['fatal-1'],
        fieldRepairReasons: [],
      },
    }))
    expect(result.passed).toBe(false)
    expect(result.contradictionResults.fatalUnaddressedIds).toEqual(['fatal-1'])
  })
})

describe('bounded Retry policy', () => {
  const failedGate = evaluateGate(review([
    assessment('attempt:a', { coverageTags: ['protected_outcome'] }),
  ]))

  it('replays a requested game only while the root-wide allowance remains', () => {
    expect(decideRetry({
      gate: failedGate,
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 0,
      duplicateTerminalFingerprint: false,
    }).mode).toBe('replay_game')

    expect(decideRetry({
      gate: failedGate,
      sameFieldRetryCount: 2,
      fieldRegenerationCount: 0,
      duplicateTerminalFingerprint: false,
    }).mode).toBe('regenerate_field')

    expect(decideRetry({
      gate: failedGate,
      sameFieldRetryCount: 2,
      fieldRegenerationCount: 1,
      duplicateTerminalFingerprint: false,
    }).mode).toBe('insufficient_basis')
  })

  it('honors a Gate insufficient-basis decision before unused budgets', () => {
    expect(decideRetry({
      gate: {
        ...failedGate,
        recommendedNextTransition: 'insufficient_basis',
      },
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 0,
      duplicateTerminalFingerprint: false,
    })).toMatchObject({
      mode: 'insufficient_basis',
      remainingSameFieldRetries: 2,
      remainingFieldRegenerations: 1,
    })
  })

  it('regenerates a requested field only while its allowance remains', () => {
    const retryFieldGate = {
      ...failedGate,
      recommendedNextTransition: 'retry_field' as const,
    }

    expect(decideRetry({
      gate: retryFieldGate,
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 0,
      duplicateTerminalFingerprint: false,
    }).mode).toBe('regenerate_field')

    expect(decideRetry({
      gate: retryFieldGate,
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 1,
      duplicateTerminalFingerprint: false,
    }).mode).toBe('insufficient_basis')
  })

  it('never replays a duplicate terminal ecology', () => {
    expect(decideRetry({
      gate: failedGate,
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 0,
      duplicateTerminalFingerprint: true,
    }).mode).toBe('regenerate_field')

    expect(decideRetry({
      gate: failedGate,
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 1,
      duplicateTerminalFingerprint: true,
    }).mode).toBe('insufficient_basis')
  })
})

describe('Charlotte support enforcement', () => {
  const preserved = assessment('attempt:preserved')
  const wounded = assessment('attempt:wounded', {
    disposition: 'wounded',
    requiredQualification: 'Use only after the local evidence check succeeds.',
  })
  const consumed = assessment('attempt:consumed', {
    disposition: 'consumed',
    survivingInterpretation: null,
  })
  const portia = review([preserved, wounded, consumed])
  const base = {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    protectedOutcome: 'Protect the declared outcome while generating useful evidence.',
    directAnswer: 'Run a bounded and reversible test before making the larger commitment, because the currently defensible material supports learning rather than certainty.',
    supportingCandidateIds: [preserved.candidateId, wounded.candidateId],
    qualificationsByCandidateId: {
      [wounded.candidateId]: wounded.requiredQualification,
    },
    centralTension: 'The need to learn quickly remains in tension with the need to protect affected people from avoidable downside.',
    valueConstraints: ['Do not conceal uncertainty or weaken the protected outcome.'],
    stakeholderConsequences: ['The responsible actor owns the test and affected parties retain a stop path.'],
    recommendation: 'Authorize only the smallest reversible experiment, retain the wounded qualification, and decide from the observation rather than the metaphor.',
    communicationStrategy: 'State the evidence boundary, the test, and the stopping rule consistently to every audience.',
    uncertainties: ['The local observation has not yet been collected.'],
    whatCouldChangeTheAnswer: ['A measured contradiction at the review horizon would reverse the recommendation.'],
    exactlyThreeNextActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Reversible action ${index + 1}`,
      actor: 'The accountable user',
      assumptionBeingTested: 'The chosen intervention can generate useful evidence safely.',
      smallestAction: 'Run one bounded observation without expanding scope.',
      expectedObservation: 'A recorded signal either supports or weakens the assumption.',
      decisionThreshold: 'Continue only if the predeclared signal is met without a stop condition.',
      reviewHorizon: 'Within fourteen days',
      reversibility: 'Stop the test and restore the prior state without scaling.',
      risksOrAffectedParties: 'Record affected parties and stop if the protected outcome is threatened.',
      decisionRule: 'revise' as const,
    })),
  }

  it('retains wounds and rejects consumed support', () => {
    expect(validateCharlotteResult(base, portia).supportingCandidateIds).toHaveLength(2)
    expect(() => validateCharlotteResult({
      ...base,
      qualificationsByCandidateId: {},
    }, portia)).toThrow(/qualification/u)
    expect(() => validateCharlotteResult({
      ...base,
      supportingCandidateIds: [consumed.candidateId],
      qualificationsByCandidateId: {},
    }, portia)).toThrow(/preserved or wounded/u)
  })
})

describe('terminal survivor extraction', () => {
  it('derives stable routes and source digests from a canonical terminal replay', () => {
    let state: ReplayState = createReplayState()
    while (!state.outcome) {
      if (!hasLegalMove(state.pieces, state.turn)) {
        throw new Error('The deterministic terminal fixture unexpectedly requires a pass.')
      }
      const piece = state.pieces.find(
        (item) => item.side === state.turn && getLegalMoves(item, state.pieces).length > 0,
      )
      if (!piece) throw new Error('No deterministic terminal-fixture move exists.')
      state = acceptMoveCommand(state, {
        expectedPly: state.completedPlies + 1,
        pieceId: piece.id,
        to: getLegalMoves(piece, state.pieces)[0],
      }, parts).state
    }

    const source = {
      gameId: '00000000-0000-4000-8000-000000000010',
      attemptId: '00000000-0000-4000-8000-000000000011',
      divisionDigest: 'b'.repeat(64),
      rulesVersion: state.versions.rules,
      engineVersion: state.versions.engine,
      castVersion: state.versions.cast,
      eventVersion: state.versions.event,
    }
    const survivors = deriveSurvivorCandidates(state, parts, source)

    expect(survivors).toHaveLength(state.pieces.length)
    expect(survivors.every((item) => item.terminalGameId === source.gameId)).toBe(true)
    expect(survivors.every((item) => /^[0-9a-f]{64}$/u.test(item.sourceDigest))).toBe(true)
    expect(terminalFingerprint(survivors)).toMatch(/^[0-9a-f]{64}$/u)
    expect(deriveSurvivorCandidates(state, parts, source)).toEqual(survivors)
  })
})

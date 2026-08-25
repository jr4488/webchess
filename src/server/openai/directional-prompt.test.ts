// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  CURRENT_LIFECYCLE_VERSIONS,
  deriveSurvivorCandidates,
  terminalFingerprint,
  type DirectionalGateResult,
  type DirectionalPortiaReview,
  type LegacyGateResult,
  type LegacyPromptBoundPortiaReview,
  type PortiaCandidateAssessment,
} from '../../lib/lifecycle'
import { makeTrajectoryDirectionalFixture } from '../../test/fixtures'
import { hashCanonicalJson } from '../db/hash'
import type { CanonicalJson } from '../db/hash'
import {
  buildApprovedBoardAnswerPrompt,
  buildBoardAnswerPromptPackage,
  buildPlayerVisibleAnswerPrompt,
  type ApprovedBoardAnswerInput,
  type ServerDerivedEvidence,
} from './answer'
import {
  buildCharlotteInput,
  buildCharlotteInstructions,
  buildCharlottePrompt,
  type CharlotteInput,
} from './charlotte'
import { ModelInputError } from './types'

const PROBLEM =
  'How should I choose a bounded next step while the available evidence remains incomplete?'
const REVIEWED_PROMPT_DIGEST = 'a'.repeat(64)

function directionalEvidence(): ServerDerivedEvidence {
  const { state } = makeTrajectoryDirectionalFixture()
  if (!state.outcome) throw new Error('Directional fixture is not terminal.')
  return {
    problem: PROBLEM,
    turnCount: state.completedPlies,
    outcome: {
      winner: state.outcome.winner,
      reason: state.outcome.reason,
      completedTurn: state.outcome.completedTurn,
    },
    captures: state.captures.map((capture) => ({
      turn: capture.turn,
      resonance: capture.resonance,
      cell: { ...capture.cell },
      attacker: {
        side: capture.attacker.side,
        kind: capture.attacker.kind,
      },
      captured: {
        side: capture.captured.side,
        kind: capture.captured.kind,
      },
      part: {
        id: capture.part.id,
        title: capture.part.title,
        focus: capture.part.focus,
        hexagram: capture.part.hexagram,
        hexagramName: capture.part.hexagramName,
        theme: capture.part.theme,
        dimension: capture.part.dimension,
        movement: capture.part.movement,
        prompt: capture.part.prompt,
        keyword: capture.part.keyword,
      },
    })),
  }
}

function survivors() {
  const fixture = makeTrajectoryDirectionalFixture()
  return deriveSurvivorCandidates(fixture.state, fixture.parts, {
    gameId: '10000000-0000-4000-8000-000000000001',
    attemptId: '20000000-0000-4000-8000-000000000001',
    divisionDigest: fixture.divisionDigest,
    rulesVersion: fixture.state.versions.rules,
    engineVersion: fixture.state.versions.engine,
    castVersion: fixture.state.versions.cast,
    eventVersion: fixture.state.versions.event,
  })
}

function directionalAssessment(
  candidateId: string,
  index: number,
): PortiaCandidateAssessment & {
  directionalRecordDigest: string
  directionalSignalKeys: string[]
  directionalInterpretation: string
  directionalAmendment: string
} {
  const { record } = makeTrajectoryDirectionalFixture()
  return {
    candidateId,
    disposition: 'preserved',
    survivingInterpretation:
      'This candidate remains usable as a bounded direction after scrutiny.',
    requiredQualification: null,
    redundancyClusterId: null,
    coverageTags: [
      ['protected_outcome', 'value_or_constraint', 'stakeholder',
        'evidence_or_reality', 'risk_or_countercase', 'agency_or_action'][
        index % 6
      ] as PortiaCandidateAssessment['coverageTags'][number],
    ],
    missingEvidence: ['A direct observation remains necessary before scaling.'],
    countercase: 'A contradictory measured result would defeat this direction.',
    reversalCondition: 'Stop when the declared threshold is not met.',
    attackFindings: [{
      attackType: 'metaphor_overreach',
      outcome: 'passed',
      severity: 'low',
      finding: 'The interpretation remains directional rather than factual.',
      consequence: 'The answer must retain the explicit evidence boundary.',
      requiredRevision: null,
    }],
    directionalRecordDigest: record.digest,
    directionalSignalKeys: [
      record.survivingDirectionKeys[
        index % record.survivingDirectionKeys.length
      ]!,
    ],
    directionalInterpretation:
      'The replay-ranked lens directs this candidate toward a bounded test.',
    directionalAmendment:
      `Amend candidate ${candidateId} so the replay-ranked direction materially changes its next step.`,
  }
}

function directionalApproval(): ApprovedBoardAnswerInput {
  const fixture = makeTrajectoryDirectionalFixture()
  const terminalSurvivors = survivors()
  const plan = buildBoardAnswerPromptPackage(
    directionalEvidence(),
    terminalSurvivors,
    terminalFingerprint(terminalSurvivors),
    [],
    [],
    fixture.record,
  )
  const assessments = terminalSurvivors.map((candidate, index) =>
    directionalAssessment(candidate.candidateId, index))
  const portia: DirectionalPortiaReview = {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    reviewedAnswerPromptDigest: REVIEWED_PROMPT_DIGEST,
    directionalRecordVersion: fixture.record.version,
    directionalRecordDigest: fixture.record.digest,
    directionalSummary:
      'The complete replay retains eight cast-qualified directions for synthesis.',
    promptDecision: 'permit',
    promptDecisionRationale:
      'Every survivor carries a traceable directional amendment and evidence boundary.',
    runSummary:
      'Portia scrutinized the complete terminal ecology and its replay-derived direction.',
    assessments,
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: ['Which observation would most quickly reduce uncertainty?'],
    recommendedGateInputs: {
      tensionCandidatePairs: [],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  }
  const gate: DirectionalGateResult = {
    algorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
    passed: true,
    usableCandidateCount: assessments.length,
    preservedCount: assessments.length,
    woundedCount: 0,
    consumedCount: 0,
    unresolvedCount: 0,
    independentClusterCount: assessments.length,
    coverageResults: [],
    severeUnresolvedObjectionCount: 0,
    contradictionResults: {
      fatalUnaddressedIds: [],
      tensionCandidatePairs: [],
    },
    missingRequirements: [],
    recommendedNextTransition: 'answer',
    explanation:
      'The current prompt carries a complete, internally consistent directional binding.',
    inputDigest: 'b'.repeat(64),
    directionalRecordVersion: fixture.record.version,
    directionalRecordDigest: fixture.record.digest,
    survivingDirectionKeys: [...fixture.record.survivingDirectionKeys],
    directionalBindingsSatisfied: true,
  }
  return {
    plan,
    reviewedPromptDigest: REVIEWED_PROMPT_DIGEST,
    portia,
    gate,
  }
}

function boardAnswer() {
  return {
    answer:
      'Run one bounded and reversible observation, then decide against its declared threshold.',
    model: 'gpt-5.6-sol',
    prompt: 'The exact approved Answer prompt.',
  }
}

function charlotteInput(
  approved: ApprovedBoardAnswerInput,
): CharlotteInput {
  const answer = boardAnswer()
  return {
    problem: PROBLEM,
    boardAnswer: answer,
    boardAnswerDigest: hashCanonicalJson(answer as unknown as CanonicalJson),
    reviewedPromptDigest: approved.reviewedPromptDigest,
    portia: approved.portia,
    gate: approved.gate,
    trajectoryDirectionalRecord: approved.plan.trajectoryDirectionalRecord,
  }
}

function legacyApproval(): ApprovedBoardAnswerInput {
  const current = directionalApproval()
  const assessments = current.portia.assessments.map((assessment) => {
    const {
      directionalRecordDigest: _digest,
      directionalSignalKeys: _keys,
      directionalInterpretation: _interpretation,
      directionalAmendment: _amendment,
      ...legacy
    } = assessment
    void _digest
    void _keys
    void _interpretation
    void _amendment
    return legacy
  })
  const portia: LegacyPromptBoundPortiaReview = {
    contractVersion: 'webchess-portia-review-v2',
    reviewedAnswerPromptDigest: REVIEWED_PROMPT_DIGEST,
    promptDecision: 'permit',
    promptDecisionRationale: current.portia.promptDecisionRationale,
    runSummary: current.portia.runSummary,
    assessments,
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: [...current.portia.unresolvedQuestions],
    recommendedGateInputs: {
      tensionCandidatePairs: [],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  }
  const directionalGate = current.gate as DirectionalGateResult
  const gate: LegacyGateResult = {
    algorithmVersion: 'webchess-gate-v4',
    passed: directionalGate.passed,
    usableCandidateCount: directionalGate.usableCandidateCount,
    preservedCount: directionalGate.preservedCount,
    woundedCount: directionalGate.woundedCount,
    consumedCount: directionalGate.consumedCount,
    unresolvedCount: directionalGate.unresolvedCount,
    independentClusterCount: directionalGate.independentClusterCount,
    coverageResults: directionalGate.coverageResults,
    severeUnresolvedObjectionCount:
      directionalGate.severeUnresolvedObjectionCount,
    contradictionResults: directionalGate.contradictionResults,
    missingRequirements: directionalGate.missingRequirements,
    recommendedNextTransition: directionalGate.recommendedNextTransition,
    explanation: directionalGate.explanation,
    inputDigest: directionalGate.inputDigest,
  }
  return {
    plan: buildBoardAnswerPromptPackage(
      directionalEvidence(),
      current.plan.survivors,
      current.plan.terminalFingerprint,
    ),
    reviewedPromptDigest: REVIEWED_PROMPT_DIGEST,
    portia,
    gate,
  }
}

describe('trajectory directional Answer and Charlotte prompts', () => {
  it('carries the complete record, explanation, boundary, and exact Portia amendments', () => {
    const approved = directionalApproval()
    const record = approved.plan.trajectoryDirectionalRecord!
    const answerInput = JSON.parse(buildPlayerVisibleAnswerPrompt(approved))
    const fullAnswerPrompt = buildApprovedBoardAnswerPrompt(approved)
    const charlotteValue = charlotteInput(approved)
    const charlotteJson = JSON.parse(buildCharlotteInput(charlotteValue))
    const charlottePrompt = buildCharlottePrompt(charlotteValue)

    expect(answerInput.reviewed_prompt.trajectory_directional_record).toEqual(record)
    expect(answerInput.trajectory_directional_scrutiny).toMatchObject({
      record_version: record.version,
      record_digest: record.digest,
      surviving_direction_keys: record.survivingDirectionKeys,
      human_explanation: record.explanation,
      epistemic_boundary: record.epistemicBoundary,
    })
    expect(
      answerInput.trajectory_directional_scrutiny
        .portia_directional_amendments[0],
    ).toMatchObject({
      signal_keys: approved.portia.assessments[0]!.directionalSignalKeys,
      amendment: approved.portia.assessments[0]!.directionalAmendment,
    })
    expect(fullAnswerPrompt).toContain('mandatory directional inputs')
    expect(fullAnswerPrompt).toContain('not external factual evidence')
    expect(fullAnswerPrompt).toContain(
      "fixed I Ching cast as a required directional lens",
    )
    expect(fullAnswerPrompt).not.toContain('independently randomized')
    expect(fullAnswerPrompt).not.toContain('metaphorical attention map')

    expect(charlotteJson.trajectory_directional_record).toEqual(record)
    expect(charlotteJson.trajectory_directional_scrutiny).toMatchObject({
      record_digest: record.digest,
      surviving_direction_keys: record.survivingDirectionKeys,
      human_explanation: record.explanation,
      epistemic_boundary: record.epistemicBoundary,
    })
    expect(charlottePrompt).toContain('first-class directional input')
    expect(charlottePrompt).toContain('cannot override verified facts')
  })

  it('keeps excluded directional assessments as non-supporting audit data only', () => {
    const approved = directionalApproval()
    const portia = approved.portia as DirectionalPortiaReview
    const excludedCandidate = portia.assessments.at(-1)!
    const excludedAmendment =
      'EXCLUDED_DIRECTIONAL_AMENDMENT_MUST_NOT_SHAPE_SYNTHESIS'
    const excludedInterpretation =
      'EXCLUDED_DIRECTIONAL_INTERPRETATION_MUST_NOT_SHAPE_SYNTHESIS'
    const assessments = portia.assessments.map((assessment) =>
      assessment.candidateId === excludedCandidate.candidateId
        ? {
            ...assessment,
            disposition: 'consumed' as const,
            directionalInterpretation: excludedInterpretation,
            directionalAmendment: excludedAmendment,
          }
        : assessment)
    const approvalWithExclusion: ApprovedBoardAnswerInput = {
      ...approved,
      portia: { ...portia, assessments },
    }

    const answerPrompt = buildApprovedBoardAnswerPrompt(approvalWithExclusion)
    const answerJson = JSON.parse(
      buildPlayerVisibleAnswerPrompt(approvalWithExclusion),
    )
    expect(answerPrompt).not.toContain(excludedAmendment)
    expect(answerPrompt).not.toContain(excludedInterpretation)
    expect(
      answerJson.trajectory_directional_scrutiny
        .portia_directional_amendments,
    ).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate_id: excludedCandidate.candidateId }),
    ]))
    expect(
      answerJson.trajectory_directional_scrutiny
        .excluded_portia_directional_assessments,
    ).toContainEqual(expect.objectContaining({
      candidate_id: excludedCandidate.candidateId,
      disposition: 'consumed',
      supporting_authority: false,
      audit_status: 'excluded_by_portia',
    }))

    const charlotteValue = charlotteInput(approvalWithExclusion)
    const charlottePrompt = buildCharlottePrompt(charlotteValue)
    const charlotteJson = JSON.parse(buildCharlotteInput(charlotteValue))
    expect(charlottePrompt).not.toContain(excludedAmendment)
    expect(charlottePrompt).not.toContain(excludedInterpretation)
    expect(
      charlotteJson.trajectory_directional_scrutiny
        .portia_directional_amendments,
    ).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate_id: excludedCandidate.candidateId }),
    ]))
    expect(
      charlotteJson.trajectory_directional_scrutiny
        .excluded_portia_directional_assessments,
    ).toContainEqual(expect.objectContaining({
      candidate_id: excludedCandidate.candidateId,
      disposition: 'consumed',
      supporting_authority: false,
      audit_status: 'excluded_by_portia',
    }))
    expect(buildCharlotteInstructions(charlotteValue.trajectoryDirectionalRecord))
      .toContain('audit-only, non-supporting provenance')
  })

  it('rejects mismatched or incomplete current Portia and Gate bindings', () => {
    const approved = directionalApproval()
    const gate = approved.gate as DirectionalGateResult
    expect(() => buildPlayerVisibleAnswerPrompt({
      ...approved,
      gate: { ...gate, directionalRecordDigest: 'f'.repeat(64) },
    })).toThrow(ModelInputError)
    expect(() => buildPlayerVisibleAnswerPrompt({
      ...approved,
      gate: {
        ...gate,
        survivingDirectionKeys: [...gate.survivingDirectionKeys].reverse(),
      },
    })).toThrow(/exact trajectory directional record/u)

    const { trajectoryDirectionalRecord: _record, ...planWithoutRecord } =
      approved.plan
    void _record
    expect(() => buildPlayerVisibleAnswerPrompt({
      ...approved,
      plan: planWithoutRecord,
    })).toThrow(/without its trajectory record|cannot omit|directional/u)

    const portia = approved.portia as DirectionalPortiaReview
    expect(() => buildCharlotteInput({
      ...charlotteInput(approved),
      portia: {
        ...portia,
        assessments: portia.assessments.map((assessment, index) =>
          index === 0
            ? { ...assessment, directionalSignalKeys: ['not-a-record-key'] }
            : assessment),
      },
    })).toThrow(/exact trajectory directional record/u)
  })

  it('keeps the explicit review-v2/Gate-v4 no-record path unchanged', () => {
    const approved = legacyApproval()
    const answerInput = buildPlayerVisibleAnswerPrompt(approved)
    const charlotteValue = charlotteInput(approved)
    const charlotteJson = JSON.parse(buildCharlotteInput(charlotteValue))

    expect(answerInput).not.toContain('trajectory_directional')
    expect(buildApprovedBoardAnswerPrompt(approved)).not.toContain(
      'TRAJECTORY-DERIVED I CHING DIRECTION',
    )
    expect(charlotteJson).not.toHaveProperty('trajectory_directional_record')
    expect(buildCharlotteInstructions()).not.toContain(
      'TRAJECTORY-DERIVED I CHING DIRECTION',
    )
  })
})

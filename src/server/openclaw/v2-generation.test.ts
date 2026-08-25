// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveDivisionCastAssignments } from '@/lib/division'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  evaluateGate,
  PORTIA_ATTACK_TYPES,
} from '@/lib/lifecycle'
import type {
  PortiaCandidateAssessment,
  PortiaReview,
} from '@/lib/lifecycle'
import { makeTrajectoryDirectionalFixture } from '@/test/fixtures'
import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '@/types'
import {
  buildBoardAnswerPromptPackage,
  type CharlotteInput,
  ModelConfigurationError,
  ModelContractError,
  type ModelRequestContext,
  orderPortiaCandidates,
  type PortiaInput,
  type ServerDerivedEvidence,
} from '@/server/openai'

const harness = vi.hoisted(() => ({
  buildFullPrompt: vi.fn(),
  modelAttribution: vi.fn(),
  runOpenClawModel: vi.fn(),
}))

vi.mock('@/lib/full-answer-model-prompt', () => ({
  buildOpenClawAnswerModelPrompt: harness.buildFullPrompt,
}))
vi.mock('./cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cli')>()
  return {
    ...actual,
    modelAttribution: harness.modelAttribution,
    runOpenClawModel: harness.runOpenClawModel,
  }
})

import {
  ModelInputError,
} from '@/server/openai'
import {
  OpenClawCliError,
} from './cli'
import {
  OpenClawAnswerContractError,
  OpenClawProviderError,
} from './errors'
import {
  buildOpenClawAnswerPrompt,
  generateOpenClawAnswerV2,
  generateOpenClawCharlotteV2,
  generateOpenClawDivisionV2,
  generateOpenClawPortiaV2,
} from './v2-generation'
import { hashCanonicalJson } from '@/server/db/hash'
import type { CanonicalJson } from '@/server/db/hash'

const PROBLEM =
  'How should I choose a reversible next step while the available evidence is incomplete?'
const DIVISION_SEED = '11111111-1111-4111-8111-111111111111'

function alphabeticCode(value: number): string {
  const first = String.fromCharCode(97 + Math.floor((value - 1) / 26))
  const second = String.fromCharCode(97 + ((value - 1) % 26))
  return `x${first}${second}`
}

function validFacets() {
  return Array.from({ length: 64 }, (_, index) => {
    const id = index + 1
    const code = alphabeticCode(id)
    return {
      id,
      title: `Signal title${code}`,
      focus: `Examine the distinct focus${code} condition influencing this concrete choice.`,
      question: `Which observation about question${code} would change the next step?`,
      keyword: `Marker key${code}`,
    }
  })
}

function validCastDirectedFacets(seed = DIVISION_SEED) {
  void seed
  return validFacets().map((facet) => ({
    ...facet,
    castApplication:
      `The fixed direction changes facet ${facet.id} by selecting a concrete inquiry for this problem.`,
  }))
}

function words(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(' ')
}

function validAnswer() {
  return {
    answer: `Take one reversible step now. Reassess the evidence before expanding the commitment.\n\n${words('context', 80)}`,
    what_the_conflicts_emphasized: words('conflict', 100),
    the_tension_to_hold: words('tension', 90),
    three_next_moves: [
      words('observe', 40),
      words('compare', 40),
      words('revisit', 40),
    ],
    what_could_change_the_answer: words('condition', 90),
  }
}

function validCharlotteTransportResult(
  candidateId: string,
  qualification: string,
) {
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    protectedOutcome:
      'Protect a reversible decision and avoid expanding the commitment prematurely.',
    directAnswer:
      'Run one bounded observation first, compare it with the declared decision threshold, and expand the commitment only when the direct result supports doing so.',
    supportingCandidateIds: [candidateId],
    qualifications: [{ candidateId, qualification }],
    centralTension:
      'Learn quickly while protecting affected people from avoidable downside.',
    valueConstraints: [
      'Preserve uncertainty, consent, and a credible stop path.',
    ],
    stakeholderConsequences: [
      'Affected people retain agency while the accountable owner records impact.',
    ],
    recommendation:
      'Authorize one reversible experiment, record the observation, and decide against the predeclared threshold before scaling the action.',
    communicationStrategy:
      'State the assumption, threshold, uncertainty, and stop rule consistently.',
    uncertainties: [
      'The direct observation required to resolve the decision has not been collected.',
    ],
    whatCouldChangeTheAnswer: [
      'A contradictory direct signal or unacceptable harm would reverse this recommendation.',
    ],
    exactlyThreeNextActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Reversible action ${index + 1}`,
      actor: 'The accountable decision owner',
      assumptionBeingTested:
        'A bounded action can generate useful decision evidence safely.',
      smallestAction:
        'Run one limited observation without expanding the scope.',
      expectedObservation:
        'A direct signal appears inside the declared review horizon.',
      decisionThreshold:
        'Continue only when the declared signal appears without unacceptable harm.',
      reviewHorizon: 'Within fourteen days',
      reversibility:
        'Stop the test and restore the prior operating state.',
      risksOrAffectedParties:
        'Record affected parties and stop when the protected outcome is threatened.',
      decisionRule: 'revise',
    })),
  }
}

function directionalPortiaCase(): {
  readonly input: PortiaInput
  readonly review: PortiaReview
} {
  const fixture = makeTrajectoryDirectionalFixture()
  const survivors = orderPortiaCandidates(fixture.survivors)
  const assessments = survivors.map((candidate, index): PortiaCandidateAssessment => ({
    candidateId: candidate.candidateId,
    disposition: 'preserved',
    survivingInterpretation:
      `A bounded trajectory-qualified interpretation remains for ${candidate.candidateId}.`,
    requiredQualification: null,
    redundancyClusterId: null,
    coverageTags: index < 4
      ? [[
          'protected_outcome',
          'evidence_or_reality',
          'risk_or_countercase',
          'agency_or_action',
        ][index] as PortiaCandidateAssessment['coverageTags'][number]]
      : [],
    missingEvidence: ['A direct observation remains required before scaling.'],
    countercase:
      'A contradictory direct observation would reverse this interpretation.',
    reversalCondition:
      'Reverse the action when the predeclared stop signal appears.',
    attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
      attackType,
      outcome: 'passed',
      severity: 'low',
      finding: `The ${attackType} attack preserves a bounded interpretation.`,
      consequence: 'The recommendation must retain uncertainty and provenance.',
      requiredRevision: null,
    })),
    directionalRecordDigest: fixture.record.digest,
    directionalSignalKeys: [
      fixture.record.survivingDirectionKeys[
        index % fixture.record.survivingDirectionKeys.length
      ]!,
    ],
    directionalInterpretation:
      `The ordered route and material pressure make this direction relevant for ${candidate.candidateId}.`,
    directionalAmendment:
      `Carry the trajectory-qualified direction for ${candidate.candidateId} without treating it as factual evidence.`,
  }))
  const answerPromptDigest = 'f'.repeat(64)
  return {
    input: {
      problem: fixture.evidence.problem,
      survivors: fixture.survivors,
      answerPromptPackage: buildBoardAnswerPromptPackage(
        fixture.evidence,
        fixture.survivors,
        fixture.terminalFingerprint,
        [],
        [],
        fixture.record,
      ),
      answerPromptDigest,
    },
    review: {
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      reviewedAnswerPromptDigest: answerPromptDigest,
      directionalRecordVersion: fixture.record.version,
      directionalRecordDigest: fixture.record.digest,
      directionalSummary:
        'The complete ordered trajectory changed the cast-qualified directions retained across scrutiny without creating factual evidence.',
      promptDecision: 'permit',
      promptDecisionRationale:
        'The exact trajectory-bound prompt is reasonable under the retained qualifications.',
      runSummary:
        'Portia applied every attack and retained auditable directional amendments.',
      assessments,
      crossCandidateContradictions: [],
      redundancyClusters: [],
      missingCoverage: [],
      unresolvedQuestions: [
        'Which direct observation would most quickly reduce uncertainty?',
      ],
      recommendedGateInputs: {
        tensionCandidatePairs: [[
          assessments[0]!.candidateId,
          assessments[2]!.candidateId,
        ]],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    },
  }
}

function portiaProviderOutputs(review: PortiaReview): unknown[] {
  const candidateOutputs = review.assessments.map((assessment) => {
    const { redundancyClusterId: _cluster, ...output } = assessment
    void _cluster
    return output
  })
  const {
    assessments: _assessments,
    contractVersion: _contractVersion,
    reviewedAnswerPromptDigest: _reviewedAnswerPromptDigest,
    ...summary
  } = review
  void _assessments
  void _contractVersion
  void _reviewedAnswerPromptDigest
  return [...candidateOutputs, summary]
}

function serverEvidence(): ServerDerivedEvidence {
  return {
    problem: PROBLEM,
    turnCount: 1,
    outcome: {
      winner: 'white',
      reason: 'king-captured',
      completedTurn: 1,
    },
    captures: [{
      turn: 1,
      resonance: 72,
      cell: { ring: 4, sector: 3 },
      attacker: { side: 'white', kind: 'rook' },
      captured: { side: 'black', kind: 'king' },
      part: {
        id: 9,
        title: 'Evidence threshold',
        focus: 'The amount of evidence needed before expanding the commitment.',
        hexagram: 24,
        hexagramName: 'Return',
        theme: 'A measured return to what is known.',
        dimension: 'Evidence',
        movement: 'Clarify',
        prompt: 'What observation would justify a larger commitment?',
        keyword: 'Evidence threshold',
      },
    }],
  }
}

const requestContext: ModelRequestContext = {
  safetyHmacSecret: 'test-safety-secret',
  userId: 'user_openclaw_v2_test',
}

function modelResult(output: unknown) {
  return {
    model: 'test-model',
    outputText: JSON.stringify(output),
    provider: 'test-provider',
    transport: 'local' as const,
  }
}

async function rejectionFrom(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the operation to reject.')
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.modelAttribution.mockImplementation(
    (provider: string, model: string) => `${provider}/${model}`,
  )
  harness.buildFullPrompt.mockImplementation(
    (transportPrompt: string, model: string) =>
      `SYSTEM ROLE\nModel: ${model}\n\n${transportPrompt}`,
  )
})

describe('OpenClaw WebChess 2.2 model generation', () => {
  it('generates both initial and repair divisions through the structured contract', async () => {
    harness.runOpenClawModel.mockResolvedValue(modelResult({ facets: validFacets() }))

    const initial = await generateOpenClawDivisionV2(PROBLEM, {
      ...requestContext,
      idempotencyKey: 'division-initial-turn',
    })
    const repaired = await generateOpenClawDivisionV2({
      problem: PROBLEM,
      repairContext: {
        priorFieldGeneration: 1,
        gateMissingRequirements: ['Add a direct evidence check.'],
        missingCoverage: ['evidence_or_reality'],
        fieldRepairReasons: ['The first field lacked an explicit countercase.'],
      },
    }, {
      ...requestContext,
      idempotencyKey: 'division-repair-turn',
    })

    expect(initial.result.facets).toHaveLength(64)
    expect(initial.model).toBe('test-provider/test-model')
    expect(initial.usage.reported).toBe(false)
    expect(repaired.prompt).toContain('FIELD REGENERATION')
    expect(harness.runOpenClawModel).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('OPENCLAW STRUCTURED OUTPUT'),
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: 'division-initial-turn',
        thinking: 'low',
      }),
    )
    expect(harness.runOpenClawModel).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FIELD REGENERATION'),
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: 'division-repair-turn',
        thinking: 'low',
      }),
    )
  })

  it('binds compact cast applications to server-owned assignments', async () => {
    const directed = validCastDirectedFacets()
    const assignments = deriveDivisionCastAssignments(DIVISION_SEED)
    harness.runOpenClawModel.mockResolvedValueOnce(
      modelResult({ facets: directed }),
    )

    const generated = await generateOpenClawDivisionV2({
      problem: PROBLEM,
      divisionSeed: DIVISION_SEED,
    }, requestContext)

    expect(generated.result.facets).toEqual(validFacets().map((facet, index) => ({
      ...facet,
      castApplication: directed[index]!.castApplication,
    })))
    expect(JSON.stringify({ facets: directed }).length).toBeLessThan(25_000)
    expect(generated.prompt).toContain('webchess-division-cast-binding-v1')
    expect(generated.prompt).toContain(assignments[0]!.directionalCue)
    expect(generated.prompt).toContain(assignments[63]!.directionalCue)
    expect(generated.prompt).toContain('do not echo or add server-owned cast fields')
    const transportPrompt = harness.runOpenClawModel.mock.calls[0]?.[0] ?? ''
    const outputContract = transportPrompt.split(
      'OPENCLAW STRUCTURED OUTPUT',
    )[1] ?? ''
    expect(outputContract).toContain('"castApplication"')
    expect(outputContract).not.toContain('"directionalCue"')
    expect(harness.runOpenClawModel).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ thinking: 'low' }),
    )

    const compact = validCastDirectedFacets()
    const providerOwnedEcho = {
      ...compact[9]!,
      hexagram: 63,
    }
    harness.runOpenClawModel.mockResolvedValueOnce(
      modelResult({
        facets: [
          ...compact.slice(0, 9),
          providerOwnedEcho,
          ...compact.slice(10),
        ],
      }),
    )
    await expect(generateOpenClawDivisionV2({
      problem: PROBLEM,
      divisionSeed: DIVISION_SEED,
    }, requestContext)).rejects.toBeInstanceOf(ModelContractError)

    harness.runOpenClawModel.mockResolvedValueOnce(
      modelResult({ facets: validFacets() }),
    )
    await expect(generateOpenClawDivisionV2({
      problem: PROBLEM,
      divisionSeed: DIVISION_SEED,
    }, requestContext)).rejects.toBeInstanceOf(ModelContractError)

    const duplicateIds = validCastDirectedFacets()
    duplicateIds[63] = { ...duplicateIds[63]!, id: 1 }
    harness.runOpenClawModel.mockResolvedValueOnce(
      modelResult({ facets: duplicateIds }),
    )
    await expect(generateOpenClawDivisionV2({
      problem: PROBLEM,
      divisionSeed: DIVISION_SEED,
    }, requestContext)).rejects.toBeInstanceOf(ModelContractError)
  })

  it('resumes Portia only from exact directional assessments and retains the full record', async () => {
    const { input, review } = directionalPortiaCase()
    const outputs = portiaProviderOutputs(review)
    const completedAssessment = review.assessments[0]!
    const remainingOutputs = outputs.slice(1)
    harness.runOpenClawModel.mockImplementation(async () =>
      modelResult(remainingOutputs.shift()))

    const generated = await generateOpenClawPortiaV2({
      ...input,
      completedAssessments: [completedAssessment],
    }, {
      ...requestContext,
      idempotencyKey: 'stable-portia-turn',
    })

    expect(generated.result).toEqual(review)
    expect(harness.runOpenClawModel).toHaveBeenCalledTimes(
      input.survivors.length,
    )
    expect(harness.runOpenClawModel.mock.calls.map((call) =>
      call[2]?.idempotencyKey)).toEqual([
      ...Array.from(
        { length: input.survivors.length - 1 },
        (_, index) => `stable-portia-turn:candidate-${index + 2}`,
      ),
      'stable-portia-turn:summary',
    ])
    expect(harness.runOpenClawModel.mock.calls[0]![0]).toContain(
      makeTrajectoryDirectionalFixture().record.digest,
    )
    expect(harness.runOpenClawModel.mock.calls[0]![0]).toContain(
      'not decorative or optional metaphor',
    )
    expect(generated.prompt).toContain(
      makeTrajectoryDirectionalFixture().record.digest,
    )
    const summaryPrompt = harness.runOpenClawModel.mock.calls.at(-1)![0]
    expect(summaryPrompt).toContain(
      'The server binds reviewedAnswerPromptDigest',
    )
    expect(summaryPrompt).toContain(
      'do not return reviewedAnswerPromptDigest',
    )
    const summaryContract = summaryPrompt.split(
      'OPENCLAW STRUCTURED OUTPUT',
    ).at(-1)!
    expect(summaryContract).not.toContain('"reviewedAnswerPromptDigest"')
    expect(summaryContract).toContain('"directionalRecordDigest"')
    expect(summaryPrompt).toContain(
      'Consumed and unresolved assessments remain audit-visible but are non-supporting',
    )
    expect(summaryPrompt).toContain(
      'do not return candidate-level directionalSignalKeys',
    )
    expect(summaryPrompt).not.toContain(
      'Return 1–8 unique directionalSignalKeys',
    )

    await expect(generateOpenClawPortiaV2({
      ...input,
      completedAssessments: [{
        ...completedAssessment,
        directionalRecordDigest: '0'.repeat(64),
      }],
    }, requestContext)).rejects.toBeInstanceOf(ModelInputError)
    expect(harness.runOpenClawModel).toHaveBeenCalledTimes(
      input.survivors.length,
    )
  })

  it('uses Charlotte\'s strict qualification-list transport and normalizes wounds', async () => {
    const directional = directionalPortiaCase()
    const record = directional.input.answerPromptPackage
      .trajectoryDirectionalRecord!
    const first = directional.review.assessments[0]!
    const qualification =
      'Retain the exact wound and require direct evidence before scaling.'
    const portia: PortiaReview = {
      ...directional.review,
      assessments: directional.review.assessments.map((assessment) =>
        assessment.candidateId === first.candidateId
          ? {
              ...assessment,
              disposition: 'wounded',
              requiredQualification: qualification,
            }
          : assessment),
    }
    const gate = evaluateGate(portia, undefined, record)
    expect(gate.passed).toBe(true)
    const boardAnswer = {
      answer:
        'Run one bounded observation first, compare it against a declared threshold, and expand the commitment only when that direct result supports doing so.',
      model: 'test-provider/test-model',
      prompt: 'The exact Portia-approved, trajectory-bound Answer prompt.',
    }
    const input: CharlotteInput = {
      problem: directional.input.problem,
      boardAnswer,
      boardAnswerDigest: hashCanonicalJson(
        boardAnswer as unknown as CanonicalJson,
      ),
      reviewedPromptDigest: directional.input.answerPromptDigest,
      portia,
      gate,
      trajectoryDirectionalRecord: record,
    }
    harness.runOpenClawModel.mockResolvedValueOnce(modelResult(
      validCharlotteTransportResult(first.candidateId, qualification),
    ))

    const generated = await generateOpenClawCharlotteV2(input, {
      ...requestContext,
      idempotencyKey: 'stable-charlotte-turn',
    })

    expect(generated.result.structured.qualificationsByCandidateId).toEqual({
      [first.candidateId]: qualification,
    })
    const transportPrompt = harness.runOpenClawModel.mock.calls[0]![0]
    const transportContract = transportPrompt.split(
      'OPENCLAW STRUCTURED OUTPUT',
    ).at(-1)!
    expect(transportContract).toContain('"qualifications"')
    expect(transportContract).not.toContain('"qualificationsByCandidateId"')
    expect(transportPrompt).toContain(
      'For every wounded supporting candidate, add one qualifications entry',
    )
    expect(transportPrompt).toContain(
      '"projection_version":"webchess-directional-prompt-projection-v1"',
    )
    expect(transportPrompt).toContain('"supporting_captures":')
    expect(transportPrompt).toContain('"supporting_survivors":')
    expect(transportPrompt).not.toContain('"trajectory_directional_record"')
    expect(transportPrompt).not.toContain('"trajectory_directional_scrutiny"')
    expect(transportPrompt).not.toContain('"parts":')
    expect(transportPrompt).not.toContain('"events":')
    expect(transportPrompt).not.toContain('"directions":')
    expect(harness.runOpenClawModel.mock.calls[0]?.[2]).toMatchObject({
      idempotencyKey: 'stable-charlotte-turn',
    })
  })

  it('turns malformed structured content into a model contract failure', async () => {
    harness.runOpenClawModel.mockResolvedValue(modelResult({ facets: [] }))

    await expect(generateOpenClawDivisionV2(PROBLEM, requestContext))
      .rejects.toBeInstanceOf(ModelContractError)
  })

  it.each([
    ['not-found', ModelConfigurationError],
    ['invalid-output', ModelContractError],
    ['timeout', OpenClawProviderError],
    ['aborted', OpenClawProviderError],
    ['failed', OpenClawProviderError],
  ] as const)('translates the %s CLI failure without hiding its category', async (
    kind,
    ExpectedError,
  ) => {
    harness.runOpenClawModel.mockRejectedValue(
      new OpenClawCliError(kind, `simulated ${kind}`),
    )

    const error = await rejectionFrom(
      generateOpenClawDivisionV2(PROBLEM, requestContext),
    )
    expect(error).toBeInstanceOf(ExpectedError)
    if (error instanceof OpenClawProviderError) {
      expect(error.ambiguous).toBe(true)
      expect(error.failureCode).toBe(kind === 'timeout'
        ? 'provider_timeout'
        : kind === 'aborted'
          ? 'request_aborted'
          : 'provider_connection_lost')
    }
  })

  it('rethrows an unexpected local failure unchanged', async () => {
    const failure = new Error('unexpected local failure')
    harness.runOpenClawModel.mockRejectedValue(failure)

    await expect(generateOpenClawDivisionV2(PROBLEM, requestContext))
      .rejects.toBe(failure)
  })

  it('builds and persists the full role envelope for a legacy board answer', async () => {
    harness.runOpenClawModel.mockResolvedValue(modelResult(validAnswer()))

    const generated = await generateOpenClawAnswerV2(
      serverEvidence(),
      requestContext,
    )

    expect(buildOpenClawAnswerPrompt(serverEvidence())).toContain(
      'OPENCLAW STRUCTURED OUTPUT',
    )
    expect(generated.prompt).toContain('SYSTEM ROLE')
    expect(generated.prompt).toContain('test-provider/test-model')
    expect(generated.result.answer).toContain('reversible step')
    expect(harness.runOpenClawModel).toHaveBeenCalledOnce()
    expect(harness.buildFullPrompt).toHaveBeenCalledTimes(3)
  })

  it('uses one deterministic corrective turn without weakening the Answer contract', async () => {
    const controller = new AbortController()
    const context: ModelRequestContext = {
      ...requestContext,
      idempotencyKey: 'answer-provider-request',
      signal: controller.signal,
    }
    harness.runOpenClawModel
      .mockResolvedValueOnce(modelResult({ answer: 'Too short.' }))
      .mockResolvedValueOnce(modelResult(validAnswer()))

    const generated = await generateOpenClawAnswerV2(serverEvidence(), context)

    expect(harness.runOpenClawModel).toHaveBeenCalledTimes(2)
    expect(harness.runOpenClawModel).toHaveBeenNthCalledWith(
      1,
      expect.not.stringContaining('CORRECTION REQUIRED'),
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: 'answer-provider-request',
        signal: controller.signal,
        thinking: 'medium',
      }),
    )
    expect(harness.runOpenClawModel).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('CORRECTION REQUIRED'),
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: 'answer-provider-request:answer-contract-correction',
        signal: controller.signal,
        thinking: 'medium',
      }),
    )
    expect(generated.result.answer).toContain('Three next moves\n\n1. ')
    expect(generated.prompt).toContain('CORRECTION REQUIRED')
    expect(generated.usage).toMatchObject({ reported: false, totalTokens: 0 })
  })

  it('renews the one logical Answer lease before each bounded provider turn', async () => {
    const order: string[] = []
    const onProviderTurnStart = vi.fn(async () => undefined)
      .mockImplementation(async () => {
        order.push('hook')
      })
    let attempt = 0
    harness.runOpenClawModel.mockImplementation(
      async (_prompt, _config, options) => {
        await options?.onRequestStart?.()
        order.push('dispatch')
        attempt += 1
        return modelResult(attempt === 1
          ? { answer: 'Too short.' }
          : validAnswer())
      },
    )

    await generateOpenClawAnswerV2(serverEvidence(), {
      ...requestContext,
      onProviderTurnStart,
    } as ModelRequestContext)

    expect(onProviderTurnStart).toHaveBeenCalledTimes(2)
    expect(onProviderTurnStart).toHaveBeenNthCalledWith(1, {
      index: 1,
      idempotencyKey: undefined,
    })
    expect(onProviderTurnStart).toHaveBeenNthCalledWith(2, {
      index: 2,
      idempotencyKey: undefined,
    })
    expect(order).toEqual(['hook', 'dispatch', 'hook', 'dispatch'])
  })

  it('uses the same per-turn idempotency keys when a logical Answer request is replayed', async () => {
    const context: ModelRequestContext = {
      ...requestContext,
      idempotencyKey: 'stable-answer-request',
    }
    harness.runOpenClawModel
      .mockResolvedValueOnce(modelResult({ answer: 'Too short.' }))
      .mockResolvedValueOnce(modelResult(validAnswer()))
      .mockResolvedValueOnce(modelResult({ answer: 'Too short again.' }))
      .mockResolvedValueOnce(modelResult(validAnswer()))

    await generateOpenClawAnswerV2(serverEvidence(), context)
    await generateOpenClawAnswerV2(serverEvidence(), context)

    expect(harness.runOpenClawModel.mock.calls.map((call) =>
      call[2]?.idempotencyKey)).toEqual([
      'stable-answer-request',
      'stable-answer-request:answer-contract-correction',
      'stable-answer-request',
      'stable-answer-request:answer-contract-correction',
    ])
  })

  it('rejects the second invalid response without a third turn or provider output disclosure', async () => {
    harness.runOpenClawModel.mockResolvedValue(modelResult({
      answer: 'Still invalid. token=provider-output-secret',
    }))

    const error = await rejectionFrom(
      generateOpenClawAnswerV2(serverEvidence(), requestContext),
    )

    expect(error).toBeInstanceOf(OpenClawAnswerContractError)
    expect(harness.runOpenClawModel).toHaveBeenCalledTimes(2)
    expect(error).toMatchObject({
      publicPrompt: expect.stringContaining('CORRECTION REQUIRED'),
    })
    expect((error as OpenClawAnswerContractError).publicPrompt).not.toMatch(
      /provider-output-secret|token=|stderr|private model reasoning/u,
    )
  })

  it('does not start a corrective turn after cancellation of the invalid first turn', async () => {
    const controller = new AbortController()
    harness.runOpenClawModel.mockImplementationOnce(async () => {
      controller.abort()
      return modelResult({ answer: 'Too short.' })
    })

    const error = await rejectionFrom(generateOpenClawAnswerV2(
      serverEvidence(),
      { ...requestContext, signal: controller.signal },
    ))

    expect(error).toBeInstanceOf(OpenClawProviderError)
    expect(error).toMatchObject({ failureCode: 'request_aborted' })
    expect(harness.runOpenClawModel).toHaveBeenCalledOnce()
  })

  it('stops after an aborted corrective turn', async () => {
    harness.runOpenClawModel
      .mockResolvedValueOnce(modelResult({ answer: 'Too short.' }))
      .mockRejectedValueOnce(new OpenClawCliError('aborted', 'cancelled'))

    const error = await rejectionFrom(
      generateOpenClawAnswerV2(serverEvidence(), requestContext),
    )

    expect(error).toBeInstanceOf(OpenClawProviderError)
    expect(error).toMatchObject({ failureCode: 'request_aborted' })
    expect(harness.runOpenClawModel).toHaveBeenCalledTimes(2)
  })

  it('does not correct a provider failure that produced no candidate answer', async () => {
    harness.runOpenClawModel.mockRejectedValueOnce(
      new OpenClawCliError('failed', 'provider connection failed'),
    )

    await expect(generateOpenClawAnswerV2(serverEvidence(), requestContext))
      .rejects.toMatchObject({ failureCode: 'provider_connection_lost' })
    expect(harness.runOpenClawModel).toHaveBeenCalledOnce()
  })

  it('rejects an Answer role envelope that cannot be persisted durably', async () => {
    harness.buildFullPrompt.mockReturnValue(
      'x'.repeat(MAX_PERSISTED_MODEL_PROMPT_CHARS + 1),
    )

    await expect(generateOpenClawAnswerV2(serverEvidence(), requestContext))
      .rejects.toBeInstanceOf(ModelInputError)
    expect(harness.runOpenClawModel).not.toHaveBeenCalled()
  })

  it('rejects an oversized corrective envelope before spending the first provider turn', async () => {
    harness.buildFullPrompt.mockImplementation((transportPrompt: string) =>
      transportPrompt.includes('CORRECTION REQUIRED')
        ? 'x'.repeat(MAX_PERSISTED_MODEL_PROMPT_CHARS + 1)
        : 'persistable initial envelope')

    await expect(generateOpenClawAnswerV2(serverEvidence(), requestContext))
      .rejects.toBeInstanceOf(ModelInputError)
    expect(harness.runOpenClawModel).not.toHaveBeenCalled()
  })
})

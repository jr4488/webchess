// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '@/types'
import {
  ModelConfigurationError,
  ModelContractError,
  type ModelRequestContext,
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
  generateOpenClawDivisionV2,
} from './v2-generation'

const PROBLEM =
  'How should I choose a reversible next step while the available evidence is incomplete?'

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

    const initial = await generateOpenClawDivisionV2(PROBLEM, requestContext)
    const repaired = await generateOpenClawDivisionV2({
      problem: PROBLEM,
      repairContext: {
        priorFieldGeneration: 1,
        gateMissingRequirements: ['Add a direct evidence check.'],
        missingCoverage: ['evidence_or_reality'],
        fieldRepairReasons: ['The first field lacked an explicit countercase.'],
      },
    }, requestContext)

    expect(initial.result.facets).toHaveLength(64)
    expect(initial.model).toBe('test-provider/test-model')
    expect(initial.usage.reported).toBe(false)
    expect(repaired.prompt).toContain('FIELD REGENERATION')
    expect(harness.runOpenClawModel).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('OPENCLAW STRUCTURED OUTPUT'),
      expect.any(Object),
      expect.objectContaining({ thinking: 'medium' }),
    )
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

// @vitest-environment node

import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import {
  buildWebChessInput,
  countAnswerWords,
  normalizeWebChessAnswer,
  parseServerDerivedEvidence,
  type ServerDerivedEvidence,
} from './answer'
import { resolveModelRequest } from './client'
import {
  type DivisionFacet,
  normalizeDivisionFacets,
  normalizeDivisionProblem,
} from './division'
import {
  assessDivisionQuality,
  type DivisionQualityFacet,
} from './division-quality'
import {
  ModelResponseError,
  parseCompletedResponse,
  schemaInvalidResponseError,
} from './response'
import { createSafetyIdentifier } from './safety'
import {
  MAX_OPENAI_TIMEOUT_MS,
  ModelConfigurationError,
  ModelContractError,
  ModelInputError,
  type ModelRequestContext,
  type OpenAIClientLike,
} from './types'
import { normalizeModelUsage } from './usage'

type DivisionQualityThresholdOverrides = NonNullable<
  NonNullable<Parameters<typeof assessDivisionQuality>[1]>['thresholds']
>

function qualityThresholds(
  overrides: Record<string, number>,
): DivisionQualityThresholdOverrides {
  // The production constants intentionally retain literal values. Tests vary
  // them to exercise the configurable comparison branches.
  return overrides as unknown as DivisionQualityThresholdOverrides
}

const PROBLEM =
  'How should I choose a reversible next step while the evidence is incomplete?'
const SAFETY_SECRET = 's'.repeat(32)
const create = vi.fn()
const client = {
  responses: { create },
} as unknown as OpenAIClientLike

function requestContext(
  overrides: Partial<ModelRequestContext> = {},
): ModelRequestContext {
  return {
    userId: 'user_branch_fixture',
    safetyHmacSecret: SAFETY_SECRET,
    client,
    ...overrides,
  }
}

function reportedUsage() {
  return {
    input_tokens: 12,
    output_tokens: 8,
    total_tokens: 20,
  }
}

function completedResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp_branch_fixture',
    model: 'gpt-5.6-sol',
    status: 'completed',
    incomplete_details: null,
    output: [{
      id: 'msg_branch_fixture',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: JSON.stringify({ value: 'accepted' }),
        annotations: [],
      }],
    }],
    usage: reportedUsage(),
    ...overrides,
  }
}

function evidencePart(id = 9) {
  return {
    id,
    title: `Evidence threshold ${id}`,
    focus: `The amount of evidence needed before expanding commitment ${id}.`,
    hexagram: id,
    hexagramName: `Measured return ${id}`,
    theme: `Return carefully to what is already known for lens ${id}.`,
    dimension: 'Evidence',
    movement: 'Clarify',
    prompt: `What observation would justify a larger commitment for lens ${id}?`,
    keyword: `Evidence ${id}`,
  }
}

function capture(
  turn: number,
  attacker: 'white' | 'black',
  captured: 'white' | 'black',
  capturedKind: ServerDerivedEvidence['captures'][number]['captured']['kind'] = 'pawn',
  partId = 9,
): ServerDerivedEvidence['captures'][number] {
  return {
    turn,
    resonance: 72,
    cell: { ring: 4, sector: 3 },
    attacker: { side: attacker, kind: 'rook' },
    captured: { side: captured, kind: capturedKind },
    part: evidencePart(partId),
  }
}

function kingCaptureEvidence(): ServerDerivedEvidence {
  return {
    problem: PROBLEM,
    turnCount: 1,
    outcome: {
      winner: 'white',
      reason: 'king-captured',
      completedTurn: 1,
    },
    captures: [capture(1, 'white', 'black', 'king')],
  }
}

function words(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(' ')
}

function validAnswerSections() {
  return {
    answer: `Take one reversible step now. Reassess before expanding the commitment.\n\n${words('context', 80)}`,
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

function alphabeticCode(value: number): string {
  const first = String.fromCharCode(97 + Math.floor((value - 1) / 26))
  const second = String.fromCharCode(97 + ((value - 1) % 26))
  return `x${first}${second}`
}

function validFacets(): DivisionFacet[] {
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

describe('OpenAI request resolution defensive branches', () => {
  it('requires an object context and a configured provider', () => {
    expect(() =>
      resolveModelRequest(null as unknown as ModelRequestContext),
    ).toThrow(ModelConfigurationError)
    expect(() =>
      resolveModelRequest(requestContext({ client: undefined })),
    ).toThrow('server-side OpenAI API key')
    expect(() =>
      resolveModelRequest(requestContext({
        client: undefined,
        apiKey: '   ',
      })),
    ).toThrow(ModelConfigurationError)
  })

  it('uses default request controls when optional controls are absent', () => {
    const resolved = resolveModelRequest(requestContext())

    expect(resolved.requestOptions).toMatchObject({
      timeout: 120_000,
      maxRetries: 0,
    })
    expect(resolved.requestOptions).not.toHaveProperty('idempotencyKey')
    expect(resolved.requestOptions.signal).toBeInstanceOf(AbortSignal)
  })

  it('combines a caller signal and trims an idempotency key', () => {
    const controller = new AbortController()
    const resolved = resolveModelRequest(requestContext({
      signal: controller.signal,
      timeoutMs: 1_000,
      idempotencyKey: '  request-key  ',
    }))

    expect(resolved.requestOptions.idempotencyKey).toBe('request-key')
    controller.abort()
    expect(resolved.requestOptions.signal?.aborted).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, MAX_OPENAI_TIMEOUT_MS + 1])(
    'rejects invalid timeout %s',
    (timeoutMs) => {
      expect(() =>
        resolveModelRequest(requestContext({ timeoutMs })),
      ).toThrow(ModelConfigurationError)
    },
  )

  it.each(['', '   ', 'x'.repeat(256)])(
    'rejects invalid idempotency key length',
    (idempotencyKey) => {
      expect(() =>
        resolveModelRequest(requestContext({ idempotencyKey })),
      ).toThrow(ModelConfigurationError)
    },
  )

  it('constructs a server client without making a request', () => {
    const resolved = resolveModelRequest(requestContext({
      client: undefined,
      apiKey: 'sk-test-never-sent',
    }))

    expect(resolved.client.responses.create).toBeTypeOf('function')
  })

  it.each([
    {},
    { responses: {} },
    { responses: { create: 'not-a-function' } },
  ])('rejects malformed injected clients', (malformedClient) => {
    expect(() =>
      resolveModelRequest(requestContext({
        client: malformedClient as unknown as OpenAIClientLike,
      })),
    ).toThrow(ModelConfigurationError)
  })
})

describe('provider response fail-closed branches', () => {
  const schema = z.strictObject({ value: z.string() })

  it.each([null, 'response', [], 7])(
    'rejects non-record provider response %j',
    (value) => {
      expect(() => parseCompletedResponse(value, schema)).toThrow(
        ModelResponseError,
      )
      try {
        parseCompletedResponse(value, schema)
      } catch (error) {
        expect(error).toMatchObject({
          providerId: null,
          model: null,
          status: 'invalid_response',
          usage: { reported: false },
        })
      }
    },
  )

  it('sanitizes metadata when malformed usage is rejected', () => {
    expect(() =>
      parseCompletedResponse(completedResponse({
        id: 'bad\nidentifier',
        model: 'bad model',
        usage: 'not-usage',
      }), schema),
    ).toThrow(ModelResponseError)

    try {
      parseCompletedResponse(completedResponse({
        id: 'bad\nidentifier',
        model: 'bad model',
        usage: 'not-usage',
      }), schema)
    } catch (error) {
      expect(error).toMatchObject({
        providerId: null,
        model: null,
        status: 'invalid_response',
        usage: { reported: false },
      })
    }
  })

  it.each([
    { status: 'failed', incomplete_details: null },
    { status: 'completed', incomplete_details: { reason: 'limit' } },
  ])('rejects incomplete response variants', (overrides) => {
    expect(() =>
      parseCompletedResponse(completedResponse(overrides), schema),
    ).toThrow(expect.objectContaining({ status: 'incomplete' }))
  })

  it('walks malformed output items and detects a typed refusal', () => {
    const response = completedResponse({
      output: [
        null,
        { content: 'not-an-array' },
        {
          content: [
            null,
            { type: 'text', refusal: '   ' },
            { type: 'refusal' },
          ],
        },
      ],
    })

    expect(() => parseCompletedResponse(response, schema)).toThrow(
      expect.objectContaining({ status: 'refused' }),
    )
  })

  it('detects a nonblank refusal field independently of its type', () => {
    expect(() =>
      parseCompletedResponse(completedResponse({
        output: [{
          content: [{ type: 'text', refusal: 'Cannot fulfill this request.' }],
        }],
      }), schema),
    ).toThrow(expect.objectContaining({ status: 'refused' }))
  })

  it('rejects structured output that misses the schema', () => {
    expect(() =>
      parseCompletedResponse(completedResponse({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: JSON.stringify({ value: 7 }),
          }],
        }],
      }), schema),
    ).toThrow(expect.objectContaining({ status: 'schema_invalid' }))
  })

  it('rejects malformed structured JSON after preserving accounting metadata', () => {
    const response = completedResponse({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: '{"value":"secret-output"',
        }],
      }],
    })

    try {
      parseCompletedResponse(response, schema)
      throw new Error('Expected malformed JSON to be rejected.')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelResponseError)
      expect(error).toMatchObject({
        providerId: 'resp_branch_fixture',
        model: 'gpt-5.6-sol',
        status: 'schema_invalid',
        usage: {
          reported: true,
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
        },
      })
      expect(JSON.stringify(error)).not.toContain('secret-output')
      expect(error).not.toHaveProperty('cause')
    }
  })

  it.each([
    { id: 22, model: 'gpt-5.6-sol' },
    { id: 'resp_valid', model: ' model with spaces ' },
    { id: 'x'.repeat(256), model: 'gpt-5.6-sol' },
    { id: 'resp_valid', model: `m${'x'.repeat(120)}` },
  ])('rejects completed responses with unsafe metadata', (overrides) => {
    expect(() =>
      parseCompletedResponse(completedResponse(overrides), schema),
    ).toThrow(expect.objectContaining({ status: 'invalid_response' }))
  })

  it('accepts valid output when usage is absent and trims safe metadata', () => {
    const response = completedResponse({
      usage: null,
      id: '  resp_valid_1  ',
      model: ' gpt-5.6-sol:stable ',
    })

    expect(parseCompletedResponse(response, schema)).toEqual({
      providerId: 'resp_valid_1',
      model: 'gpt-5.6-sol:stable',
      output: { value: 'accepted' },
      usage: expect.objectContaining({ reported: false }),
    })
  })

  it('constructs the safe schema-invalid envelope directly', () => {
    const error = schemaInvalidResponseError({
      providerId: 'resp_safe',
      model: 'gpt-safe',
      usage: normalizeModelUsage(null),
    })

    expect(error).toMatchObject({
      status: 'schema_invalid',
      providerId: 'resp_safe',
      model: 'gpt-safe',
    })
  })
})

describe('safety identifier and usage boundary branches', () => {
  it.each([null, 42, {}, []])('rejects non-text user IDs', (userId) => {
    expect(() =>
      createSafetyIdentifier(
        userId as unknown as string,
        SAFETY_SECRET,
      ),
    ).toThrow(ModelInputError)
  })

  it.each(['', '   ', 'u'.repeat(513)])(
    'rejects empty or oversized user IDs',
    (userId) => {
      expect(() =>
        createSafetyIdentifier(userId, SAFETY_SECRET),
      ).toThrow(ModelInputError)
    },
  )

  it('accepts a sufficiently long byte secret', () => {
    expect(
      createSafetyIdentifier('user_bytes', new Uint8Array(32)),
    ).toMatch(/^wc_[A-Za-z0-9_-]{43}$/u)
  })

  it.each([
    {},
    new Uint8Array(31),
    'short',
  ])('rejects invalid safety secrets', (secret) => {
    expect(() =>
      createSafetyIdentifier(
        'user_secret',
        secret as unknown as string,
      ),
    ).toThrow(ModelConfigurationError)
  })

  it.each([null, undefined])('normalizes absent usage %s', (value) => {
    expect(normalizeModelUsage(value).reported).toBe(false)
  })

  it.each(['usage', [], 1])('rejects non-record usage %j', (value) => {
    expect(() => normalizeModelUsage(value)).toThrow(ModelContractError)
  })

  it.each([
    { input_tokens_details: 'details' },
    { output_tokens_details: [] },
  ])('rejects malformed token detail objects', (details) => {
    expect(() =>
      normalizeModelUsage({
        ...reportedUsage(),
        ...details,
      }),
    ).toThrow(ModelContractError)
  })

  it('normalizes null, missing, and populated optional token counts', () => {
    expect(normalizeModelUsage({
      ...reportedUsage(),
      input_tokens_details: {
        cached_tokens: null,
      },
      output_tokens_details: null,
    })).toMatchObject({
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    })

    expect(normalizeModelUsage({
      ...reportedUsage(),
      input_tokens_details: {
        cached_tokens: 4,
        cache_write_tokens: 2,
      },
      output_tokens_details: {
        reasoning_tokens: 3,
      },
    })).toMatchObject({
      cachedInputTokens: 4,
      cacheWriteInputTokens: 2,
      reasoningOutputTokens: 3,
    })
  })

  it.each([
    { input_tokens: -1 },
    { output_tokens: 1.5 },
    { total_tokens: Number.NaN },
    {
      input_tokens_details: {
        cached_tokens: -1,
      },
    },
    {
      output_tokens_details: {
        reasoning_tokens: 1.25,
      },
    },
  ])('rejects an invalid required or optional token count', (overrides) => {
    expect(() =>
      normalizeModelUsage({
        ...reportedUsage(),
        ...overrides,
      }),
    ).toThrow(ModelContractError)
  })
})

describe('server-derived answer evidence branches', () => {
  it('accepts valid endings and normalizes trusted evidence text', () => {
    const noMoves = parseServerDerivedEvidence({
      problem: `  ${PROBLEM}  `,
      turnCount: 0,
      outcome: {
        winner: null,
        reason: 'no-moves',
        completedTurn: 0,
      },
      captures: [],
    })
    expect(noMoves.problem).toBe(PROBLEM)

    expect(() => parseServerDerivedEvidence({
      problem: PROBLEM,
      turnCount: 100,
      outcome: {
        winner: null,
        reason: 'no-progress',
        completedTurn: 100,
      },
      captures: [],
    })).not.toThrow()

    expect(() => parseServerDerivedEvidence({
      problem: PROBLEM,
      turnCount: 101,
      outcome: {
        winner: null,
        reason: 'no-progress',
        completedTurn: 101,
      },
      captures: [capture(1, 'white', 'black')],
    })).not.toThrow()

    expect(() => parseServerDerivedEvidence({
      problem: PROBLEM,
      turnCount: 256,
      outcome: {
        winner: null,
        reason: 'move-limit',
        completedTurn: 256,
      },
      captures: [],
    })).not.toThrow()
  })

  it('rejects replay and ending invariants independently', () => {
    const invalidEvidence: unknown[] = [
      {
        ...kingCaptureEvidence(),
        turnCount: 2,
      },
      {
        ...kingCaptureEvidence(),
        turnCount: 0,
        outcome: {
          winner: 'white',
          reason: 'king-captured',
          completedTurn: 0,
        },
      },
      {
        ...kingCaptureEvidence(),
        captures: [capture(1, 'white', 'white', 'king')],
      },
      {
        problem: PROBLEM,
        turnCount: 3,
        outcome: {
          winner: null,
          reason: 'no-moves',
          completedTurn: 3,
        },
        captures: [
          capture(3, 'white', 'black'),
          capture(2, 'black', 'white'),
        ],
      },
      {
        problem: PROBLEM,
        turnCount: 1,
        outcome: {
          winner: null,
          reason: 'no-moves',
          completedTurn: 1,
        },
        captures: [capture(1, 'black', 'white')],
      },
      {
        ...kingCaptureEvidence(),
        outcome: {
          winner: null,
          reason: 'king-captured',
          completedTurn: 1,
        },
      },
      {
        ...kingCaptureEvidence(),
        captures: [],
      },
      {
        ...kingCaptureEvidence(),
        captures: [capture(1, 'white', 'black')],
      },
      {
        ...kingCaptureEvidence(),
        turnCount: 3,
        outcome: {
          winner: 'white',
          reason: 'king-captured',
          completedTurn: 3,
        },
      },
      {
        ...kingCaptureEvidence(),
        outcome: {
          winner: 'black',
          reason: 'king-captured',
          completedTurn: 1,
        },
      },
      {
        problem: PROBLEM,
        turnCount: 2,
        outcome: {
          winner: 'black',
          reason: 'king-captured',
          completedTurn: 2,
        },
        captures: [
          capture(1, 'white', 'black', 'king'),
          capture(2, 'black', 'white', 'king'),
        ],
      },
      {
        problem: PROBLEM,
        turnCount: 0,
        outcome: {
          winner: 'white',
          reason: 'no-moves',
          completedTurn: 0,
        },
        captures: [],
      },
      {
        problem: PROBLEM,
        turnCount: 1,
        outcome: {
          winner: null,
          reason: 'no-moves',
          completedTurn: 1,
        },
        captures: [capture(1, 'white', 'black', 'king')],
      },
      {
        problem: PROBLEM,
        turnCount: 99,
        outcome: {
          winner: null,
          reason: 'no-progress',
          completedTurn: 99,
        },
        captures: [],
      },
      {
        problem: PROBLEM,
        turnCount: 100,
        outcome: {
          winner: null,
          reason: 'no-progress',
          completedTurn: 100,
        },
        captures: [capture(1, 'white', 'black')],
      },
      {
        problem: PROBLEM,
        turnCount: 255,
        outcome: {
          winner: null,
          reason: 'move-limit',
          completedTurn: 255,
        },
        captures: [],
      },
    ]

    for (const evidence of invalidEvidence) {
      expect(() => parseServerDerivedEvidence(evidence)).toThrow(
        ModelInputError,
      )
    }
  })

  it('sorts repeated evidence lenses by occurrence, resonance, then ID', () => {
    const evidence: ServerDerivedEvidence = {
      problem: PROBLEM,
      turnCount: 4,
      outcome: {
        winner: null,
        reason: 'no-moves',
        completedTurn: 4,
      },
      captures: [
        { ...capture(1, 'white', 'black', 'pawn', 3), resonance: 50 },
        { ...capture(2, 'black', 'white', 'pawn', 2), resonance: 80 },
        { ...capture(3, 'white', 'black', 'rook', 3), resonance: 90 },
        { ...capture(4, 'black', 'white', 'bishop', 1), resonance: 80 },
      ],
    }

    const input = JSON.parse(buildWebChessInput(evidence)) as {
      game_evidence: {
        recurring_lenses: Array<{
          problem_facet: { id: number }
          occurrences: number
        }>
      }
    }
    expect(input.game_evidence.recurring_lenses.map(
      (lens) => lens.problem_facet.id,
    )).toEqual([3, 1, 2])
    expect(input.game_evidence.recurring_lenses[0]?.occurrences).toBe(2)
  })
})

describe('answer normalization cross-field branches', () => {
  it('counts Unicode words and handles non-text or punctuation-only input', () => {
    expect(countAnswerWords(null)).toBe(0)
    expect(countAnswerWords('---')).toBe(0)
    expect(countAnswerWords("don't naïve 42")).toBe(3)
  })

  it('accepts and normalizes a valid answer', () => {
    const result = normalizeWebChessAnswer(validAnswerSections())
    expect(result.wordCount).toBeGreaterThanOrEqual(450)
    expect(result.wordCount).toBeLessThanOrEqual(750)
  })

  it('rejects an initial schema mismatch', () => {
    expect(() => normalizeWebChessAnswer({
      ...validAnswerSections(),
      three_next_moves: ['only one'],
    })).toThrow(ModelContractError)
  })

  it('rejects a section made too short by whitespace normalization', () => {
    expect(() => normalizeWebChessAnswer({
      ...validAnswerSections(),
      answer: `First.${' '.repeat(90)}Second.`,
    })).toThrow('normalized model answer')
  })

  it('rejects action numbering supplied by the model', () => {
    const sections = validAnswerSections()
    sections.three_next_moves[0] =
      `1. ${words('observe', 40)}`
    expect(() => normalizeWebChessAnswer(sections)).toThrow(
      'numeric prefixes',
    )
  })

  it.each([
    words('sentence', 80),
    `One. Two. Three. Four.\n\n${words('context', 80)}`,
  ])('rejects an opening without two or three sentences', (answer) => {
    expect(() => normalizeWebChessAnswer({
      ...validAnswerSections(),
      answer,
    })).toThrow('two or three sentences')
  })

  it('rejects an answer below the rendered minimum word count', () => {
    expect(() => normalizeWebChessAnswer({
      answer: `A${'x'.repeat(80)}. B${'y'.repeat(80)}.`,
      what_the_conflicts_emphasized: 'c'.repeat(80),
      the_tension_to_hold: 't'.repeat(80),
      three_next_moves: [
        'o'.repeat(30),
        'p'.repeat(30),
        'r'.repeat(30),
      ],
      what_could_change_the_answer: 'z'.repeat(80),
    })).toThrow('450–750 words')
  })

  it('rejects an answer above the rendered maximum word count', () => {
    expect(() => normalizeWebChessAnswer({
      answer: `Start now. Check next.\n\n${words('x', 500)}`,
      what_the_conflicts_emphasized: words('x', 500),
      the_tension_to_hold: words('x', 500),
      three_next_moves: [
        words('x', 100),
        words('x', 100),
        words('x', 100),
      ],
      what_could_change_the_answer: words('x', 500),
    })).toThrow('450–750 words')
  })
})

describe('division input and facet contract branches', () => {
  it.each([null, {}, 12])('rejects a non-text problem', (problem) => {
    expect(() => normalizeDivisionProblem(problem)).toThrow(ModelInputError)
  })

  it.each(['short', 'x'.repeat(241)])(
    'rejects a problem outside the allowed bounds',
    (problem) => {
      expect(() => normalizeDivisionProblem(problem)).toThrow(ModelInputError)
    },
  )

  it('collapses problem whitespace', () => {
    expect(normalizeDivisionProblem(
      '  Which   reversible\nstep should I test first?  ',
    )).toBe('Which reversible step should I test first?')
  })

  it('rejects an output that is not exactly 64 structured facets', () => {
    expect(() =>
      normalizeDivisionFacets({ facets: validFacets().slice(0, 63) }, PROBLEM),
    ).toThrow('exactly 64 facets')
  })

  it('rejects a facet made too short by whitespace normalization', () => {
    const facets = validFacets()
    facets[0] = {
      ...facets[0],
      focus: `A${' '.repeat(20)}B`,
    }
    expect(() =>
      normalizeDivisionFacets({ facets }, PROBLEM),
    ).toThrow('outside its allowed length')
  })

  it('rejects duplicate IDs', () => {
    const facets = validFacets()
    facets[63] = { ...facets[63], id: 63 }
    expect(() =>
      normalizeDivisionFacets({ facets }, PROBLEM),
    ).toThrow('Facet IDs')
  })

  it.each(['title', 'focus'] as const)(
    'rejects normalized duplicate %ss',
    (field) => {
      const facets = validFacets()
      if (field === 'title') {
        facets[0] = { ...facets[0], title: 'Alpha-One' }
        facets[1] = { ...facets[1], title: 'alpha one' }
      } else {
        facets[0] = {
          ...facets[0],
          focus: 'Examine a normalized duplicate concrete focus.',
        }
        facets[1] = {
          ...facets[1],
          focus: 'examine a normalized duplicate concrete focus',
        }
      }
      expect(() =>
        normalizeDivisionFacets({ facets }, PROBLEM),
      ).toThrow(`Facet ${field}s must be unique`)
    },
  )

  it('rejects generic numbered facets through the quality gate', () => {
    const facets = validFacets().map((facet) => ({
      ...facet,
      title: `Facet ${facet.id} unique`,
    }))
    expect(() =>
      normalizeDivisionFacets({ facets }, PROBLEM),
    ).toThrow('Division quality check failed')
  })

  it('sorts a valid reverse-ordered facet set', () => {
    const result = normalizeDivisionFacets({
      facets: validFacets().reverse(),
    }, PROBLEM)
    expect(result[0]?.id).toBe(1)
    expect(result[63]?.id).toBe(64)
  })
})

describe('division quality diagnostic branches', () => {
  it('reports safe zero metrics for an empty division', () => {
    const assessment = assessDivisionQuality([])
    expect(assessment).toMatchObject({
      ok: false,
      issues: [{ code: 'high-overlap-facets' }],
      metrics: {
        facetCount: 0,
        genericNumberedTitleRatio: 0,
        idEchoRatio: 0,
        overlap: {
          highOverlapPairRatio: 0,
          strongestPair: null,
        },
      },
    })
  })

  it('skips undersized token sets and measures a dissimilar pair', () => {
    const facets: DivisionQualityFacet[] = [
      {
        id: 1,
        title: '',
        focus: '',
        question: '',
        keyword: '',
      },
      {
        id: 2,
        title: 'Budget runway',
        focus: 'Cash reserves determine the safe experimentation period',
        question: 'Which expense changes the available runway most',
        keyword: 'reserve horizon',
      },
    ]

    const skipped = assessDivisionQuality(facets)
    expect(skipped.metrics.overlap).toMatchObject({
      highOverlapPairCount: 0,
      strongestPair: null,
    })

    const measured = assessDivisionQuality(facets, {
      problem: 'budget evidence',
      thresholds: qualityThresholds({
        highOverlapMinimumTokens: 0,
        highOverlapSimilarity: 1,
      }),
    })
    expect(measured.metrics.overlap).toMatchObject({
      highOverlapPairCount: 0,
      strongestPair: expect.objectContaining({ similarity: 0 }),
    })
  })

  it('flags generic IDs, dominant templates, and widespread overlap', () => {
    const facets: DivisionQualityFacet[] = Array.from(
      { length: 6 },
      (_, index) => ({
        id: index + 1,
        title: `Facet ${index + 1}`,
        focus: 'Shared budget runway evidence constraint remains unchanged',
        question: 'Which shared budget runway evidence constraint changes first',
        keyword: 'shared budget runway',
      }),
    )
    const assessment = assessDivisionQuality(facets, {
      problem: 'Which budget evidence changes the runway?',
      thresholds: qualityThresholds({
        dominantTemplateMinimumCount: 2,
        dominantTemplateRatio: 0.5,
        genericNumberedTitleRatio: 0.25,
        idEchoRatio: 0.5,
        highOverlapSimilarity: 0.8,
        highOverlapMinimumTokens: 1,
        highOverlapNeighborRatio: 0.5,
        highOverlapMinimumPairsPerFacet: 0.25,
      }),
    })

    expect(assessment.ok).toBe(false)
    expect(assessment.issues.map((issue) => issue.code)).toEqual([
      'generic-numbered-facets',
      'dominant-text-template',
      'high-overlap-facets',
    ])
    expect(assessment.metrics.overlap).toMatchObject({
      highOverlapPairCount: 15,
      facetsWithHighOverlapNeighbor: 6,
      examplePairs: expect.any(Array),
    })
    expect(
      (assessment.metrics.overlap as { examplePairs: unknown[] }).examplePairs,
    ).toHaveLength(8)
  })

  it('records the strongest pair while rejecting no dissimilar facets', () => {
    const facets: DivisionQualityFacet[] = [
      {
        id: 7,
        title: 'Budget runway',
        focus: 'Cash reserves and recurring expenses shape available time',
        question: 'Which expense could be reduced without harming delivery',
        keyword: 'cash horizon',
      },
      {
        id: 8,
        title: 'Team confidence',
        focus: 'Staff trust and learning capacity shape adoption readiness',
        question: 'Which small trial would reveal willingness to adapt',
        keyword: 'trust signal',
      },
    ]
    const assessment = assessDivisionQuality(facets, {
      thresholds: qualityThresholds({ highOverlapMinimumTokens: 1 }),
    })

    expect(assessment.ok).toBe(true)
    expect(assessment.metrics.overlap).toMatchObject({
      highOverlapPairCount: 0,
      strongestPair: expect.any(Object),
    })
  })
})

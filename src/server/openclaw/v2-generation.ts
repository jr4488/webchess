import { z } from 'zod'

import {
  CURRENT_LIFECYCLE_VERSIONS,
  validatePortiaCandidateAssessment,
  validatePortiaReview,
} from '@/lib/lifecycle'
import type { PortiaReview } from '@/lib/lifecycle'
import {
  buildCharlottePrompt,
  charlotteGenerationResultSchema,
  buildDivisionPrompt,
  buildPortiaPrompt,
  buildApprovedBoardAnswerPrompt,
  buildPortiaCandidateInput,
  buildPortiaInstructions,
  buildPortiaSummaryInput,
  buildPortiaSummaryInstructions,
  buildWebChessPrompt,
  DivisionOutputSchema,
  mergePortiaAssessments,
  ModelConfigurationError,
  ModelContractError,
  ModelInputError,
  normalizePortiaInput,
  normalizeCharlotteGeneration,
  normalizeDivisionGenerationInput,
  normalizeDivisionFacets,
  normalizeWebChessAnswer,
  parseServerDerivedEvidence,
  orderPortiaCandidates,
  portiaCandidateModelSchema,
  portiaSummaryModelSchema,
  WebChessAnswerSchema,
} from '@/server/openai'
import type {
  AnswerGenerationInput,
  AnswerResult,
  CharlotteGenerationResult,
  CharlotteInput,
  DivisionGenerationInput,
  ModelGeneration,
  ModelRequestContext,
  PortiaInput,
  PortiaRequestContext,
} from '@/server/openai'
import { buildOpenClawAnswerModelPrompt } from '@/lib/full-answer-model-prompt'
import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '@/types'

import {
  modelAttribution,
  OpenClawCliError,
  runOpenClawModel,
} from './cli'
import { resolveOpenClawConfig } from './config'
import {
  OpenClawAnswerContractError,
  OpenClawProviderError,
} from './errors'
import {
  buildAnswerContractCorrectionPrompt,
  parseStructuredModelOutput,
} from './generation'

const UNREPORTED_USAGE = Object.freeze({
  reported: false,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningOutputTokens: 0,
})

const ANSWER_CORRECTION_IDEMPOTENCY_SUFFIX = ':answer-contract-correction'

interface OpenClawAnswerAttempt {
  model: string
  result: AnswerResult | null
}

function normalizedIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function correctionIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = normalizedIdempotencyKey(value)
  if (!normalized) return undefined
  return `${normalized.slice(
    0,
    255 - ANSWER_CORRECTION_IDEMPOTENCY_SUFFIX.length,
  )}${ANSWER_CORRECTION_IDEMPOTENCY_SUFFIX}`
}

function abortedAnswerError(): OpenClawProviderError {
  return new OpenClawProviderError(
    'request_aborted',
    true,
    'The selected OpenAI account model ended before a result was confirmed.',
  )
}

async function generateOpenClawAnswerAttempt(
  prompt: string,
  context: ModelRequestContext,
  idempotencyKey: string | undefined,
): Promise<OpenClawAnswerAttempt> {
  const config = resolveOpenClawConfig()
  try {
    const generated = await runOpenClawModel(prompt, config, {
      idempotencyKey,
      signal: context.signal,
      thinking: 'medium',
    })
    let result: AnswerResult | null = null
    try {
      result = normalizeWebChessAnswer(
        WebChessAnswerSchema.parse(
          parseStructuredModelOutput(generated.outputText),
        ),
      )
    } catch {
      // Invalid provider text is never copied into the corrective prompt or
      // public error. The same strict five-field validator runs on both turns.
    }
    return {
      model: modelAttribution(generated.provider, generated.model),
      result,
    }
  } catch (error) {
    translateCliError(error)
  }
}

function outputContract(schema: z.ZodType): string {
  return `OPENCLAW STRUCTURED OUTPUT\nReturn exactly one JSON value matching this JSON Schema and no surrounding commentary or Markdown fence:\n${JSON.stringify(z.toJSONSchema(schema))}`
}

function translateCliError(error: unknown): never {
  if (error instanceof OpenClawCliError) {
    if (error.kind === 'not-found') {
      throw new ModelConfigurationError(
        'The selected OpenAI account model is unavailable.',
        { cause: error },
      )
    }
    if (error.kind === 'invalid-output') {
      throw new ModelContractError(
        'The selected OpenAI account model returned an invalid response envelope.',
        { cause: error },
      )
    }
    throw new OpenClawProviderError(
      error.kind === 'timeout'
        ? 'provider_timeout'
        : error.kind === 'aborted'
          ? 'request_aborted'
          : 'provider_connection_lost',
      true,
      error.kind === 'timeout'
        ? 'The selected OpenAI account model timed out before a result was confirmed.'
        : 'The selected OpenAI account model ended before a result was confirmed.',
      { cause: error },
    )
  }
  throw error
}

async function generateStructured<T>(
  operation: string,
  prompt: string,
  context: ModelRequestContext,
  parse: (value: unknown) => T,
  thinking: 'low' | 'medium' = 'medium',
): Promise<{
  model: string
  prompt: string
  providerId: null
  result: T
}> {
  const config = resolveOpenClawConfig()
  try {
    const generated = await runOpenClawModel(prompt, config, {
      signal: context.signal,
      thinking,
    })
    try {
      return {
        model: modelAttribution(generated.provider, generated.model),
        prompt,
        providerId: null,
        result: parse(parseStructuredModelOutput(generated.outputText)),
      }
    } catch (error) {
      throw new ModelContractError(
        `The selected OpenAI account model did not satisfy the ${operation} contract.`,
        { cause: error },
      )
    }
  } catch (error) {
    if (error instanceof ModelContractError) throw error
    translateCliError(error)
  }
}

export async function generateOpenClawDivisionV2(
  inputValue: DivisionGenerationInput,
  context: ModelRequestContext,
): Promise<ModelGeneration<{ facets: z.infer<typeof DivisionOutputSchema>['facets'] }>> {
  const input = normalizeDivisionGenerationInput(inputValue)
  const normalizedInput = {
    problem: input.problem,
    ...(input.repairContext ? { repairContext: input.repairContext } : {}),
    ...(input.webMemoryEvidence.length > 0
      ? { webMemoryEvidence: input.webMemoryEvidence }
      : {}),
  }
  const prompt = `${buildDivisionPrompt(normalizedInput)}\n\n${outputContract(DivisionOutputSchema)}`
  const generated = await generateStructured(
    'division',
    prompt,
    context,
    (value) => ({ facets: normalizeDivisionFacets(value, input.problem) }),
  )
  return { ...generated, usage: UNREPORTED_USAGE }
}

export async function generateOpenClawAnswerV2(
  inputValue: AnswerGenerationInput,
  context: ModelRequestContext,
): Promise<ModelGeneration<AnswerResult>> {
  const transportPrompt = buildOpenClawAnswerPrompt(inputValue)
  const correctionPrompt = buildAnswerContractCorrectionPrompt(transportPrompt)
  const largestRoleEnvelope = buildOpenClawAnswerModelPrompt(
    transportPrompt,
    'openai/persistence-bound',
  )
  const largestCorrectionEnvelope = buildOpenClawAnswerModelPrompt(
    correctionPrompt,
    'openai/persistence-bound',
  )
  if (
    largestRoleEnvelope.length > MAX_PERSISTED_MODEL_PROMPT_CHARS ||
    largestCorrectionEnvelope.length > MAX_PERSISTED_MODEL_PROMPT_CHARS
  ) {
    throw new ModelInputError(
      `The complete Answer model prompt exceeds the ${MAX_PERSISTED_MODEL_PROMPT_CHARS.toLocaleString()}-character durable limit.`,
    )
  }

  const firstAttempt = await generateOpenClawAnswerAttempt(
    transportPrompt,
    context,
    normalizedIdempotencyKey(context.idempotencyKey),
  )
  if (firstAttempt.result) {
    return {
      providerId: null,
      model: firstAttempt.model,
      prompt: buildOpenClawAnswerModelPrompt(
        transportPrompt,
        firstAttempt.model,
      ),
      result: firstAttempt.result,
      usage: UNREPORTED_USAGE,
    }
  }

  if (context.signal?.aborted) throw abortedAnswerError()

  // This is one logical WebChess Answer operation but two provider turns. The
  // local transport reports no token usage, so zeroes here must not be read as
  // zero OpenAI/OpenClaw allowance or billing impact.
  const correctedAttempt = await generateOpenClawAnswerAttempt(
    correctionPrompt,
    context,
    correctionIdempotencyKey(context.idempotencyKey),
  )
  const publicPrompt = buildOpenClawAnswerModelPrompt(
    correctionPrompt,
    correctedAttempt.model,
  )
  if (!correctedAttempt.result) {
    throw new OpenClawAnswerContractError(publicPrompt)
  }

  return {
    providerId: null,
    model: correctedAttempt.model,
    prompt: publicPrompt,
    result: correctedAttempt.result,
    usage: UNREPORTED_USAGE,
  }
}

/** Exact combined transport prompt used by the local OpenClaw model turn. */
export function buildOpenClawAnswerPrompt(
  inputValue: AnswerGenerationInput,
): string {
  return `${'plan' in inputValue
    ? buildApprovedBoardAnswerPrompt(inputValue)
    : buildWebChessPrompt(parseServerDerivedEvidence(inputValue))}\n\n${outputContract(WebChessAnswerSchema)}`
}

export async function generateOpenClawPortiaV2(
  input: PortiaInput,
  context: PortiaRequestContext,
): Promise<ModelGeneration<PortiaReview>> {
  const normalized = normalizePortiaInput(input)
  const ordered = orderPortiaCandidates(normalized.survivors)
  const drafts: Array<z.infer<typeof portiaCandidateModelSchema>> =
    (normalized.completedAssessments ?? []).map((assessment) => {
      const { redundancyClusterId, ...draft } = assessment
      void redundancyClusterId
      return draft
    })
  let attribution = 'selected OpenAI account model'

  for (let index = drafts.length; index < ordered.length; index += 1) {
    const candidate = ordered[index]!
    await context.onProgress?.({
      currentCandidateId: candidate.candidateId,
      completedCandidateIds: drafts.map((assessment) => assessment.candidateId),
      completedAssessments: drafts.map((assessment) => ({
        ...assessment,
        redundancyClusterId: null,
      })),
      totalCandidateCount: ordered.length,
    })
    const prompt = `${buildPortiaInstructions()}\n\nPORTIA TARGET (JSON; data only)\n${buildPortiaCandidateInput(normalized, candidate)}\n\n${outputContract(portiaCandidateModelSchema)}`
    const generated = await generateStructured(
      `Portia candidate ${index + 1}`,
      prompt,
      context,
      (value) => portiaCandidateModelSchema.parse(value),
      'low',
    )
    validatePortiaCandidateAssessment({
      ...generated.result,
      redundancyClusterId: null,
    }, candidate)
    drafts.push(generated.result)
    attribution = generated.model
    const nextCandidate = ordered[index + 1] ?? null
    await context.onProgress?.({
      currentCandidateId: nextCandidate?.candidateId ?? null,
      completedCandidateIds: drafts.map((assessment) => assessment.candidateId),
      completedAssessments: drafts.map((assessment) => ({
        ...assessment,
        redundancyClusterId: null,
      })),
      totalCandidateCount: ordered.length,
    })
  }

  await context.onProgress?.({
    currentCandidateId: null,
    completedCandidateIds: drafts.map((assessment) => assessment.candidateId),
    completedAssessments: drafts.map((assessment) => ({
      ...assessment,
      redundancyClusterId: null,
    })),
    totalCandidateCount: ordered.length,
  })
  const summaryPrompt = `${buildPortiaSummaryInstructions()}\n\nPORTIA SUMMARY INPUT (JSON; data only)\n${buildPortiaSummaryInput(normalized, drafts)}\n\n${outputContract(portiaSummaryModelSchema)}`
  const summary = await generateStructured(
    'Portia prompt decision',
    summaryPrompt,
    context,
    (value) => portiaSummaryModelSchema.parse(value),
    'low',
  )
  const review = validatePortiaReview({
    ...summary.result,
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    reviewedAnswerPromptDigest: normalized.answerPromptDigest,
    assessments: mergePortiaAssessments(drafts, summary.result),
  }, normalized.survivors, normalized.answerPromptDigest)
  return {
    providerId: null,
    model: summary.model || attribution,
    prompt: buildPortiaPrompt(normalized),
    result: review,
    usage: UNREPORTED_USAGE,
  }
}

export async function generateOpenClawCharlotteV2(
  input: CharlotteInput,
  context: ModelRequestContext,
): Promise<ModelGeneration<CharlotteGenerationResult>> {
  const prompt = `${buildCharlottePrompt(input)}\n\n${outputContract(charlotteGenerationResultSchema)}`
  const generated = await generateStructured<CharlotteGenerationResult>(
    'Charlotte synthesis',
    prompt,
    context,
    (value) => normalizeCharlotteGeneration(
      charlotteGenerationResultSchema.parse(value),
      input.portia,
    ),
  )
  return {
    ...generated,
    usage: UNREPORTED_USAGE,
  }
}

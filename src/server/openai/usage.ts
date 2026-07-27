import type { NormalizedModelUsage } from './types'
import { ModelContractError } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredTokenCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ModelContractError(
      `OpenAI response usage field ${field} must be a non-negative integer.`,
    )
  }
  return Number(value)
}

function optionalTokenCount(value: unknown, field: string): number {
  return value === undefined || value === null
    ? 0
    : requiredTokenCount(value, field)
}

/**
 * Normalize current Responses API usage into the durable accounting contract.
 * Missing usage is distinguishable from a genuine zero-token response.
 */
export function normalizeModelUsage(value: unknown): NormalizedModelUsage {
  if (value === undefined || value === null) {
    return {
      reported: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    }
  }
  if (!isRecord(value)) {
    throw new ModelContractError('OpenAI response usage must be an object.')
  }

  const inputDetails = value.input_tokens_details
  const outputDetails = value.output_tokens_details
  if (inputDetails !== undefined && inputDetails !== null && !isRecord(inputDetails)) {
    throw new ModelContractError(
      'OpenAI response input token details must be an object.',
    )
  }
  if (outputDetails !== undefined && outputDetails !== null && !isRecord(outputDetails)) {
    throw new ModelContractError(
      'OpenAI response output token details must be an object.',
    )
  }

  return {
    reported: true,
    inputTokens: requiredTokenCount(value.input_tokens, 'input_tokens'),
    outputTokens: requiredTokenCount(value.output_tokens, 'output_tokens'),
    totalTokens: requiredTokenCount(value.total_tokens, 'total_tokens'),
    cachedInputTokens: optionalTokenCount(
      inputDetails?.cached_tokens,
      'input_tokens_details.cached_tokens',
    ),
    cacheWriteInputTokens: optionalTokenCount(
      inputDetails?.cache_write_tokens,
      'input_tokens_details.cache_write_tokens',
    ),
    reasoningOutputTokens: optionalTokenCount(
      outputDetails?.reasoning_tokens,
      'output_tokens_details.reasoning_tokens',
    ),
  }
}

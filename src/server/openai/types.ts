import type OpenAI from 'openai'

export const OPENAI_MODEL = 'gpt-5.6-sol' as const
export const OPENAI_PROVIDER = 'openai' as const
export const OPENAI_REASONING_EFFORT = 'medium' as const
export const DIVISION_PROMPT_VERSION = 'webchess-division-v2' as const
export const ANSWER_PROMPT_VERSION = 'webchess-answer-v2' as const
export const DEFAULT_OPENAI_TIMEOUT_MS = 120_000
export const MAX_OPENAI_TIMEOUT_MS = 60 * 60 * 1_000

export type OpenAIClientLike = Pick<OpenAI, 'responses'>

export interface ModelRequestContext {
  /**
   * The authenticated, server-established user ID. It is never sent verbatim
   * to OpenAI; `safetyHmacSecret` turns it into a stable opaque identifier.
   */
  userId: string
  /**
   * A server-only secret dedicated to safety-identifier HMACs.
   */
  safetyHmacSecret: string | Uint8Array
  /**
   * The Vercel server secret. Callers may instead inject a client in tests.
   */
  apiKey?: string
  client?: OpenAIClientLike
  signal?: AbortSignal
  timeoutMs?: number
  idempotencyKey?: string
}

export interface NormalizedModelUsage {
  reported: boolean
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  reasoningOutputTokens: number
}

export interface ModelGeneration<Result> {
  providerId: string
  model: string
  prompt: string
  result: Result
  usage: NormalizedModelUsage
}

export class ModelConfigurationError extends Error {
  override name = 'ModelConfigurationError'
}

export class ModelInputError extends Error {
  override name = 'ModelInputError'
}

export class ModelContractError extends Error {
  override name = 'ModelContractError'
}

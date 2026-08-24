import type OpenAI from 'openai'

import type { CoverageTag, WebMemoryEvidence } from '../../lib/lifecycle'

export const OPENAI_MODEL = 'gpt-5.6-sol' as const
export const OPENAI_PROVIDER = 'openai' as const
export const OPENAI_REASONING_EFFORT = 'medium' as const
export const DIVISION_PROMPT_VERSION = 'webchess-division-v3' as const
export const ANSWER_PROMPT_VERSION = 'webchess-answer-v3' as const
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
  /** Injected only by provider-contract tests. Production uses OpenClaw generators. */
  client?: OpenAIClientLike
  signal?: AbortSignal
  timeoutMs?: number
  idempotencyKey?: string
}

/**
 * Server-derived feedback supplied only when Retry replaces a deficient
 * semantic field. The original player problem remains authoritative; these
 * bounded findings tell the generator what the previous field failed to
 * expose without turning model-authored text into trusted instructions.
 */
export interface DivisionRepairContext {
  readonly priorFieldGeneration: number
  readonly gateMissingRequirements: readonly string[]
  readonly missingCoverage: readonly CoverageTag[]
  readonly fieldRepairReasons: readonly string[]
}

export interface DivisionRepairRequest {
  readonly problem: string
  readonly repairContext: DivisionRepairContext
}

export interface DivisionGenerationRequest {
  readonly problem: string
  readonly repairContext?: DivisionRepairContext
  /** Player-selected, provenance-bound prior observations; never inferred. */
  readonly webMemoryEvidence?: readonly WebMemoryEvidence[]
}

/** Plain text preserves the no-memory initial Division API. */
export type DivisionGenerationInput = string | DivisionGenerationRequest

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
  providerId: string | null
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

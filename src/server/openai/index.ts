import 'server-only'

export {
  ANSWER_MAX_OUTPUT_TOKENS,
  buildWebChessInput,
  buildWebChessInstructions,
  buildWebChessPrompt,
  countAnswerWords,
  FINAL_ANSWER_MAX_WORDS,
  FINAL_ANSWER_MIN_WORDS,
  generateAnswer,
  normalizeWebChessAnswer,
  parseServerDerivedEvidence,
  ServerDerivedEvidenceSchema,
  WebChessAnswerSchema,
} from './answer'
export type {
  AnswerResult,
  ServerDerivedEvidence,
  WebChessAnswerSections,
} from './answer'

export {
  buildDivisionInput,
  buildDivisionInstructions,
  buildDivisionPrompt,
  DIVISION_DIMENSIONS,
  DIVISION_MAX_OUTPUT_TOKENS,
  DIVISION_MOVEMENTS,
  DivisionFacetSchema,
  DivisionOutputSchema,
  FACET_COUNT,
  generateDivision,
  normalizeDivisionFacets,
  normalizeDivisionProblem,
} from './division'
export type { DivisionFacet, DivisionResult } from './division'

export { createSafetyIdentifier } from './safety'
export {
  MODEL_RESPONSE_FAILURE_STATUSES,
  ModelResponseError,
} from './response'
export type {
  ModelResponseFailureStatus,
  SafeModelResponseFailure,
} from './response'
export {
  ANSWER_PROMPT_VERSION,
  DEFAULT_OPENAI_TIMEOUT_MS,
  DIVISION_PROMPT_VERSION,
  MAX_OPENAI_TIMEOUT_MS,
  ModelConfigurationError,
  ModelContractError,
  ModelInputError,
  OPENAI_MODEL,
  OPENAI_PROVIDER,
  OPENAI_REASONING_EFFORT,
} from './types'
export type {
  ModelGeneration,
  ModelRequestContext,
  NormalizedModelUsage,
  OpenAIClientLike,
} from './types'
export { normalizeModelUsage } from './usage'

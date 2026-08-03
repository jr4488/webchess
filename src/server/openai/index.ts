import 'server-only'

export {
  ANSWER_MAX_OUTPUT_TOKENS,
  buildApprovedBoardAnswerPrompt,
  buildPlayerVisibleAnswerPrompt,
  buildBoardAnswerPrompt,
  buildBoardAnswerPromptPlan,
  buildBoardAnswerPromptPackage,
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
  AnswerGenerationInput,
  AnswerResult,
  ApprovedBoardAnswerInput,
  BoardAnswerPromptPlan,
  BoardAnswerPromptPackage,
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
  normalizeDivisionGenerationInput,
  normalizeDivisionFacets,
  normalizeDivisionProblem,
  normalizeDivisionRepairContext,
} from './division'
export type { DivisionFacet, DivisionResult } from './division'

export {
  buildPortiaInput,
  buildPortiaInstructions,
  buildPortiaPrompt,
  buildPortiaCandidateInput,
  buildPortiaSummaryInput,
  buildPortiaSummaryInstructions,
  generatePortiaReview,
  mergePortiaAssessments,
  normalizePortiaInput,
  orderPortiaCandidates,
  portiaCandidateModelSchema,
  portiaSummaryModelSchema,
  PORTIA_MAX_OUTPUT_TOKENS,
} from './portia'
export type { PortiaInput, PortiaProgress, PortiaRequestContext } from './portia'

export {
  buildCharlotteInput,
  buildCharlotteInstructions,
  buildCharlottePrompt,
  charlotteGenerationResultSchema,
  CHARLOTTE_MAX_RENDERED_CHARACTERS,
  CHARLOTTE_MAX_OUTPUT_TOKENS,
  CHARLOTTE_MAX_SUPPORTING_CANDIDATES,
  countCharlotteWords,
  generateCharlotteSynthesis,
  normalizeCharlotteGeneration,
  renderCharlotteResult,
} from './charlotte'
export type {
  CharlotteGenerationResult,
  CharlotteInput,
} from './charlotte'

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
  DivisionGenerationInput,
  DivisionRepairContext,
  DivisionRepairRequest,
  ModelGeneration,
  ModelRequestContext,
  NormalizedModelUsage,
  OpenAIClientLike,
} from './types'
export { normalizeModelUsage } from './usage'

import 'server-only'

export {
  GameRepositoryError,
  isGameRepositoryError,
} from './errors'
export type { GameRepositoryErrorCode } from './errors'

export {
  DurableGameRepository,
  computeDivisionDigest,
  normalizeProblem,
} from './repository'

export type {
  AbandonGameInput,
  AppendMoveInput,
  ChangeAnswerStatusInput,
  CreateDivisionInput,
  CreateDivisionResult,
  DurableDivision,
  DurableGameSnapshot,
  DurableGameStatus,
  FinishDivisionInput,
  MoveMutationResult,
  StartGameInput,
  StoreAnswerInput,
  TerminalGameSnapshot,
} from './types'

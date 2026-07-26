export type Side = 'white' | 'black'

export type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn'

export type Stage = 'question' | 'mapping' | 'playing' | 'reading'

export type GameEndReason = 'king-captured' | 'no-moves' | 'no-progress' | 'move-limit'

export type AnswerStatus = 'idle' | 'loading' | 'success' | 'error'

export type DivisionStatus = 'idle' | 'loading' | 'success' | 'error'

export type DivisionPhase =
  | 'analyzing'
  | 'facets-received'
  | 'facets-permuted'
  | 'hexagrams-permuted'
  | 'paired'
  | 'casting'

export type ModelActivityOperation = 'division' | 'answer'

export type ModelActivityPhase =
  | 'request-accepted'
  | 'preparing-input'
  | 'awaiting-model'
  | 'thinking'
  | 'writing-rationale'
  | 'drafting'
  | 'validating-output'
  | 'complete'

export interface ModelActivityHistoryEntry {
  phase: ModelActivityPhase
  at: number
}

export interface ModelActivityRationaleNote {
  text: string
  at: number
}

/**
 * Where displayed reasoning text came from.
 *
 * `summary` is a provider-authored summary written for end users. `raw` is a
 * local model's own thinking, which only ever leaves a model running on this
 * machine. The UI must keep these visibly distinct.
 */
export type ReasoningSource = 'summary' | 'raw'

export interface ModelActivityReasoning {
  source: ReasoningSource
  text: string
  updatedAt: number
}

export interface ModelActivityState {
  operation: ModelActivityOperation
  status: 'active' | 'complete' | 'error'
  phase: ModelActivityPhase
  startedAt: number
  lastHeartbeatAt: number
  lastProviderActivityAt?: number
  history: ModelActivityHistoryEntry[]
  rationaleNotes: ModelActivityRationaleNote[]
  reasoning: ModelActivityReasoning | null
}

export interface CellCoord {
  ring: number
  sector: number
}

export interface LastMove {
  from: CellCoord
  to: CellCoord
}

export interface ProblemPart {
  id: number
  title: string
  focus: string
  hexagram: number
  hexagramName: string
  theme: string
  dimension: string
  movement: string
  prompt: string
  keyword: string
}

export interface ProblemFacet {
  id: number
  title: string
  focus: string
  question: string
  keyword: string
}

export interface DivisionAnalysis {
  facets: ProblemFacet[]
  seed: string | number
  model: string
  prompt: string
}

export interface Piece {
  id: string
  side: Side
  kind: PieceKind
  position: CellCoord
  moved: boolean
}

export interface AutoMove {
  pieceId: string
  from: CellCoord
  to: CellCoord
  score: number
  captured?: Piece
}

export interface CaptureRecord {
  id: string
  turn: number
  attacker: Piece
  captured: Piece
  cell: CellCoord
  part: ProblemPart
  resonance: number
  narration: string
}

export interface GameOutcome {
  winner: Side | null
  reason: GameEndReason
  completedTurn: number
  terminalCapture?: CaptureRecord
}

export interface GeneratedAnswer {
  answer: string
  model: string
  prompt: string
}

export interface ReadingSection {
  label: string
  title: string
  body: string
  partIds: number[]
  captureId?: string
}

export interface FinalReading {
  title: string
  summary: string
  sections: ReadingSection[]
  closing: string
}

export interface MoveResult {
  pieces: Piece[]
  capture?: CaptureRecord
  promoted?: Piece
}

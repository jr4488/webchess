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

export interface ModelActivityState {
  operation: ModelActivityOperation
  status: 'active' | 'error'
  startedAt: number
  lastUpdatedAt: number
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

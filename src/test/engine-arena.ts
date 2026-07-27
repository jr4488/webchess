import type { AutoMove, CellCoord, Piece, Side } from '../types'
import {
  applyMove,
  coordKey,
  createInitialPieces,
  getLegalMoves,
  getPieceAt,
  hasLegalMove,
} from '../lib/game'
import { hashString } from '../lib/problem'
import { makeProblemParts } from './fixtures'
import { playMatch } from './play-match'
import type { MatchResult, MoveChooser } from './play-match'

export interface OpeningAction {
  side: Side
  pieceId: string | null
  from?: CellCoord
  to?: CellCoord
}

export interface ArenaOpening {
  id: string
  pieces: readonly Piece[]
  sideToMove: Side
  completedPlies: number
  quietPlies: number
  actions: readonly OpeningAction[]
  signature: string
}

interface OpeningCandidate {
  piece: Piece
  to: CellCoord
  captured: Piece | undefined
  key: string
}

/**
 * Creates a deterministic, replayable opening by applying only moves accepted
 * by the canonical game rules. Direct king captures are excluded so every
 * returned opening remains playable by both arena entrants.
 */
export function generateLegalOpening(
  seed: string,
  openingPlies = 4,
): ArenaOpening {
  if (!Number.isInteger(openingPlies) || openingPlies < 0) {
    throw new RangeError(`Opening length must be a non-negative integer; received ${openingPlies}.`)
  }

  const parts = makeProblemParts(`arena-opening/${seed}`)
  let pieces: readonly Piece[] = createInitialPieces()
  let sideToMove: Side = 'white'
  let completedPlies = 0
  let quietPlies = 0
  const actions: OpeningAction[] = []

  while (completedPlies < openingPlies) {
    const candidates = legalNonTerminalCandidates(pieces, sideToMove)

    if (candidates.length === 0) {
      const opponent: Side = sideToMove === 'white' ? 'black' : 'white'
      if (hasLegalMove(pieces, sideToMove) || !hasLegalMove(pieces, opponent)) break

      actions.push({ side: sideToMove, pieceId: null })
      completedPlies += 1
      quietPlies += 1
      sideToMove = opponent
      continue
    }

    const chooser = hashString(`${seed}/opening/${completedPlies + 1}`) % candidates.length
    const selected = candidates[chooser]!
    const ply = completedPlies + 1
    const result = applyMove(pieces, selected.piece.id, selected.to, parts, ply)

    actions.push({
      side: sideToMove,
      pieceId: selected.piece.id,
      from: { ...selected.piece.position },
      to: { ...selected.to },
    })
    pieces = result.pieces
    completedPlies = ply
    quietPlies = result.capture ? 0 : quietPlies + 1
    sideToMove = sideToMove === 'white' ? 'black' : 'white'
  }

  const signature = actions
    .map((action) =>
      action.pieceId === null
        ? `${action.side}:pass`
        : `${action.side}:${action.pieceId}>${coordKey(action.to!)}`,
    )
    .join(' ')

  return {
    id: `${seed}/${openingPlies}`,
    pieces,
    sideToMove,
    completedPlies,
    quietPlies,
    actions,
    signature,
  }
}

function legalNonTerminalCandidates(
  pieces: readonly Piece[],
  side: Side,
): OpeningCandidate[] {
  const candidates = pieces
    .filter((piece) => piece.side === side)
    .flatMap((piece) =>
      getLegalMoves(piece, pieces).map((to) => {
        const captured = getPieceAt(pieces, to)
        return {
          piece,
          to,
          captured,
          key: `${piece.id}>${coordKey(to)}`,
        }
      }),
    )
    .filter((candidate) => candidate.captured?.kind !== 'king')

  candidates.sort((left, right) => left.key.localeCompare(right.key))
  return candidates
}

export interface ArenaLeg {
  openingId: string
  candidateSide: Side
  match: MatchResult
}

export interface ArenaWdl {
  wins: number
  draws: number
  losses: number
}

export interface PairedArenaResult {
  candidateId: string
  baselineId: string
  wdl: ArenaWdl
  points: number
  legs: readonly ArenaLeg[]
}

/**
 * Plays each opening twice with colors swapped. WDL is always from the
 * candidate's perspective, making a result such as 3-2-1 unambiguous.
 */
export function runPairedArena(options: {
  candidateId: string
  candidate: MoveChooser
  baselineId: string
  baseline: MoveChooser
  openings: readonly ArenaOpening[]
  maxPlies?: number
}): PairedArenaResult {
  const legs: ArenaLeg[] = []
  const wdl: ArenaWdl = { wins: 0, draws: 0, losses: 0 }

  for (const opening of options.openings) {
    for (const candidateSide of ['white', 'black'] as const) {
      const match = playMatch({
        white: candidateSide === 'white' ? options.candidate : options.baseline,
        black: candidateSide === 'black' ? options.candidate : options.baseline,
        // Both legs receive the same per-ply seeds. Only which policy controls
        // each color changes, so tie-breaking noise is not mistaken for color.
        seed: `${opening.id}/pair`,
        maxPlies: options.maxPlies,
        startingPieces: opening.pieces,
        startingSide: opening.sideToMove,
        startingCompletedPlies: opening.completedPlies,
        startingQuietPlies: opening.quietPlies,
      })

      legs.push({ openingId: opening.id, candidateSide, match })
      if (match.outcome.winner === null) wdl.draws += 1
      else if (match.outcome.winner === candidateSide) wdl.wins += 1
      else wdl.losses += 1
    }
  }

  return {
    candidateId: options.candidateId,
    baselineId: options.baselineId,
    wdl,
    points: wdl.wins + wdl.draws * 0.5,
    legs,
  }
}

export function formatArenaResult(result: PairedArenaResult): string {
  const total = result.wdl.wins + result.wdl.draws + result.wdl.losses
  const header =
    `${result.candidateId} vs ${result.baselineId}: ` +
    `W-D-L ${result.wdl.wins}-${result.wdl.draws}-${result.wdl.losses}, ` +
    `${result.points}/${total} points`
  const legs = result.legs.map(({ openingId, candidateSide, match }) => {
    const winner = match.outcome.winner ?? 'draw'
    return (
      `${openingId} as ${candidateSide}: ${winner}, ${match.outcome.reason}, ` +
      `${match.plies} plies, material ${match.material[candidateSide]}-` +
      `${match.material[candidateSide === 'white' ? 'black' : 'white']}`
    )
  })

  return [header, ...legs].join('\n')
}

/** Useful for tiny harness tests that need a legal chooser without a search. */
export const chooseFirstLegalMove: MoveChooser = (
  pieces: readonly Piece[],
  side: Side,
): AutoMove | null => {
  const candidate = legalNonTerminalCandidates(pieces, side)[0]
  if (!candidate) return null

  return {
    pieceId: candidate.piece.id,
    from: { ...candidate.piece.position },
    to: { ...candidate.to },
    score: 0,
    ...(candidate.captured ? { captured: candidate.captured } : {}),
  }
}

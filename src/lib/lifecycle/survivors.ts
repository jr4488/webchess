import { createHash } from 'node:crypto'

import type { GameEvent, ReplayState } from '../game-contract'
import { replayGameEvents } from '../game-replay'
import { getLegalMoves } from '../game'
import { PIECE_METAPHORS } from '../reading'
import type { ProblemPart } from '../../types'
import type { SurvivorCandidate } from './contracts'

const SIDE_POLARITIES = {
  white: 'outside-in evidence',
  black: 'inside-out intent',
} as const

export interface SurvivorSource {
  readonly gameId: string
  readonly attemptId: string
  readonly divisionDigest: string
  readonly rulesVersion: string
  readonly engineVersion: string
  readonly castVersion: string
  readonly eventVersion: number
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function attacksByPly(
  events: readonly GameEvent[],
  parts: readonly ProblemPart[],
): ReadonlyMap<string, readonly number[]> {
  const attacked = new Map<string, Set<number>>()

  for (let index = 0; index < events.length; index += 1) {
    const state = replayGameEvents(events.slice(0, index), parts)
    const ply = index + 1
    for (const attacker of state.pieces) {
      const destinations = getLegalMoves(attacker, state.pieces)
      for (const target of state.pieces) {
        if (target.side === attacker.side) continue
        if (
          destinations.some(
            (destination) =>
              destination.ring === target.position.ring &&
              destination.sector === target.position.sector,
          )
        ) {
          const targetPlies = attacked.get(target.id) ?? new Set<number>()
          targetPlies.add(ply)
          attacked.set(target.id, targetPlies)
        }
      }
    }
  }

  return new Map(
    [...attacked.entries()].map(([pieceId, plies]) => [
      pieceId,
      [...plies].sort((left, right) => left - right),
    ]),
  )
}

export function deriveSurvivorCandidates(
  replay: ReplayState,
  parts: readonly ProblemPart[],
  source: SurvivorSource,
): SurvivorCandidate[] {
  if (!replay.outcome) {
    throw new Error('Terminal survivor extraction requires a completed replay.')
  }
  if (parts.length !== 64) {
    throw new Error('Terminal survivor extraction requires exactly 64 board parts.')
  }

  const attacked = attacksByPly(replay.events, parts)
  return [...replay.pieces]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((piece) => {
      const routeEvents = replay.events.filter(
        (event): event is Extract<GameEvent, { type: 'move' }> =>
          event.type === 'move' && event.pieceId === piece.id,
      )
      const originalPieceKind = piece.id.split('-')[1]
      if (
        originalPieceKind !== 'king' &&
        originalPieceKind !== 'queen' &&
        originalPieceKind !== 'rook' &&
        originalPieceKind !== 'bishop' &&
        originalPieceKind !== 'knight' &&
        originalPieceKind !== 'pawn'
      ) {
        throw new Error(`Survivor ${piece.id} has an unknown canonical piece kind.`)
      }
      const part = parts[piece.position.ring * 8 + piece.position.sector]
      if (!part) {
        throw new Error(`Survivor ${piece.id} occupies an unmapped coordinate.`)
      }
      const candidateId = `${source.attemptId}:${piece.id}`
      const sourceDigest = digest({
        candidateId,
        gameId: source.gameId,
        divisionDigest: source.divisionDigest,
        rulesVersion: source.rulesVersion,
        engineVersion: source.engineVersion,
        castVersion: source.castVersion,
        eventVersion: source.eventVersion,
        finalCoordinate: piece.position,
        part,
        routeEvents,
        outcome: replay.outcome,
      })

      return {
        candidateId,
        pieceId: piece.id,
        side: piece.side,
        pieceKind: piece.kind,
        originalPieceKind,
        pieceRole: PIECE_METAPHORS[piece.kind].role,
        sidePolarity: SIDE_POLARITIES[piece.side],
        finalCoordinate: { ...piece.position },
        facet: { ...part },
        route: routeEvents.map((event) => ({
          ply: event.ply,
          from: { ...event.from },
          to: { ...event.to },
          capturedPieceId: event.capturedPieceId ?? null,
          promotedTo: event.promotedTo ?? null,
        })),
        capturesMade: routeEvents.flatMap((event) =>
          event.capturedPieceId ? [event.capturedPieceId] : [],
        ),
        attackedPlies: attacked.get(piece.id) ?? [],
        moveCount: routeEvents.length,
        promoted: originalPieceKind === 'pawn' && piece.kind === 'queen',
        terminalGameId: source.gameId,
        attemptId: source.attemptId,
        sourceDigest,
      }
    })
}

export function terminalFingerprint(
  candidates: readonly SurvivorCandidate[],
): string {
  return digest(
    [...candidates]
      .map((candidate) => ({
        pieceId: candidate.pieceId,
        side: candidate.side,
        pieceKind: candidate.pieceKind,
        originalPieceKind: candidate.originalPieceKind,
        finalCoordinate: candidate.finalCoordinate,
        facet: candidate.facet,
        route: candidate.route,
        capturesMade: candidate.capturesMade,
        attackedPlies: candidate.attackedPlies,
        moveCount: candidate.moveCount,
        promoted: candidate.promoted,
      }))
      .sort((left, right) => left.pieceId.localeCompare(right.pieceId)),
  )
}

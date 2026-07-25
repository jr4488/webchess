import type { CaptureRecord, GameOutcome, GeneratedAnswer } from '../types'
import { SessionRequiredError } from './session'

interface ErrorPayload {
  error?: string
  message?: string
  prompt?: string
}

export function buildAnswerPayload(
  problem: string,
  outcome: GameOutcome,
  captures: readonly CaptureRecord[],
) {
  return {
    problem,
    turnCount: outcome.completedTurn,
    outcome: {
      winner: outcome.winner,
      reason: outcome.reason,
      completedTurn: outcome.completedTurn,
    },
    captures: captures.map((capture) => ({
      turn: capture.turn,
      resonance: capture.resonance,
      cell: capture.cell,
      attacker: {
        side: capture.attacker.side,
        kind: capture.attacker.kind,
      },
      captured: {
        side: capture.captured.side,
        kind: capture.captured.kind,
      },
      part: {
        id: capture.part.id,
        title: capture.part.title,
        focus: capture.part.focus,
        hexagram: capture.part.hexagram,
        hexagramName: capture.part.hexagramName,
        theme: capture.part.theme,
        dimension: capture.part.dimension,
        movement: capture.part.movement,
        prompt: capture.part.prompt,
        keyword: capture.part.keyword,
      },
    })),
  }
}

export async function requestWebChessAnswer(
  problem: string,
  outcome: GameOutcome,
  captures: readonly CaptureRecord[],
  signal?: AbortSignal,
  csrfToken?: string,
): Promise<GeneratedAnswer> {
  const response = await fetch('/api/answer', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-WebChess-CSRF': csrfToken } : {}),
    },
    body: JSON.stringify(buildAnswerPayload(problem, outcome, captures)),
    signal,
  })

  const payload = await response.json().catch(() => ({})) as Partial<GeneratedAnswer> & ErrorPayload
  if (!response.ok) {
    const message =
      payload.error ?? payload.message ?? 'The answer service did not respond. Please try again.'
    const failure = (
      response.status === 401 ? new SessionRequiredError(message) : new Error(message)
    ) as Error & { prompt?: string }
    failure.prompt = payload.prompt
    throw failure
  }

  if (
    typeof payload.answer !== 'string' ||
    typeof payload.model !== 'string' ||
    typeof payload.prompt !== 'string'
  ) {
    throw new Error('The answer service returned an incomplete response. Please try again.')
  }

  return {
    answer: payload.answer,
    model: payload.model,
    prompt: payload.prompt,
  }
}

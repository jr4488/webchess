import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CaptureRecord, GameOutcome } from '../types'
import { makeProblemParts } from '../test/fixtures'
import { buildAnswerPayload, requestWebChessAnswer } from './answer'

const outcome: GameOutcome = {
  winner: 'white',
  reason: 'king-captured',
  completedTurn: 31,
}

const part = makeProblemParts('decision')[0]
const capture: CaptureRecord = {
  id: 'capture-31',
  turn: 31,
  attacker: { id: 'white-queen', side: 'white', kind: 'queen', position: { ring: 1, sector: 4 }, moved: true },
  captured: { id: 'black-king', side: 'black', kind: 'king', position: { ring: 1, sector: 4 }, moved: true },
  cell: { ring: 1, sector: 4 },
  part,
  resonance: 91,
  narration: 'Internal narration stays on the client.',
}

describe('answer request', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends a bounded, structured version of the completed game', () => {
    const payload = buildAnswerPayload('How should this decision move forward?', outcome, [capture])

    expect(payload).toMatchObject({
      turnCount: 31,
      outcome: { winner: 'white', reason: 'king-captured' },
      captures: [{
        attacker: { side: 'white', kind: 'queen' },
        captured: { side: 'black', kind: 'king' },
        part: {
          title: part.title,
          focus: part.focus,
          hexagram: part.hexagram,
          keyword: part.keyword,
        },
      }],
    })
    expect(JSON.stringify(payload)).not.toContain('Internal narration')
    expect(JSON.stringify(payload)).not.toContain('white-queen')
  })

  it('returns the answer, model, and canonical prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answer: 'Take the reversible step first.',
      model: 'gpt-5.6-sol',
      prompt: 'A canonical prompt.',
    }), { status: 200 })))

    await expect(requestWebChessAnswer(
      'How should this decision move forward?',
      outcome,
      [capture],
      undefined,
      'csrf-token',
    ))
      .resolves.toEqual({
        answer: 'Take the reversible step first.',
        model: 'gpt-5.6-sol',
        prompt: 'A canonical prompt.',
      })
    expect(fetch).toHaveBeenCalledWith('/api/answer', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-WebChess-CSRF': 'csrf-token' }),
    }))
  })

  it('preserves the canonical prompt when the server reports an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'API key missing.',
      prompt: 'A prompt waiting to be sent.',
    }), { status: 503 })))

    await expect(requestWebChessAnswer('How should this decision move forward?', outcome, [capture]))
      .rejects.toMatchObject({
        message: 'API key missing.',
        prompt: 'A prompt waiting to be sent.',
      })
  })

  it('surfaces an expired session distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Your access session has expired.',
    }), { status: 401 })))

    await expect(requestWebChessAnswer(
      'How should this decision move forward?',
      outcome,
      [capture],
    )).rejects.toMatchObject({
      name: 'SessionRequiredError',
      status: 401,
      message: 'Your access session has expired.',
    })
  })
})

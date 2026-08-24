import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenClawApp } from './App'
import { WebChessApiError } from './lib/webchess-api'

const localApi = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(() => '018f47b2-4b0c-7b9e-8f24-123456789000'),
  divideProblem: vi.fn(),
  getCurrentGame: vi.fn(),
  recoverDivisionIntent: vi.fn(),
}))

vi.mock('./lib/webchess-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/webchess-api')>()
  return {
    ...actual,
    createIdempotencyKey: localApi.createIdempotencyKey,
    divideProblem: localApi.divideProblem,
    getCurrentGame: localApi.getCurrentGame,
    recoverDivisionIntent: localApi.recoverDivisionIntent,
  }
})

describe('local OpenClaw WebChess experience', () => {
  beforeEach(() => {
    for (const mock of Object.values(localApi)) mock.mockReset()
    localApi.createIdempotencyKey.mockReturnValue(
      '018f47b2-4b0c-7b9e-8f24-123456789000',
    )
    localApi.getCurrentGame.mockResolvedValue(null)
  })

  it('restores durable local state and explains the OpenClaw v2 boundary', async () => {
    render(<OpenClawApp />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /bring a problem.*play toward clarity/i }),
      ).toBeInTheDocument()
    })
    expect(localApi.getCurrentGame).toHaveBeenCalledOnce()
    expect(screen.getByText(/seven-stage visible WebChess 2.2 lifecycle stay in a dedicated PostgreSQL database/i)).toBeInTheDocument()
    expect(screen.getByText(/Portia validates the board-derived answer prompt/i)).toBeInTheDocument()
    expect(screen.getByText(/internal Gate checks sufficiency/i)).toBeInTheDocument()
    expect(screen.getByText(/Answer generation runs only after permission/i)).toBeInTheDocument()
    expect(screen.getByText(/Charlotte reviews and qualifies it/i)).toBeInTheDocument()
    expect(screen.getByText(/sends model turns through your local OpenClaw/i)).toBeInTheDocument()
    expect(screen.getByText(/credentials never enter the browser or a WebChess-operated service/i)).toBeInTheDocument()
    expect(screen.getByText(/runs locally through your OpenClaw configuration/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/WebChess version 2.2/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /account and usage/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /webchess home/i })).toHaveAttribute(
      'href',
      '/openclaw',
    )
    expect(screen.getByRole('link', { name: /local webchess game/i })).toHaveAttribute(
      'href',
      '/openclaw',
    )
  })

  it('treats a missing local recovery as definitive after a lost division response', async () => {
    localApi.divideProblem.mockRejectedValueOnce(
      new WebChessApiError('The local response was lost.', {
        kind: 'transport',
      }),
    )
    localApi.recoverDivisionIntent.mockRejectedValueOnce(
      new WebChessApiError('The local game was not saved.', {
        kind: 'not-found',
        status: 404,
      }),
    )

    render(<OpenClawApp />)
    await screen.findByRole('heading', {
      name: /bring a problem.*play toward clarity/i,
    })
    fireEvent.change(
      screen.getByLabelText(/what are you trying to understand/i),
      {
        target: {
          value: 'How should I test this local idea without overcommitting?',
        },
      },
    )
    fireEvent.click(screen.getByRole('radio', {
      name: /do not use external research/i,
    }))
    fireEvent.click(screen.getByRole('button', { name: /divide the problem/i }))

    expect(
      await screen.findByText(/the local response was lost/i),
    ).toBeInTheDocument()
    const newQuestion = screen.getByRole('button', { name: /new question/i })
    expect(newQuestion).toBeEnabled()
    fireEvent.click(newQuestion)
    expect(
      await screen.findByLabelText(/what are you trying to understand/i),
    ).toBeInTheDocument()
  })
})

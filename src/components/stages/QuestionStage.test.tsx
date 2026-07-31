import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QuestionStage } from './QuestionStage'

const API_PROVIDER = {
  id: 'openai-api',
  label: 'OpenAI API',
  billing: 'platform-api',
  dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  model: 'gpt-5.6-sol',
  webSearch: 'disabled',
} as const

const OPENCLAW_PROVIDER = {
  kind: 'openclaw',
  label: 'your local OpenClaw',
  dataControlsLabel: 'How OpenClaw runs model requests',
  dataControlsUrl: 'https://docs.openclaw.ai/cli/infer',
  model: 'your configured default model',
} as const

describe('QuestionStage', () => {
  it('uses native bounded input without silently truncating the question', () => {
    const setProblem = vi.fn()
    render(
      <QuestionStage
        problem=""
        provider={API_PROVIDER}
        setProblem={setProblem}
        onSubmit={vi.fn()}
      />,
    )
    const input = screen.getByLabelText(/what are you trying to understand/i)
    const tooLong = 'x'.repeat(241)

    expect(input).toHaveAttribute('minlength', '12')
    expect(input).toHaveAttribute('maxlength', '240')
    expect(input).toBeRequired()

    fireEvent.change(input, { target: { value: tooLong } })
    expect(setProblem).toHaveBeenCalledWith(tooLong)
  })

  it('discloses durable storage, server replay, and the provider boundary before play', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={API_PROVIDER}
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/saved to your WebChess account/i)).toBeInTheDocument()
    expect(screen.getByText(/sent from the server through OpenAI API using gpt-5.6-sol/i)).toBeInTheDocument()
    expect(screen.getByText(/server replays the saved move log/i)).toBeInTheDocument()
    expect(screen.getByText(/browser never sends an API key/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /OpenAI Platform data controls/i })).toHaveAttribute(
      'href',
      'https://developers.openai.com/api/docs/guides/your-data',
    )
  })

  it('explains browser-local storage and user-owned OpenClaw authentication', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={OPENCLAW_PROVIDER}
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/saved game and move history stay in this browser/i)).toBeInTheDocument()
    expect(screen.getByText(/sends your question through your local OpenClaw/i)).toBeInTheDocument()
    expect(screen.getByText(/configured provider and authentication/i)).toBeInTheDocument()
    expect(screen.getByText(/may contact a remote provider/i)).toBeInTheDocument()
    expect(screen.getByText(/credentials never enter the browser or a WebChess-operated service/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /How OpenClaw runs model requests/i }),
    ).toHaveAttribute('href', 'https://docs.openclaw.ai/cli/infer')
  })
})

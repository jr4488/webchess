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
        researchConsentDecision={null}
        setProblem={setProblem}
        setResearchConsentDecision={vi.fn()}
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
        researchConsentDecision="no_external_research"
        setProblem={vi.fn()}
        setResearchConsentDecision={vi.fn()}
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

  it('explains durable local storage and user-owned OpenClaw authentication', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={OPENCLAW_PROVIDER}
        researchConsentDecision="allow_search_and_page_fetch"
        setProblem={vi.fn()}
        setResearchConsentDecision={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/seven-stage visible WebChess 2.2 lifecycle stay in a dedicated PostgreSQL database/i)).toBeInTheDocument()
    expect(screen.getByText(/sends model turns through your local OpenClaw/i)).toBeInTheDocument()
    expect(screen.getByText(/configured provider and provider authentication/i)).toBeInTheDocument()
    expect(screen.getByText(/Portia validates the board-derived answer prompt/i)).toBeInTheDocument()
    expect(screen.getByText(/internal Gate checks sufficiency/i)).toBeInTheDocument()
    expect(screen.getByText(/Answer generation runs only after permission/i)).toBeInTheDocument()
    expect(screen.getByText(/Charlotte reviews and qualifies it/i)).toBeInTheDocument()
    expect(screen.getByText(/may contact a remote model/i)).toBeInTheDocument()
    expect(screen.getByText(/credentials never enter the browser or a WebChess-operated service/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /How OpenClaw runs model requests/i }),
    ).toHaveAttribute('href', 'https://docs.openclaw.ai/cli/infer')
  })

  it('requires an explicit game-scoped research choice and discloses both data paths', () => {
    const setResearchConsentDecision = vi.fn()
    const props = {
      problem: 'A concrete question',
      provider: OPENCLAW_PROVIDER,
      researchConsentDecision: null,
      setProblem: vi.fn(),
      setResearchConsentDecision,
      onSubmit: vi.fn(),
    } as const
    const { rerender } = render(<QuestionStage {...props} />)

    const allow = screen.getByRole('radio', { name: /allow bounded research/i })
    const decline = screen.getByRole('radio', { name: /do not use external research/i })
    expect(allow).toBeRequired()
    expect(decline).toBeRequired()
    expect(screen.getByRole('button', { name: /divide the problem/i })).toBeDisabled()
    expect(screen.getByText(/exact query shown in the lifecycle/i)).toBeInTheDocument()
    expect(screen.getByText(/at most three returned HTTPS pages/i)).toBeInTheDocument()
    expect(screen.getByText(/inherited by a bounded retry/i)).toBeInTheDocument()
    expect(screen.getByText(/failures stay visible/i)).toBeInTheDocument()

    fireEvent.click(allow)
    expect(setResearchConsentDecision).toHaveBeenCalledWith(
      'allow_search_and_page_fetch',
    )

    rerender(
      <QuestionStage
        {...props}
        researchConsentDecision="allow_search_and_page_fetch"
      />,
    )
    expect(screen.getByRole('button', { name: /divide the problem/i })).toBeEnabled()

    fireEvent.click(decline)
    expect(setResearchConsentDecision).toHaveBeenCalledWith('no_external_research')
  })
})

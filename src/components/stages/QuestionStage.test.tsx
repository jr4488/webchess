import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QuestionStage } from './QuestionStage'

const API_PROVIDER = {
  id: 'openai-api',
  label: 'OpenAI API',
  billing: 'platform-api',
  localOnly: false,
  dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  model: 'gpt-5.6-sol',
  webSearch: 'disabled',
} as const

const CODEX_PROVIDER = {
  id: 'codex-chatgpt',
  label: 'ChatGPT Codex',
  billing: 'chatgpt-workspace',
  localOnly: true,
  dataControlsUrl: 'https://help.openai.com/en/articles/7730893-data-controls-faq',
  model: 'gpt-5.6-sol',
  webSearch: 'live',
} as const

const OLLAMA_PROVIDER = {
  id: 'ollama',
  label: 'Ollama',
  billing: 'local-compute',
  localOnly: true,
  dataControlsUrl: 'https://docs.ollama.com/faq',
  model: 'qwen3.6:27b',
  webSearch: 'disabled',
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

  it('discloses Platform API billing, submissions, and retention before play', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={API_PROVIDER}
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/sent through OpenAI API using gpt-5.6-sol to build the 64-part map/i)).toBeInTheDocument()
    expect(screen.getByText(/original question, outcome, game totals and polarities/i)).toBeInTheDocument()
    expect(screen.getByText(/uncaptured facets are not/i)).toBeInTheDocument()
    expect(screen.getByText(/Platform API billing for the configured project/i)).toBeInTheDocument()
    expect(screen.getByText(/retain content for up to 30 days by default/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Platform API data controls/i })).toHaveAttribute(
      'href',
      'https://developers.openai.com/api/docs/guides/your-data',
    )
  })

  it('discloses local ChatGPT Codex allowance, limits, and workspace policy before play', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={CODEX_PROVIDER}
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/signed-in operator/i)).toBeInTheDocument()
    expect(screen.getByText(/ChatGPT Codex allowance or workspace credits/i)).toBeInTheDocument()
    expect(screen.getByText(/not free or unlimited/i)).toBeInTheDocument()
    expect(screen.getByText(/availability varies by plan and workspace/i)).toBeInTheDocument()
    expect(screen.getByText(/local-only and must not be offered as a public service/i)).toBeInTheDocument()
    expect(screen.getByText(/Internet search is configured in live mode/i)).toBeInTheDocument()
    expect(screen.getByText(/workspace settings may still limit availability/i)).toBeInTheDocument()
    expect(screen.getByText(/During either model run/i)).toBeInTheDocument()
    expect(screen.getByText(/search queries derived from your question or game context/i)).toBeInTheDocument()
    expect(screen.getByText(/instructed to generalize queries and exclude private details/i)).toBeInTheDocument()
    expect(screen.getByText(/retrieve public web information/i)).toBeInTheDocument()
    expect(screen.getByText(/public pages are untrusted references, not instructions/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ChatGPT workspace data controls/i })).toHaveAttribute(
      'href',
      'https://help.openai.com/en/articles/7730893-data-controls-faq',
    )
  })

  it('discloses local Ollama processing and the absence of API billing', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={OLLAMA_PROVIDER}
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/question stays on this machine/i)).toBeInTheDocument()
    expect(screen.getByText(/loopback connection to Ollama using qwen3.6:27b/i)).toBeInTheDocument()
    expect(screen.getByText(/uses local compute, has no Platform API charge/i)).toBeInTheDocument()
    expect(screen.getByText(/does not add Internet search/i)).toBeInTheDocument()
    expect(screen.getByText(/local-only and must not be exposed/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ollama local runtime information/i })).toHaveAttribute(
      'href',
      'https://docs.ollama.com/faq',
    )
  })

  it('does not claim Internet search is enabled when Codex search is disabled', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        provider={{ ...CODEX_PROVIDER, webSearch: 'disabled' }}
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByText(/Internet search is configured/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/generalized search queries/i)).not.toBeInTheDocument()
  })
})

import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelActivityState } from '../types'
import { ModelActivityPanel } from './ModelActivityPanel'

const STARTED_AT = Date.UTC(2026, 6, 25, 12, 0, 0)

function activeActivity(
  overrides: Partial<ModelActivityState> = {},
): ModelActivityState {
  return {
    operation: 'division',
    status: 'active',
    phase: 'thinking',
    startedAt: STARTED_AT,
    lastHeartbeatAt: STARTED_AT + 61_000,
    lastProviderActivityAt: STARTED_AT + 60_000,
    history: [
      { phase: 'request-accepted', at: STARTED_AT },
      { phase: 'preparing-input', at: STARTED_AT + 1_000 },
      { phase: 'awaiting-model', at: STARTED_AT + 2_000 },
      { phase: 'thinking', at: STARTED_AT + 8_000 },
    ],
    rationaleNotes: [],
    reasoning: null,
    ...overrides,
  }
}

function renderPanel(activity: ModelActivityState = activeActivity()) {
  return render(
    <ModelActivityPanel
      activity={activity}
      modelLabel="qwen3.6:27b"
      providerLabel="Ollama"
      summary="Looking across purpose, people, resources, timing, risks, values, evidence, and possibilities."
      metrics={[
        { label: 'Facets', value: '64 requested' },
        { label: 'Runtime', value: 'Local' },
      ]}
    />,
  )
}

describe('ModelActivityPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows live identity, elapsed time, freshness, safe context, and phase history', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 62_000)
    renderPanel()

    const panel = screen.getByRole('region', { name: 'Thinking' })
    expect(panel).not.toHaveAttribute('aria-busy')
    expect(panel.querySelector('.model-activity-panel__current')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(panel).toHaveAttribute('data-activity-operation', 'division')
    expect(panel).toHaveAttribute('data-activity-phase', 'thinking')
    expect(within(panel).getByText('Live activity')).toBeInTheDocument()
    expect(within(panel).getByText('qwen3.6:27b via Ollama')).toBeInTheDocument()
    expect(within(panel).getByLabelText('Elapsed time 01:02')).toHaveTextContent('01:02')
    expect(within(panel).getByText('WebChess connection active')).toBeInTheDocument()
    expect(within(panel).getByText('Heartbeat just now')).toBeInTheDocument()
    expect(within(panel).getByText('Model activity just now')).toBeInTheDocument()
    expect(within(panel).getByText(/looking across purpose, people, resources/i)).toBeInTheDocument()
    expect(within(panel).getByText('Facets')).toBeInTheDocument()
    expect(within(panel).getByText('64 requested')).toBeInTheDocument()

    const timeline = within(panel).getByRole('list', { name: 'Model activity timeline' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(4)
    expect(within(timeline).getByText('Request accepted')).toBeInTheDocument()
    expect(within(timeline).getByText('Preparing the model input')).toBeInTheDocument()
    expect(within(timeline).getByText('Waiting for the model')).toBeInTheDocument()
    expect(within(timeline).getByText('Model activity received').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    )

    await act(() => vi.advanceTimersByTimeAsync(6_000))
    expect(within(panel).getByLabelText('Elapsed time 01:08')).toHaveTextContent('01:08')
    expect(within(panel).getByText('Heartbeat 7s ago')).toBeInTheDocument()
    expect(within(panel).getByText('Model activity 8s ago')).toBeInTheDocument()
  })

  it('truthfully marks a stale browser-server heartbeat and absent model activity', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 90_000)
    renderPanel(activeActivity({
      phase: 'awaiting-model',
      lastHeartbeatAt: STARTED_AT + 60_000,
      lastProviderActivityAt: undefined,
      history: [
        { phase: 'request-accepted', at: STARTED_AT },
        { phase: 'preparing-input', at: STARTED_AT + 1_000 },
        { phase: 'awaiting-model', at: STARTED_AT + 2_000 },
      ],
    }))

    expect(screen.getByText('No recent WebChess heartbeat')).toBeInTheDocument()
    expect(screen.getByText('Heartbeat 30s ago')).toBeInTheDocument()
    expect(screen.getByText('Waiting for model activity')).toBeInTheDocument()
  })

  it('freezes elapsed time when the operation completes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 30_000)
    renderPanel(activeActivity({
      status: 'complete',
      phase: 'complete',
      lastHeartbeatAt: STARTED_AT + 12_000,
      lastProviderActivityAt: STARTED_AT + 11_000,
      history: [
        { phase: 'request-accepted', at: STARTED_AT },
        { phase: 'thinking', at: STARTED_AT + 2_000 },
        { phase: 'validating-output', at: STARTED_AT + 10_000 },
        { phase: 'complete', at: STARTED_AT + 12_000 },
      ],
    }))

    const panel = screen.getByRole('region', { name: 'Thinking' })
    expect(panel).not.toHaveAttribute('aria-busy')
    expect(screen.getByText('WebChess stream complete')).toBeInTheDocument()
    expect(screen.getByText('Model activity complete')).toBeInTheDocument()
    expect(within(panel).getByLabelText('Elapsed time 00:12')).toHaveTextContent('00:12')

    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(within(panel).getByLabelText('Elapsed time 00:12')).toHaveTextContent('00:12')
  })

  it('uses operation-specific answer copy and states the privacy boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 2_000)
    renderPanel(activeActivity({
      operation: 'answer',
      phase: 'preparing-input',
      lastHeartbeatAt: STARTED_AT + 2_000,
      lastProviderActivityAt: undefined,
      history: [
        { phase: 'request-accepted', at: STARTED_AT },
        { phase: 'preparing-input', at: STARTED_AT + 1_000 },
      ],
    }))

    expect(screen.getByText(
      'The outcome and captured game signals are being prepared.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'These are live progress summaries. Private chain-of-thought is not displayed.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/raw reasoning|reasoning token/i)).not.toBeInTheDocument()
  })

  it('features the newest Qwen rationale and keeps earlier display notes available', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 20_000)
    const { container } = renderPanel(activeActivity({
      phase: 'writing-rationale',
      history: [
        { phase: 'request-accepted', at: STARTED_AT },
        { phase: 'thinking', at: STARTED_AT + 5_000 },
        { phase: 'writing-rationale', at: STARTED_AT + 12_000 },
      ],
      rationaleNotes: [
        {
          text: 'I am separating immediate constraints from the outcome worth protecting.',
          at: STARTED_AT + 10_000,
        },
        {
          text: 'I am checking **distinct tensions** before arranging the structured facets.',
          at: STARTED_AT + 18_000,
        },
      ],
    }))

    const rationale = screen.getByRole('region', {
      name: 'Qwen public rationale, written for display',
    })
    expect(within(rationale).getByRole('heading', {
      name: 'Qwen public rationale',
    })).toBeInTheDocument()
    expect(within(rationale).getByText('Written for display')).toBeInTheDocument()
    expect(within(rationale).getByText(/not a transcript of the primary analysis/i)).toBeInTheDocument()
    expect(within(rationale).getByText(
      'I am checking **distinct tensions** before arranging the structured facets.',
    )).toBeInTheDocument()
    expect(within(rationale).getByText(/latest display note · 00:18/i)).toBeInTheDocument()
    expect(within(rationale).getByText(/review 1 earlier display note/i)).toBeInTheDocument()
    expect(within(rationale).getByText(
      'I am separating immediate constraints from the outcome worth protecting.',
    )).toBeInTheDocument()
    expect(rationale.querySelector('strong')).toBeNull()
    expect(container.querySelector('[data-activity-phase="writing-rationale"]')).toBeInTheDocument()
    expect(screen.getAllByText('Writing a public rationale').length).toBeGreaterThan(0)
  })

  it('shows a calm placeholder before the first public rationale arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 3_000)
    renderPanel(activeActivity({
      phase: 'writing-rationale',
      lastProviderActivityAt: undefined,
      rationaleNotes: [],
    }))

    expect(screen.getByText('0 notes')).toBeInTheDocument()
    expect(screen.getByText('Waiting for Qwen’s first display note.')).toBeInTheDocument()
  })

  it('does not promise public rationale when the stream is not producing it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 3_000)
    renderPanel(activeActivity({
      phase: 'awaiting-model',
      lastProviderActivityAt: undefined,
      rationaleNotes: [],
    }))

    expect(screen.queryByRole('region', {
      name: /public rationale, written for display/i,
    })).not.toBeInTheDocument()
    expect(screen.queryByText(/first display note/i)).not.toBeInTheDocument()
  })

  it('uses the configured model name for non-Qwen public rationale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 3_000)
    render(
      <ModelActivityPanel
        activity={activeActivity({
          operation: 'answer',
          rationaleNotes: [{
            text: 'I am comparing the captured signals before writing the final answer.',
            at: STARTED_AT + 2_000,
          }],
        })}
        modelLabel="gpt-5.6-sol"
        providerLabel="OpenAI API"
        summary="Reviewing the captured conflict trail."
      />,
    )

    expect(screen.getByRole('region', {
      name: 'gpt-5.6-sol public rationale, written for display',
    })).toBeInTheDocument()
    expect(screen.getByText('gpt-5.6-sol public rationale')).toBeInTheDocument()
    expect(screen.queryByText('Qwen public rationale')).not.toBeInTheDocument()
  })

  it('renders public rationale as inert plain text', () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT + 3_000)
    const hostileText =
      'I am treating <img src=x onerror=alert(1)> and **bold markup** as plain text.'
    const { container } = renderPanel(activeActivity({
      rationaleNotes: [{
        text: hostileText,
        at: STARTED_AT + 2_000,
      }],
    }))

    expect(screen.getByText(hostileText)).toBeInTheDocument()
    expect(container.querySelector('.model-activity-panel__rationale img')).toBeNull()
    expect(container.querySelector('.model-activity-panel__rationale strong')).toBeNull()
  })
})

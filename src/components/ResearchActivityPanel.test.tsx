import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResearchRecord, ResearchStatus } from '../lib/research'
import { ResearchActivityPanel, ResearchProvenanceDetails } from './ResearchActivityPanel'

function researchRecord(
  status: ResearchStatus = 'completed',
  overrides: Partial<ResearchRecord> = {},
): ResearchRecord {
  return {
    id: '81000000-0000-4000-8000-000000000001',
    lifecycleRunId: '72000000-0000-4000-8000-000000000001',
    gameId: '73000000-0000-4000-8000-000000000001',
    stage: 'portia',
    requestedBy: 'research-policy',
    policyVersion: 'research-policy/1',
    materiality: 'required',
    reason: 'The recommendation depends on a current external benchmark.',
    query: 'current authoritative LLM inference latency benchmark 2026',
    status,
    provider: 'codex',
    transport: 'local',
    model: 'gpt-5.4-search',
    bounds: {
      invocationLimit: 1,
      resultLimit: 5,
      sourceLimit: 3,
      timeoutMs: 30_000,
      synthesisCharacterLimit: 4_000,
    },
    attemptCount: status === 'not_needed' || status === 'refused' ? 0 : 1,
    executedQueries: status === 'not_needed' || status === 'refused'
      ? []
      : [
          'current authoritative LLM inference latency benchmark 2026',
          'official LLM serving latency benchmark 2026',
        ],
    searchSynthesis: status === 'completed'
      ? 'Current sources distinguish prefill latency from decode throughput.'
      : null,
    directPageTextFetched: false,
    retrievedFacts: [],
    sources: status === 'completed' ? [
      {
        id: '82000000-0000-4000-8000-000000000001',
        citationId: 'source-1',
        ordinal: 1,
        title: 'NIST AI measurement guidance',
        url: 'https://www.nist.gov/example',
        hostname: 'www.nist.gov',
        trust: 'government_or_education',
        discoveredFrom: 'search_activity',
        createdAt: '2026-08-02T20:00:01.000Z',
      },
    ] : [],
    omittedSourceCount: status === 'completed' ? 2 : 0,
    injectionSignalsDetected: status === 'completed'
      ? ['instruction-like content in search synthesis']
      : [],
    contentDigest: status === 'completed' ? 'a'.repeat(64) : null,
    failureCode: status === 'failed' ? 'provider_failed' : null,
    startedAt: status === 'not_needed' ? null : '2026-08-02T20:00:00.000Z',
    completedAt: status === 'searching' ? null : '2026-08-02T20:00:30.000Z',
    createdAt: '2026-08-02T20:00:00.000Z',
    updatedAt: '2026-08-02T20:00:30.000Z',
    ...overrides,
  }
}

describe('ResearchActivityPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows every bounded query and labels synthesis separately from directly retrieved facts', () => {
    render(<ResearchActivityPanel records={[researchRecord()]} />)

    expect(screen.getByRole('heading', { name: 'Automatic web research' })).toBeInTheDocument()
    expect(screen.getByText('Portia · automatic research')).toBeInTheDocument()
    expect(screen.getByText(/current external benchmark/i)).toBeInTheDocument()
    expect(screen.getAllByText('current authoritative LLM inference latency benchmark 2026'))
      .toHaveLength(2)
    expect(screen.getByText('official LLM serving latency benchmark 2026')).toBeInTheDocument()
    expect(screen.getByText('Codex Search (codex)')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.4-search')).toBeInTheDocument()
    expect(screen.getByText('1 used · 1 maximum')).toBeInTheDocument()
    expect(screen.getByText('30 seconds')).toBeInTheDocument()
    expect(screen.getByText('4,000')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Directly retrieved facts: none' }))
      .toBeInTheDocument()
    expect(screen.getByRole('heading', {
      name: 'Codex Search synthesis (model-generated, untrusted until Portia)',
    })).toBeInTheDocument()
    expect(screen.getByText(/prefill latency from decode throughput/i)).toBeInTheDocument()
    expect(screen.getByText('1 visible · 2 omitted')).toBeInTheDocument()
    expect(screen.getByText(/Injection signals detected: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/instruction-like content/i)).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: 'Research elapsed time' }))
      .toHaveTextContent('30seconds elapsed')
    expect(screen.getByText(/Packet received with 2 executed queries and 1 citation link/i))
      .toBeInTheDocument()

    const citation = screen.getByRole('link', { name: /NIST AI measurement guidance/i })
    expect(citation).toHaveAttribute('href', 'https://www.nist.gov/example')
    expect(citation).toHaveAttribute('target', '_blank')
    expect(citation).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/Government or education link/i)).toBeInTheDocument()
    expect(screen.getByText(/Source record ID:/i)).toHaveTextContent(
      '82000000-0000-4000-8000-000000000001',
    )
    expect(screen.getByText(/Research record ID/i).closest('div')).toHaveTextContent(
      '81000000-0000-4000-8000-000000000001',
    )
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('withholds unsafe citation URLs even if an invalid record reaches the component', () => {
    const unsafeSource = {
      ...researchRecord().sources[0]!,
      url: 'javascript:alert(1)',
    }
    render(<ResearchActivityPanel records={[
      researchRecord('completed', { sources: [unsafeSource] }),
    ]} />)

    expect(screen.queryByRole('link', { name: /NIST AI measurement guidance/i }))
      .not.toBeInTheDocument()
    expect(screen.getByText(/NIST AI measurement guidance · link withheld/i))
      .toBeInTheDocument()
  })

  it.each([
    ['not_needed', 'The research policy found no material current or external fact gap'],
    ['failed', 'The broker failed safely'],
    ['timed_out', 'The search exceeded a configured time boundary within the broker’s 30 seconds limit'],
    ['refused', 'The broker refused this request under its safety policy'],
  ] as const)('renders a stable %s terminal state', (status, expected) => {
    render(<ResearchActivityPanel records={[researchRecord(status)]} />)

    const record = screen.getByRole('article')
    expect(record).toHaveAttribute('data-research-status', status)
    expect(record).toHaveAttribute('aria-busy', 'false')
    expect(record).toHaveTextContent(expected)
    expect(record).toHaveTextContent(`terminal · ${status}`)
    expect(screen.getByText('No synthesis was returned.')).toBeInTheDocument()
  })

  it('announces one active search politely and shows bounded source progress', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T20:00:05.000Z'))
    const { container } = render(<ResearchActivityPanel records={[
      researchRecord('searching', {
        sources: [],
        omittedSourceCount: 0,
        searchSynthesis: null,
      }),
    ]} />)

    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('0 linked of 3 allowed · 0 omitted')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', {
      name: 'Source links found against the applied source limit',
    })).toHaveAttribute('max', '3')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent(/research for Portia is searching/i)
    expect(screen.getByRole('timer', { name: 'Research elapsed time' }))
      .toHaveTextContent('5seconds elapsed')
    expect(screen.getByRole('progressbar', {
      name: 'Elapsed research time against the broker limit',
    })).toHaveAttribute('value', '5')
    expect(screen.getByText('Codex Search is working')).toBeInTheDocument()
    expect(screen.getByText(/returns its search activity and citations together as one validated packet/i))
      .toBeInTheDocument()
    expect(container.querySelector('.research-live-web.is-active')).toBeInTheDocument()
    expect(container.querySelectorAll('.research-live-web__node')).toHaveLength(3)
    expect(container.querySelectorAll('.research-live-web__node.has-source')).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(screen.getByRole('timer', { name: 'Research elapsed time' }))
      .toHaveTextContent('7seconds elapsed')
  })
})

describe('ResearchProvenanceDetails', () => {
  it('surfaces terminal research and source record IDs', () => {
    render(<ResearchProvenanceDetails records={[researchRecord()]} />)

    const provenance = screen.getByRole('region', { name: 'Durable research records' })
    expect(within(provenance).getByText(/Portia research · terminal completed/i))
      .toBeInTheDocument()
    expect(provenance).toHaveTextContent('81000000-0000-4000-8000-000000000001')
    expect(provenance).toHaveTextContent('82000000-0000-4000-8000-000000000001')
    expect(provenance).toHaveTextContent('source-1')
  })
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WebMemoryIndex } from '../lib/lifecycle/contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from '../lib/lifecycle/versions'
import {
  countDueWebMemoryActions,
  WebMemoryPanel,
} from './WebMemoryPanel'

const OBSERVATION_ID = 'a1000000-0000-4000-8000-000000000001'

const MEMORY: WebMemoryIndex = {
  carriedObservationIds: [OBSERVATION_ID],
  cases: [{
    gameId: 'a1000000-0000-4000-8000-000000000002',
    problem: 'How can a bounded test produce trustworthy evidence safely?',
    isCurrent: false,
    createdAt: '1999-12-01T12:00:00.000Z',
    updatedAt: '2000-01-01T12:00:00.000Z',
    actions: [{
      action: {
        id: 'a1000000-0000-4000-8000-000000000003',
        lifecycleRunId: 'a1000000-0000-4000-8000-000000000004',
        charlotteActionIndex: 0,
        charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
        actor: 'The accountable owner',
        action: 'Run one limited observation without expanding the scope.',
        testedAssumption: 'A reversible test can produce useful evidence safely.',
        expectedObservation: 'A measurable signal appears before the review date.',
        decisionThreshold: 'Continue only when the signal appears without material harm.',
        reviewHorizon: 'Within seven days',
        followUpAt: '2000-01-01T12:00:00.000Z',
        status: 'in_progress',
        revision: 1,
        version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        createdAt: '1999-12-01T12:00:00.000Z',
        updatedAt: '2000-01-01T12:00:00.000Z',
      },
      observations: [{
        id: OBSERVATION_ID,
        actionId: 'a1000000-0000-4000-8000-000000000003',
        observedAt: '1999-12-15T12:00:00.000Z',
        observation: 'The measured signal improved while the opt-out remained available.',
        evidenceClassification: 'Measured result',
        expectedEffect: 'A measurable signal appears before the review date.',
        unexpectedEffect: 'One stakeholder needed a longer explanation.',
        stakeholderResponse: 'Participants used the opt-out and reported no lasting harm.',
        assumptionResult: 'supported',
        nextDecision: 'Repeat once with a broader stakeholder review before scaling.',
        version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        createdAt: '1999-12-15T12:00:00.000Z',
      }],
    }],
  }],
}

describe('WebMemoryPanel', () => {
  it('shows the complete follow-up record and requires explicit reuse', () => {
    const onToggleObservation = vi.fn()
    const onUseNextDecision = vi.fn()
    render(
      <WebMemoryPanel
        open
        memory={MEMORY}
        busy={false}
        error=""
        selectionEnabled
        selectedObservationIds={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onToggleObservation={onToggleObservation}
        onUseNextDecision={onUseNextDecision}
      />,
    )

    const panel = screen.getByRole('dialog', { name: /case memory/i })
    expect(within(panel).getByText((_content, element) =>
      element?.classList.contains('is-due') === true
      && element.textContent?.includes('1') === true
      && element.textContent?.includes('due now') === true,
    )).toBeInTheDocument()
    expect(within(panel).getByText(/nothing is reused silently/i)).toBeInTheDocument()
    expect(within(panel).getByText(/carried by current case/i)).toBeInTheDocument()
    expect(within(panel).getByText(/measured signal improved/i)).toBeInTheDocument()
    expect(within(panel).getByText(/one stakeholder needed/i)).toBeInTheDocument()
    expect(within(panel).getByText(/participants used the opt-out/i)).toBeInTheDocument()
    expect(within(panel).getByText(/broader stakeholder review/i)).toBeInTheDocument()

    fireEvent.click(within(panel).getByLabelText(/use as prior evidence/i))
    expect(onToggleObservation).toHaveBeenCalledWith(OBSERVATION_ID)
    fireEvent.click(within(panel).getByRole('button', { name: /ask its next decision/i }))
    expect(onUseNextDecision).toHaveBeenCalledWith(
      MEMORY.cases[0].actions[0].observations[0],
    )
  })

  it('does not count a follow-up as due after a later observation', () => {
    const resolved: WebMemoryIndex = {
      ...MEMORY,
      cases: MEMORY.cases.map((item) => ({
        ...item,
        actions: item.actions.map((record) => ({
          ...record,
          observations: record.observations.map((observation) => ({
            ...observation,
            observedAt: '2000-01-02T12:00:00.000Z',
          })),
        })),
      })),
    }
    expect(countDueWebMemoryActions(MEMORY, Date.parse('2000-01-02T00:00:00.000Z'))).toBe(1)
    expect(countDueWebMemoryActions(resolved, Date.parse('2000-01-03T00:00:00.000Z'))).toBe(0)
  })
})

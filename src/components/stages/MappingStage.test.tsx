import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { makeProblemParts } from '../../test/fixtures'
import { MappingStage } from './MappingStage'

vi.mock('../ProcessGraphic', () => ({
  ProcessGraphic: ({ headline }: { headline: string }) => <div>{headline}</div>,
}))

vi.mock('../RadialBoard', () => ({
  RadialBoard: () => <div data-testid="radial-board" />,
}))

describe('MappingStage provider provenance', () => {
  it('identifies the fixed model and hosted OpenAI provider together', () => {
    render(
      <MappingStage
        problem="How should this plan change?"
        provider={{
          label: 'OpenAI API',
          dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
          model: 'gpt-5.6-sol',
        }}
        parts={makeProblemParts('mapping-provider')}
        progress={64}
        divisionStatus="success"
        divisionPhase="casting"
        divisionModel="gpt-5.6-sol"
        divisionPrompt=""
        divisionError=""
        divisionActivity={null}
        beginDisabled={false}
        onBegin={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText(
      /gpt-5\.6-sol · OpenAI API · semantic division/i,
    )).toBeInTheDocument()
  })
})

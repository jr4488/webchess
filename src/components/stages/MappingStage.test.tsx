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
  it('identifies the model and ChatGPT Codex provider together', () => {
    render(
      <MappingStage
        problem="How should this plan change?"
        provider={{
          id: 'codex-chatgpt',
          label: 'ChatGPT Codex',
          billing: 'chatgpt-workspace',
          localOnly: true,
          dataControlsUrl: 'https://help.openai.com/en/articles/7730893-data-controls-faq',
          model: 'gpt-5.6-sol',
          webSearch: 'live',
        }}
        parts={makeProblemParts('mapping-provider')}
        progress={64}
        divisionStatus="success"
        divisionPhase="casting"
        divisionModel="gpt-5.6-sol"
        divisionPrompt=""
        divisionError=""
        divisionActivity={null}
        onBegin={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText(
      /gpt-5\.6-sol · ChatGPT Codex · semantic division/i,
    )).toBeInTheDocument()
  })
})

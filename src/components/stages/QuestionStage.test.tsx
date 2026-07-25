import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QuestionStage } from './QuestionStage'

describe('QuestionStage', () => {
  it('uses native bounded input without silently truncating the question', () => {
    const setProblem = vi.fn()
    render(
      <QuestionStage
        problem=""
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

  it('discloses both model submissions and the default retention caveat before play', () => {
    render(
      <QuestionStage
        problem="A concrete question"
        setProblem={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/sent to OpenAI to build the 64-part map/i)).toBeInTheDocument()
    expect(screen.getByText(/retained for up to 30 days by default/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /OpenAI data controls/i })).toHaveAttribute(
      'href',
      'https://platform.openai.com/docs/guides/your-data',
    )
  })
})

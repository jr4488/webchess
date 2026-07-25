import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HomePage } from './HomePage'

describe('WebChess public website', () => {
  it('explains the complete method and links into the playable game', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { level: 1, name: /do not just think harder/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /play webchess|bring a problem/i }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining('/play') })]))
    expect(screen.getByRole('heading', { name: /four transformations/i })).toBeInTheDocument()
    expect(screen.getByText(/gpt-5\.6-sol first proposes 64 bounded perspectives/i)).toBeInTheDocument()
    expect(screen.getAllByTestId('facet-cell')).toHaveLength(64)
    expect(screen.getAllByLabelText(/means/i)).toHaveLength(6)
    expect(screen.getByText(/designed to help; not yet scientifically validated/i)).toBeInTheDocument()
    expect(screen.getByText(/reflective creativity instrument—not prophecy/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot guarantee semantic distinctness, relevance, or correctness/i)).toBeInTheDocument()
    expect(screen.getByText(/final AI receives only the captured facets/i)).toBeInTheDocument()
    expect(screen.queryByText(/prevents 64 cosmetic rewrites/i)).not.toBeInTheDocument()
  })

  it('uses sourced quotations and distinguishes inspiration from endorsement', () => {
    render(<HomePage />)

    expect(screen.getByText(/attention centers not on things/i)).toBeInTheDocument()
    expect(screen.getByText(/starting positions are mixed/i)).toBeInTheDocument()
    expect(screen.getByText(/a random element is rather useful/i)).toBeInTheDocument()
    expect(screen.getByText(/generate candidate branches/i)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /^source ·/i })).toHaveLength(4)
    expect(screen.getByText(/did not describe or endorse webchess/i)).toBeInTheDocument()
  })
})

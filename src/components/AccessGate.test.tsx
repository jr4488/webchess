import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AccessGate } from './AccessGate'

describe('AccessGate', () => {
  it('announces the initial session check without showing a code field', () => {
    render(
      <AccessGate
        status="checking"
        onAuthenticate={vi.fn()}
        onRetryCheck={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/checking for an active session/i)
    expect(screen.queryByLabelText(/access code/i)).not.toBeInTheDocument()
  })

  it('submits the code without storing it in a persistent browser API', async () => {
    const authenticate = vi.fn().mockResolvedValue(undefined)
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem')
    render(
      <AccessGate
        status="unauthenticated"
        onAuthenticate={authenticate}
        onRetryCheck={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/access code/i), {
      target: { value: 'private-access-code' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enter webchess/i }))

    expect(authenticate).toHaveBeenCalledWith('private-access-code')
    expect(localStorageSpy).not.toHaveBeenCalled()
    localStorageSpy.mockRestore()
  })

  it('keeps the gate open and announces a rejected code', async () => {
    const authenticate = vi.fn().mockRejectedValue(new Error('That access code is not valid.'))
    render(
      <AccessGate
        status="unauthenticated"
        onAuthenticate={authenticate}
        onRetryCheck={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/access code/i), {
      target: { value: 'incorrect-code' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enter webchess/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i)
    expect(screen.getByLabelText(/access code/i)).toHaveValue('incorrect-code')
  })
})

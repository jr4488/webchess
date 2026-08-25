// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ANSWER_OPERATION_TIMEOUT_MS } from '@/server/model-operation-timeouts'

const harness = vi.hoisted(() => ({
  handleAnswerRequest: vi.fn().mockResolvedValue(new Response(null)),
}))

vi.mock('@/server/http', () => ({
  handleAnswerRequest: harness.handleAnswerRequest,
}))

import { maxDuration, POST } from './route'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Answer route deadline', () => {
  it('captures the five-minute cutoff before async route setup', async () => {
    let resolveParams: ((value: { id: string }) => void) | undefined
    const params = new Promise<{ id: string }>((resolve) => {
      resolveParams = resolve
    })
    const enteredAt = Date.parse('2026-08-25T19:00:00.000Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(enteredAt)

    const response = POST({} as never, { params })
    now.mockReturnValue(enteredAt + 60_000)
    resolveParams?.({ id: '00000000-0000-4000-8000-000000000001' })
    await response

    expect(maxDuration).toBe(335)
    expect(harness.handleAnswerRequest).toHaveBeenCalledWith(
      {},
      '00000000-0000-4000-8000-000000000001',
      {
        operationDeadlineAt: new Date(
          enteredAt + ANSWER_OPERATION_TIMEOUT_MS,
        ),
      },
    )
  })
})

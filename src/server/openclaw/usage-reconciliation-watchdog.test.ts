// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startUsageReconciliationWatchdog } from './usage-reconciliation-watchdog'

let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('OpenClaw durable usage reconciliation watchdog', () => {
  it('settles crossed deadlines without route traffic', async () => {
    const reconcileExpiredLeases = vi.fn().mockResolvedValue({
      expiredRequests: 1,
      clearedSlots: 1,
    })
    stop = startUsageReconciliationWatchdog(
      { reconcileExpiredLeases },
      { intervalMs: 1_000 },
    )

    expect(reconcileExpiredLeases).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reconcileExpiredLeases).toHaveBeenCalledOnce()
  })

  it('never overlaps reconciliation and schedules again only after settlement', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<{
      expiredRequests: number
      clearedSlots: number
    }>((resolve) => {
      releaseFirst = () => resolve({ expiredRequests: 0, clearedSlots: 0 })
    })
    const reconcileExpiredLeases = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ expiredRequests: 0, clearedSlots: 0 })
    stop = startUsageReconciliationWatchdog(
      { reconcileExpiredLeases },
      { intervalMs: 1_000 },
    )

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reconcileExpiredLeases).toHaveBeenCalledOnce()

    releaseFirst?.()
    await first
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reconcileExpiredLeases).toHaveBeenCalledTimes(2)
  })

  it('reports a bounded signal and retries after a reconciliation failure', async () => {
    const reportFailure = vi.fn(() => {
      throw new Error('diagnostic sink failed')
    })
    const reconcileExpiredLeases = vi.fn()
      .mockRejectedValueOnce(new Error('database details must not escape'))
      .mockResolvedValueOnce({ expiredRequests: 0, clearedSlots: 0 })
    const reportSuccess = vi.fn()
    stop = startUsageReconciliationWatchdog(
      { reconcileExpiredLeases },
      { intervalMs: 1_000, reportFailure, reportSuccess },
    )

    await vi.advanceTimersByTimeAsync(1_000)
    expect(reportFailure).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reconcileExpiredLeases).toHaveBeenCalledTimes(2)
    expect(reportSuccess).toHaveBeenCalledOnce()
  })

  it('does not reschedule when stopped during an active tick', async () => {
    let release: (() => void) | undefined
    const active = new Promise<{
      expiredRequests: number
      clearedSlots: number
    }>((resolve) => {
      release = () => resolve({ expiredRequests: 0, clearedSlots: 0 })
    })
    const reconcileExpiredLeases = vi.fn(() => active)
    stop = startUsageReconciliationWatchdog(
      { reconcileExpiredLeases },
      { intervalMs: 1_000 },
    )

    await vi.advanceTimersByTimeAsync(1_000)
    stop()
    release?.()
    await active
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reconcileExpiredLeases).toHaveBeenCalledOnce()
  })
})

import type { UsageController } from '@/server/usage'

export const USAGE_RECONCILIATION_INTERVAL_MS = 10_000

interface UsageReconciliationWatchdogOptions {
  readonly intervalMs?: number
  readonly reportFailure?: () => void
  readonly reportSuccess?: () => void
}

/**
 * Reconcile persisted request deadlines even when no HTTP route remains alive.
 * The next unref'd tick is scheduled only after the current one settles, so
 * database reconciliation can never overlap itself or keep Node running.
 */
export function startUsageReconciliationWatchdog(
  usage: Pick<UsageController, 'reconcileExpiredLeases'>,
  options: UsageReconciliationWatchdogOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? USAGE_RECONCILIATION_INTERVAL_MS
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new TypeError('Usage reconciliation interval must be a positive integer.')
  }

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (): void => {
    if (stopped) return
    timer = setTimeout(() => {
      timer = undefined
      void usage.reconcileExpiredLeases()
        .then(() => {
          try {
            options.reportSuccess?.()
          } catch {
            // Health reporting must not disable durable reconciliation.
          }
        })
        .catch(() => {
          try {
            options.reportFailure?.()
          } catch {
            // A diagnostic sink must never disable durable reconciliation.
          }
        })
        .finally(schedule)
    }, intervalMs)
    timer.unref?.()
  }

  schedule()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
}

import type {
  ModelActivityOperation,
  ModelActivityState,
} from '../types'

export function beginModelActivity(
  operation: ModelActivityOperation,
  now = Date.now(),
): ModelActivityState {
  return {
    operation,
    status: 'active',
    startedAt: now,
    lastUpdatedAt: now,
  }
}

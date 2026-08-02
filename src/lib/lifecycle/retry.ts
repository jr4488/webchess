import type { GateResult, RetryDecision } from './contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from './versions'

export const RETRY_LIMITS = Object.freeze({
  sameFieldReplays: 2,
  fieldRegenerations: 1,
})

export interface RetryPolicyInput {
  readonly gate: GateResult
  readonly sameFieldRetryCount: number
  readonly fieldRegenerationCount: number
  readonly duplicateTerminalFingerprint: boolean
}

export function decideRetry(input: RetryPolicyInput): RetryDecision {
  if (input.gate.passed) {
    throw new Error('A passed Gate cannot create a Retry decision.')
  }
  if (
    !Number.isInteger(input.sameFieldRetryCount) ||
    input.sameFieldRetryCount < 0 ||
    !Number.isInteger(input.fieldRegenerationCount) ||
    input.fieldRegenerationCount < 0
  ) {
    throw new TypeError('Retry counters must be nonnegative integers.')
  }

  const remainingSameFieldRetries = Math.max(
    0,
    RETRY_LIMITS.sameFieldReplays - input.sameFieldRetryCount,
  )
  const remainingFieldRegenerations = Math.max(
    0,
    RETRY_LIMITS.fieldRegenerations - input.fieldRegenerationCount,
  )
  const fieldRetryRequested =
    input.duplicateTerminalFingerprint ||
    input.gate.recommendedNextTransition === 'retry_field' ||
    remainingSameFieldRetries === 0

  if (fieldRetryRequested && remainingFieldRegenerations > 0) {
    return {
      policyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      mode: 'regenerate_field',
      reason: input.duplicateTerminalFingerprint
        ? 'The terminal ecology duplicates a prior attempt, so another same-field trajectory is not informative.'
        : 'The Gate identified a field-level deficiency or the same-field replay allowance is exhausted.',
      sameFieldRetryCount: input.sameFieldRetryCount,
      fieldRegenerationCount: input.fieldRegenerationCount,
      remainingSameFieldRetries,
      remainingFieldRegenerations,
    }
  }

  if (!fieldRetryRequested && remainingSameFieldRetries > 0) {
    return {
      policyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      mode: 'replay_game',
      reason: 'The semantic field remains usable, but this trajectory did not leave a sufficient terminal ecology.',
      sameFieldRetryCount: input.sameFieldRetryCount,
      fieldRegenerationCount: input.fieldRegenerationCount,
      remainingSameFieldRetries,
      remainingFieldRegenerations,
    }
  }

  return {
    policyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
    mode: 'insufficient_basis',
    reason: 'The bounded game and field retry allowances are exhausted; Charlotte is not authorized to manufacture a recommendation.',
    sameFieldRetryCount: input.sameFieldRetryCount,
    fieldRegenerationCount: input.fieldRegenerationCount,
    remainingSameFieldRetries,
    remainingFieldRegenerations,
  }
}

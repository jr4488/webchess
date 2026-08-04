import type {
  GateResult,
  LifecycleAggregate,
  RetryDecision,
} from './contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from './versions'

export const RETRY_LIMITS = Object.freeze({
  sameFieldReplays: 2,
  fieldRegenerations: 1,
})

/**
 * Older Gate versions could persist a terminal stop before consuming the one
 * repairable field-regeneration path. Reopening is deliberately limited to
 * prompt-bound Portia runs with that allowance still available.
 */
export function canReopenInsufficientBasis(
  lifecycle: Pick<
    LifecycleAggregate,
    'state' | 'gate' | 'portia' | 'fieldRegenerationCount'
  >,
): boolean {
  return lifecycle.state === 'insufficient_basis'
    && lifecycle.gate?.passed === false
    && lifecycle.portia != null
    && 'promptDecision' in lifecycle.portia
    && lifecycle.fieldRegenerationCount < RETRY_LIMITS.fieldRegenerations
}

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

  if (input.gate.recommendedNextTransition === 'insufficient_basis') {
    return {
      policyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      mode: 'insufficient_basis',
      reason: 'The Gate found that the available basis cannot be repaired within the bounded Retry policy.',
      sameFieldRetryCount: input.sameFieldRetryCount,
      fieldRegenerationCount: input.fieldRegenerationCount,
      remainingSameFieldRetries,
      remainingFieldRegenerations,
    }
  }

  const fieldRetryRequired =
    input.duplicateTerminalFingerprint ||
    input.gate.recommendedNextTransition === 'retry_field'

  if (fieldRetryRequired && remainingFieldRegenerations > 0) {
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

  if (fieldRetryRequired) {
    return {
      policyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      mode: 'insufficient_basis',
      reason: input.duplicateTerminalFingerprint
        ? 'The terminal ecology duplicates a prior attempt and the bounded field-regeneration allowance is exhausted.'
        : 'The Gate requires field regeneration, but the bounded field-regeneration allowance is exhausted.',
      sameFieldRetryCount: input.sameFieldRetryCount,
      fieldRegenerationCount: input.fieldRegenerationCount,
      remainingSameFieldRetries,
      remainingFieldRegenerations,
    }
  }

  if (
    input.gate.recommendedNextTransition === 'retry_game' &&
    remainingSameFieldRetries > 0
  ) {
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

  if (
    input.gate.recommendedNextTransition === 'retry_game' &&
    remainingFieldRegenerations > 0
  ) {
    return {
      policyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      mode: 'regenerate_field',
      reason: 'The same-field replay allowance is exhausted, so Retry is using its one bounded field regeneration.',
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

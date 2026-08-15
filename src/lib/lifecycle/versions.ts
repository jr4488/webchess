export const WEBCHESS_SOFTWARE_VERSION = '2.2.0' as const
export const WEBCHESS_LIFECYCLE_VERSION = 'webchess-lifecycle-v2.4' as const
export const PORTIA_PROMPT_VERSION = 'webchess-portia-v4' as const
export const PORTIA_CONTRACT_VERSION = 'webchess-portia-review-v2' as const
export const GATE_ALGORITHM_VERSION = 'webchess-gate-v4' as const
export const RETRY_POLICY_VERSION = 'webchess-retry-v2' as const
export const CHARLOTTE_PROMPT_VERSION = 'webchess-charlotte-v4' as const
export const CHARLOTTE_CONTRACT_VERSION = 'webchess-charlotte-result-v1' as const
export const WILBUR_RECORD_VERSION = 'webchess-wilbur-v1' as const
export const LIFECYCLE_EVENT_VERSION = 1 as const

export const CURRENT_LIFECYCLE_VERSIONS = Object.freeze({
  software: WEBCHESS_SOFTWARE_VERSION,
  lifecycle: WEBCHESS_LIFECYCLE_VERSION,
  portiaPrompt: PORTIA_PROMPT_VERSION,
  portiaContract: PORTIA_CONTRACT_VERSION,
  gateAlgorithm: GATE_ALGORITHM_VERSION,
  retryPolicy: RETRY_POLICY_VERSION,
  charlottePrompt: CHARLOTTE_PROMPT_VERSION,
  charlotteContract: CHARLOTTE_CONTRACT_VERSION,
  wilburRecord: WILBUR_RECORD_VERSION,
  lifecycleEvent: LIFECYCLE_EVENT_VERSION,
})

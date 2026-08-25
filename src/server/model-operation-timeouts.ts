/** One logical Answer may use an initial turn and one corrective turn. */
export const ANSWER_OPERATION_TIMEOUT_MS = 300_000

/** Time reserved after provider cancellation for durable settlement and cleanup. */
export const MODEL_SETTLEMENT_GRACE_MS = 30_000

/** One provider turn remains independently bounded inside the Answer window. */
export const MODEL_TURN_TIMEOUT_MS = 150_000

/** Renewed before every turn: 150s work plus 30s durable settlement grace. */
export const MIN_MODEL_LEASE_SECONDS =
  (MODEL_TURN_TIMEOUT_MS + MODEL_SETTLEMENT_GRACE_MS) / 1_000

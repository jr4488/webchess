/** One logical Answer may use an initial turn and one corrective turn. */
export const ANSWER_OPERATION_TIMEOUT_MS = 300_000

/** Authenticated OpenClaw preflight, one provider turn, and postflight. */
export const MODEL_REQUEST_ENVELOPE_TIMEOUT_MS = 300_000

/** Loopback response drain beyond the authenticated model envelope. */
export const MODEL_REQUEST_RESPONSE_GRACE_MS = 5_000

/** Time reserved after provider cancellation for durable settlement and cleanup. */
export const MODEL_SETTLEMENT_GRACE_MS = 30_000

/**
 * The durable lease remains fenced after a logical model deadline only long
 * enough to drain the loopback response and persist a terminal settlement.
 */
export const MODEL_SETTLEMENT_HEADROOM_MS =
  MODEL_REQUEST_RESPONSE_GRACE_MS + MODEL_SETTLEMENT_GRACE_MS

/** One provider turn remains independently bounded inside the Answer window. */
export const MODEL_TURN_TIMEOUT_MS = 150_000

/**
 * Renewed before every turn: 300s authenticated request envelope, 5s loopback
 * response drain, and 30s durable database settlement. The provider remains
 * independently capped at 150s inside the request envelope.
 */
export const MIN_MODEL_LEASE_SECONDS =
  (
    MODEL_REQUEST_ENVELOPE_TIMEOUT_MS +
    MODEL_SETTLEMENT_HEADROOM_MS
  ) / 1_000

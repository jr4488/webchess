/**
 * Canonical current Arachne/WebChess method-version tuple.
 *
 * Keep this module dependency-free: release tooling imports the same runtime
 * object that the application and provider adapters re-export.
 */
export const CURRENT_METHOD_VERSION_TUPLE = Object.freeze({
  lifecycle: 'webchess-lifecycle-v2.5',
  divisionPrompt: 'webchess-division-v5',
  portiaPrompt: 'webchess-portia-v5',
  portiaReview: 'webchess-portia-review-v3',
  gateAlgorithm: 'webchess-gate-v5',
  answerPrompt: 'webchess-answer-v5',
  charlottePrompt: 'webchess-charlotte-v6',
})

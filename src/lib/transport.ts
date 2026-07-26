/**
 * Turn a failed request or interrupted response stream into a message that
 * tells the reader what to do.
 *
 * Both model routes stream NDJSON, so a connection that drops mid-run surfaces
 * as a `TypeError` from the body reader rather than an HTTP status. The
 * browser's own wording for that is bare — Chrome says "network error" — and it
 * reads as though the model refused the work, when in fact nothing reached the
 * model or the answer was lost on the way back.
 */
const TRANSPORT_MESSAGE =
  'The connection to WebChess was interrupted before the {operation} finished. ' +
  'Check that the server is still running, then try again.'

/**
 * A transport failure is a `TypeError`: `fetch` rejects with one when it cannot
 * reach the server, and the body reader throws one when an accepted response
 * stops arriving partway through.
 */
export function describeTransportFailure(error: unknown, operation: string): unknown {
  if (!(error instanceof TypeError)) return error

  const failure = new Error(TRANSPORT_MESSAGE.replace('{operation}', operation)) as
    Error & { cause?: unknown }
  failure.cause = error
  return failure
}

import { parseResponse } from 'openai/lib/ResponsesParser'

export const MODEL_RESPONSE_PHASES = Object.freeze([
  'connecting',
  'thinking',
  'drafting',
  'validating',
])

const DEFAULT_ACTIVITY_INTERVAL_MS = 1_000
const DEFAULT_MAX_REASONING_CHARS = 32_000

const SUMMARY_EVENT_TYPE = 'response.reasoning_summary_text.delta'
const RAW_EVENT_TYPE = 'response.reasoning_text.delta'

/**
 * Which reasoning events may be displayed, and how they must be labelled.
 *
 * The label cannot be derived from the event name. OpenAI-compatible local
 * servers emit their model's literal thinking under the `reasoning_summary`
 * event name, so the same event means "provider-authored summary written for
 * users" on the Platform and "the model's private thinking" on Ollama. Only
 * the caller knows which provider is answering, so only the caller can say
 * which of those two things the text actually is.
 *
 * - `summary`: OpenAI Platform reasoning summaries, intended for display.
 * - `raw`: a model's own thinking, forwarded only from a local provider.
 * - `off`: forward nothing.
 */
export const REASONING_EVENTS_BY_MODE = Object.freeze({
  summary: new Set([SUMMARY_EVENT_TYPE]),
  raw: new Set([SUMMARY_EVENT_TYPE, RAW_EVENT_TYPE]),
  off: new Set(),
})

const THINKING_EVENT_TYPES = new Set([SUMMARY_EVENT_TYPE, RAW_EVENT_TYPE])

const DRAFTING_EVENT_TYPES = new Set([
  'response.output_text.delta',
  'response.function_call_arguments.delta',
])

function responsesApi(client) {
  const responses = client?.responses
  if (!responses || typeof responses.parse !== 'function') {
    throw new TypeError('The model client must expose responses.parse().')
  }
  return responses
}

function progressCallback(value) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'function') {
    throw new TypeError('onProgress must be a function.')
  }
  return value
}

function activityInterval(value) {
  const interval = value ?? DEFAULT_ACTIVITY_INTERVAL_MS
  if (!Number.isSafeInteger(interval) || interval < 0) {
    throw new TypeError('activityIntervalMs must be a non-negative integer.')
  }
  return interval
}

function monotonicElapsed(now, startedAt) {
  const elapsed = now() - startedAt
  if (!Number.isFinite(elapsed)) {
    return 0
  }
  return Math.max(0, Math.trunc(elapsed))
}

function callWithRequestOptions(method, input, requestOptions) {
  return requestOptions === undefined
    ? method(input)
    : method(input, requestOptions)
}

function streamEventPhase(event) {
  const type = event && typeof event === 'object' ? event.type : undefined
  if (THINKING_EVENT_TYPES.has(type)) {
    return 'thinking'
  }
  if (DRAFTING_EVENT_TYPES.has(type)) {
    return 'drafting'
  }
  if (type === 'response.completed') {
    return 'validating'
  }
  return undefined
}

async function runRawResponseStream({
  responses,
  input,
  requestOptions,
  handleEvent,
}) {
  const responseStream = await callWithRequestOptions(
    responses.create.bind(responses),
    { ...input, stream: true },
    requestOptions,
  )
  if (!responseStream || typeof responseStream[Symbol.asyncIterator] !== 'function') {
    throw new TypeError(
      'responses.create() must return an async iterable for a streaming request.',
    )
  }

  let completedResponse
  for await (const providerEvent of responseStream) {
    await handleEvent(providerEvent)
    if (providerEvent?.type === 'response.completed') {
      completedResponse = providerEvent.response
    }
  }
  if (!completedResponse || typeof completedResponse !== 'object') {
    throw new Error('The model response stream ended before completion.')
  }
  return parseResponse(completedResponse, input)
}

/**
 * Run one Responses API request, exposing bounded activity metadata and, when
 * a caller opts in, the model's displayable reasoning text.
 *
 * Reasoning is forwarded only through `onReasoning`, tagged with its source, and
 * capped in total length. No other provider event payload is ever forwarded:
 * everything else is reduced to a phase name and a counter.
 */
export async function runParsedModelResponse({
  client,
  input,
  requestOptions,
  onProgress,
  onReasoning,
  reasoningMode = 'off',
  activityIntervalMs,
  maxReasoningChars = DEFAULT_MAX_REASONING_CHARS,
  now = Date.now,
} = {}) {
  const responses = responsesApi(client)
  const report = progressCallback(onProgress)
  const interval = activityInterval(activityIntervalMs)
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.')
  }
  if (!Number.isSafeInteger(maxReasoningChars) || maxReasoningChars < 0) {
    throw new TypeError('maxReasoningChars must be a non-negative integer.')
  }
  const displayableEvents = REASONING_EVENTS_BY_MODE[reasoningMode]
  if (!displayableEvents) {
    throw new TypeError('reasoningMode must be summary, raw, or off.')
  }
  const reportReasoning = displayableEvents.size > 0
    ? progressCallback(onReasoning)
    : undefined

  if (!report && !reportReasoning) {
    return callWithRequestOptions(
      responses.parse.bind(responses),
      input,
      requestOptions,
    )
  }

  const startedAt = now()
  let activityCount = 0
  let currentPhase
  let lastActivityReportAt = Number.NEGATIVE_INFINITY

  const emit = async (phase, force = false) => {
    if (!report) return
    const elapsedMs = monotonicElapsed(now, startedAt)
    const phaseChanged = phase !== currentPhase
    if (
      !force &&
      !phaseChanged &&
      elapsedMs - lastActivityReportAt < interval
    ) {
      return
    }
    currentPhase = phase
    lastActivityReportAt = elapsedMs
    await report(Object.freeze({
      phase,
      elapsedMs,
      activityCount,
    }))
  }

  let reasoningChars = 0
  const emitReasoning = async (event) => {
    if (!reportReasoning || !displayableEvents.has(event?.type)) return
    if (typeof event.delta !== 'string' || !event.delta) return

    const remaining = maxReasoningChars - reasoningChars
    if (remaining <= 0) return
    const delta = event.delta.slice(0, remaining)
    reasoningChars += delta.length
    await reportReasoning(Object.freeze({ source: reasoningMode, delta }))
  }

  await emit('connecting', true)

  if (typeof responses.stream !== 'function') {
    const result = await callWithRequestOptions(
      responses.parse.bind(responses),
      input,
      requestOptions,
    )
    await emit('validating', true)
    return result
  }

  let validatingReported = false
  const handleEvent = async (providerEvent) => {
    await emitReasoning(providerEvent)

    const phase = streamEventPhase(providerEvent)
    if (!phase) {
      return
    }
    if (phase === 'validating') {
      validatingReported = true
      await emit(phase, true)
      return
    }
    activityCount += 1
    await emit(phase)
  }

  if (typeof responses.create === 'function') {
    const result = await runRawResponseStream({
      responses,
      input,
      requestOptions,
      handleEvent,
    })
    if (!validatingReported) {
      await emit('validating', true)
    }
    return result
  }

  const responseStream = await callWithRequestOptions(
    responses.stream.bind(responses),
    input,
    requestOptions,
  )
  if (
    !responseStream ||
    typeof responseStream[Symbol.asyncIterator] !== 'function' ||
    typeof responseStream.finalResponse !== 'function'
  ) {
    throw new TypeError(
      'responses.stream() must return an async iterable with finalResponse().',
    )
  }

  for await (const providerEvent of responseStream) {
    await handleEvent(providerEvent)
  }
  if (!validatingReported) {
    await emit('validating', true)
  }
  return responseStream.finalResponse()
}

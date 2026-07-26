import { parseResponse } from 'openai/lib/ResponsesParser'

export const MODEL_RESPONSE_PHASES = Object.freeze([
  'connecting',
  'thinking',
  'drafting',
  'validating',
])

const DEFAULT_ACTIVITY_INTERVAL_MS = 1_000

const THINKING_EVENT_TYPES = new Set([
  'response.reasoning_summary_text.delta',
  'response.reasoning_text.delta',
])

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
 * Run one Responses API request while exposing only bounded activity metadata.
 *
 * Provider event payloads are intentionally never forwarded. In particular,
 * some compatible providers place raw private reasoning in fields whose event
 * names contain "reasoning_summary"; those fields must remain server-side.
 */
export async function runParsedModelResponse({
  client,
  input,
  requestOptions,
  onProgress,
  activityIntervalMs,
  now = Date.now,
} = {}) {
  const responses = responsesApi(client)
  const report = progressCallback(onProgress)
  const interval = activityInterval(activityIntervalMs)
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function.')
  }

  if (!report) {
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

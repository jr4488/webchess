import type {
  ModelActivityOperation,
  ModelActivityPhase,
  ModelActivityState,
} from '../types'

const ACTIVITY_CONTENT_TYPE = 'application/x-ndjson'
const MAX_RATIONALE_NOTES = 6
const MIN_RATIONALE_NOTE_LENGTH = 24
const MAX_RATIONALE_NOTE_LENGTH = 220
const MAX_ACTIVITY_EVENTS = 2_048
const MAX_NDJSON_LINE_CHARS = 512 * 1_024
const MAX_ACTIVITY_STREAM_CHARS = 2 * 1_024 * 1_024
const ACTIVITY_PHASES = new Set<ModelActivityPhase>([
  'request-accepted',
  'preparing-input',
  'awaiting-model',
  'thinking',
  'writing-rationale',
  'drafting',
  'validating-output',
  'complete',
])

export type ModelActivityEvent =
  | { type: 'phase'; phase: ModelActivityPhase }
  | { type: 'heartbeat' }
  | { type: 'provider_activity' }
  | { type: 'rationale'; text: string }
  | { type: 'result'; data: unknown }
  | {
      type: 'error'
      message: string
      status?: number
      code?: string
      prompt?: string
    }

export class ModelActivityStreamError extends Error {
  readonly status?: number
  readonly code?: string
  readonly prompt?: string

  constructor(
    message: string,
    details: { status?: number; code?: string; prompt?: string } = {},
  ) {
    super(message)
    this.name = 'ModelActivityStreamError'
    this.status = details.status
    this.code = details.code
    this.prompt = details.prompt
  }
}

export function modelActivityAcceptHeader(): string {
  return `${ACTIVITY_CONTENT_TYPE}, application/json`
}

export function beginModelActivity(
  operation: ModelActivityOperation,
  now = Date.now(),
): ModelActivityState {
  return {
    operation,
    status: 'active',
    phase: 'request-accepted',
    startedAt: now,
    lastHeartbeatAt: now,
    history: [{ phase: 'request-accepted', at: now }],
    rationaleNotes: [],
  }
}

function containsUnsafeRationaleControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true
    }
  }
  return false
}

function normalizeRationaleText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('The model activity stream returned an invalid public rationale.')
  }
  const text = value.replace(/\s+/gu, ' ').trim()
  if (
    text.length < MIN_RATIONALE_NOTE_LENGTH ||
    text.length > MAX_RATIONALE_NOTE_LENGTH ||
    containsUnsafeRationaleControl(text)
  ) {
    throw new Error('The model activity stream returned an invalid public rationale.')
  }
  return text
}

export function updateModelActivity(
  current: ModelActivityState,
  event: ModelActivityEvent,
  now = Date.now(),
): ModelActivityState {
  if (event.type === 'heartbeat') {
    return { ...current, lastHeartbeatAt: now }
  }
  if (event.type === 'provider_activity') {
    return {
      ...current,
      lastHeartbeatAt: now,
      lastProviderActivityAt: now,
    }
  }
  if (event.type === 'rationale') {
    const text = normalizeRationaleText(event.text)
    const duplicate = current.rationaleNotes.some(
      (note) => note.text.toLowerCase() === text.toLowerCase(),
    )
    return {
      ...current,
      lastHeartbeatAt: now,
      lastProviderActivityAt: now,
      rationaleNotes: duplicate
        ? current.rationaleNotes
        : [
            ...current.rationaleNotes.slice(-(MAX_RATIONALE_NOTES - 1)),
            { text, at: now },
          ],
    }
  }
  if (event.type === 'error') {
    return {
      ...current,
      status: 'error',
      lastHeartbeatAt: now,
    }
  }
  if (event.type !== 'phase') {
    return current
  }

  const repeated = current.phase === event.phase
  return {
    ...current,
    status: event.phase === 'complete' ? 'complete' : 'active',
    phase: event.phase,
    lastHeartbeatAt: now,
    history: repeated
      ? current.history
      : [...current.history, { phase: event.phase, at: now }],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseWireEvent(value: unknown): ModelActivityEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('The model activity stream returned a malformed event.')
  }

  if (value.type === 'heartbeat' || value.type === 'provider_activity') {
    return { type: value.type }
  }
  if (value.type === 'phase') {
    if (
      typeof value.phase !== 'string' ||
      !ACTIVITY_PHASES.has(value.phase as ModelActivityPhase)
    ) {
      throw new Error('The model activity stream returned an unknown phase.')
    }
    return { type: 'phase', phase: value.phase as ModelActivityPhase }
  }
  if (value.type === 'rationale') {
    return {
      type: 'rationale',
      text: normalizeRationaleText(value.text),
    }
  }
  if (value.type === 'result') {
    return { type: 'result', data: value.data }
  }
  if (value.type === 'error') {
    if (typeof value.message !== 'string' || value.message.trim().length === 0) {
      throw new Error('The model activity stream returned an incomplete error.')
    }
    return {
      type: 'error',
      message: value.message.trim(),
      ...(Number.isInteger(value.status) ? { status: Number(value.status) } : {}),
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    }
  }

  // Forward-compatible event kinds are ignored instead of becoming model text.
  return null
}

export async function readModelActivityPayload(
  response: Response,
  onActivity?: (event: ModelActivityEvent) => void,
): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes(ACTIVITY_CONTENT_TYPE)) {
    return response.json().catch(() => ({}))
  }
  if (!response.body) {
    throw new Error('The model activity stream did not provide a response body.')
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''
  let result: unknown
  let hasResult = false
  let terminalError: ModelActivityStreamError | undefined
  let terminalSeen = false
  let eventCount = 0
  let streamChars = 0

  const consumeLine = (line: string) => {
    if (terminalSeen) return
    if (!line.trim()) return
    eventCount += 1
    if (eventCount > MAX_ACTIVITY_EVENTS) {
      throw new Error('The model activity stream returned too many events.')
    }
    if (line.length > MAX_NDJSON_LINE_CHARS) {
      throw new Error('The model activity stream returned an oversized event.')
    }
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error('The model activity stream returned invalid JSON.')
    }
    const event = parseWireEvent(value)
    if (!event) return
    if (event.type === 'result') {
      result = event.data
      hasResult = true
      terminalSeen = true
      return
    }
    if (event.type === 'error') {
      onActivity?.(event)
      terminalError = new ModelActivityStreamError(event.message, event)
      terminalSeen = true
      return
    }
    onActivity?.(event)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const decoded = decoder.decode(value, { stream: true })
      streamChars += decoded.length
      if (streamChars > MAX_ACTIVITY_STREAM_CHARS) {
        throw new Error('The model activity stream exceeded its size limit.')
      }
      buffer += decoded
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(consumeLine)
      if (terminalSeen) {
        await reader.cancel().catch(() => undefined)
        break
      }
      if (buffer.length > MAX_NDJSON_LINE_CHARS) {
        throw new Error('The model activity stream returned an oversized event.')
      }
    }
    if (!terminalSeen) {
      buffer += decoder.decode()
      consumeLine(buffer)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  if (terminalError) throw terminalError
  if (!hasResult) {
    throw new Error('The model activity stream ended before returning a result.')
  }
  return result
}

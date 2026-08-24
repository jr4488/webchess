import 'server-only'

import type OpenAI from 'openai'

import { createSafetyIdentifier } from './safety'
import {
  DEFAULT_OPENAI_TIMEOUT_MS,
  MAX_OPENAI_TIMEOUT_MS,
  ModelConfigurationError,
  type ModelRequestContext,
  type OpenAIClientLike,
} from './types'

export interface ResolvedModelRequest {
  client: OpenAIClientLike
  requestOptions: OpenAI.RequestOptions
  safetyIdentifier: string
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_OPENAI_TIMEOUT_MS
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_OPENAI_TIMEOUT_MS
  ) {
    throw new ModelConfigurationError(
      `OpenAI timeout must be an integer from 1 to ${MAX_OPENAI_TIMEOUT_MS}.`,
    )
  }
  return timeoutMs
}

function combineRequestSignals(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const key = value.trim()
  if (key.length === 0 || key.length > 255) {
    throw new ModelConfigurationError(
      'OpenAI idempotency key must contain 1–255 characters.',
    )
  }
  return key
}

export function resolveModelRequest(
  context: ModelRequestContext,
): ResolvedModelRequest {
  if (!context || typeof context !== 'object') {
    throw new ModelConfigurationError('Model request context is required.')
  }
  const timeoutMs = normalizeTimeout(context.timeoutMs)
  const safetyIdentifier = createSafetyIdentifier(
    context.userId,
    context.safetyHmacSecret,
  )

  const client = context.client
  if (!client) {
    throw new ModelConfigurationError(
      'An injected OpenAI client is required for provider-contract tests; production model calls must use the account-authenticated OpenClaw generators.',
    )
  }

  if (!client.responses || typeof client.responses.create !== 'function') {
    throw new ModelConfigurationError(
      'The OpenAI client must expose responses.create().',
    )
  }

  const idempotencyKey = normalizeIdempotencyKey(context.idempotencyKey)
  return {
    client,
    safetyIdentifier,
    requestOptions: {
      signal: combineRequestSignals(context.signal, timeoutMs),
      timeout: timeoutMs,
      maxRetries: 0,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  }
}

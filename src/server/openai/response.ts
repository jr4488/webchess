import type { z } from 'zod'

import {
  ModelContractError,
  type NormalizedModelUsage,
} from './types'
import { normalizeModelUsage } from './usage'

export const MODEL_RESPONSE_FAILURE_STATUSES = [
  'invalid_response',
  'incomplete',
  'refused',
  'schema_invalid',
] as const

export type ModelResponseFailureStatus =
  (typeof MODEL_RESPONSE_FAILURE_STATUSES)[number]

export interface SafeModelResponseFailure {
  readonly providerId: string | null
  readonly model: string | null
  readonly status: ModelResponseFailureStatus
  readonly usage: NormalizedModelUsage
}

/**
 * A deliberately small accounting envelope for rejected provider responses.
 *
 * It never retains the response, output, refusal text, prompt, reasoning,
 * request input, or an error cause.
 */
export class ModelResponseError
  extends ModelContractError
  implements SafeModelResponseFailure {
  override name = 'ModelResponseError'
  readonly providerId: string | null
  readonly model: string | null
  readonly status: ModelResponseFailureStatus
  readonly usage: NormalizedModelUsage

  constructor(failure: SafeModelResponseFailure) {
    super('OpenAI returned a response that WebChess could not accept.')
    this.providerId = failure.providerId
    this.model = failure.model
    this.status = failure.status
    this.usage = Object.freeze({ ...failure.usage })
    Object.freeze(this)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function responseContainsRefusal(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.output)) return false

  return value.output.some((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return false
    return item.content.some((content) => {
      if (!isRecord(content)) return false
      return content.type === 'refusal' || (
        typeof content.refusal === 'string' &&
        content.refusal.trim().length > 0
      )
    })
  })
}

function responseOutputText(value: Record<string, unknown>): string | null {
  if (typeof value.output_text === 'string') {
    return value.output_text
  }
  if (!Array.isArray(value.output)) return null

  const fragments: string[] = []
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === 'output_text' &&
        typeof content.text === 'string'
      ) {
        fragments.push(content.text)
      }
    }
  }
  return fragments.length === 0 ? null : fragments.join('')
}

export interface CompletedParsedResponse<Output> {
  providerId: string
  model: string
  output: Output
  usage: NormalizedModelUsage
}

interface SanitizedResponseMetadata {
  providerId: string | null
  model: string | null
  usage: NormalizedModelUsage
}

function sanitizedProviderId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^[A-Za-z0-9_-]{1,255}$/u.test(normalized)
    ? normalized
    : null
}

function sanitizedModel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(normalized)
    ? normalized
    : null
}

function unreportedUsage(): NormalizedModelUsage {
  return normalizeModelUsage(undefined)
}

function responseMetadata(
  value: Record<string, unknown>,
): SanitizedResponseMetadata {
  return {
    providerId: sanitizedProviderId(value.id),
    model: sanitizedModel(value.model),
    usage: normalizeModelUsage(value.usage),
  }
}

function safeFailure(
  metadata: SanitizedResponseMetadata,
  status: ModelResponseFailureStatus,
): ModelResponseError {
  return new ModelResponseError({
    providerId: metadata.providerId,
    model: metadata.model,
    status,
    usage: metadata.usage,
  })
}

export function schemaInvalidResponseError(
  response: Pick<CompletedParsedResponse<unknown>, 'providerId' | 'model' | 'usage'>,
): ModelResponseError {
  return safeFailure(response, 'schema_invalid')
}

/**
 * Fail closed on incomplete, refused, or schema-invalid Responses output.
 */
export function parseCompletedResponse<Output>(
  value: unknown,
  schema: z.ZodType<Output>,
): CompletedParsedResponse<Output> {
  if (!isRecord(value)) {
    throw new ModelResponseError({
      providerId: null,
      model: null,
      status: 'invalid_response',
      usage: unreportedUsage(),
    })
  }

  let metadata: SanitizedResponseMetadata
  try {
    metadata = responseMetadata(value)
  } catch {
    throw new ModelResponseError({
      providerId: sanitizedProviderId(value.id),
      model: sanitizedModel(value.model),
      status: 'invalid_response',
      usage: unreportedUsage(),
    })
  }

  if (
    value.status !== 'completed' ||
    value.incomplete_details !== null
  ) {
    throw safeFailure(metadata, 'incomplete')
  }
  if (responseContainsRefusal(value)) {
    throw safeFailure(metadata, 'refused')
  }
  if (metadata.providerId === null || metadata.model === null) {
    throw safeFailure(metadata, 'invalid_response')
  }

  const outputText = responseOutputText(value)
  let output: unknown
  try {
    output = outputText === null ? undefined : JSON.parse(outputText)
  } catch {
    throw safeFailure(metadata, 'schema_invalid')
  }

  const parsed = schema.safeParse(output)
  if (!parsed.success) {
    throw safeFailure(metadata, 'schema_invalid')
  }

  return {
    providerId: metadata.providerId,
    model: metadata.model,
    output: parsed.data,
    usage: metadata.usage,
  }
}

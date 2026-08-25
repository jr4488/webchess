// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ANSWER_OPERATION_TIMEOUT_MS,
  MIN_MODEL_LEASE_SECONDS,
  MODEL_REQUEST_ENVELOPE_TIMEOUT_MS,
  MODEL_REQUEST_RESPONSE_GRACE_MS,
  MODEL_SETTLEMENT_GRACE_MS,
  MODEL_SETTLEMENT_HEADROOM_MS,
  MODEL_TURN_TIMEOUT_MS,
} from './model-operation-timeouts'

describe('model operation timeout envelope', () => {
  it('keeps provider, authenticated request, response, and settlement bounds explicit', () => {
    expect(MODEL_TURN_TIMEOUT_MS).toBe(150_000)
    expect(ANSWER_OPERATION_TIMEOUT_MS).toBe(300_000)
    expect(MODEL_REQUEST_ENVELOPE_TIMEOUT_MS).toBe(300_000)
    expect(MODEL_REQUEST_RESPONSE_GRACE_MS).toBe(5_000)
    expect(MODEL_SETTLEMENT_GRACE_MS).toBe(30_000)
    expect(MODEL_SETTLEMENT_HEADROOM_MS).toBe(35_000)
    expect(MIN_MODEL_LEASE_SECONDS).toBe(335)
  })

  it.each([
    'src/app/api/divide/route.ts',
    'src/app/api/games/[id]/answer/route.ts',
    'src/app/api/games/[id]/charlotte/route.ts',
    'src/app/api/games/[id]/retry/route.ts',
  ])('keeps %s outside the envelope, response drain, and settlement grace', (route) => {
    const source = readFileSync(resolve(process.cwd(), route), 'utf8')
    expect(source).toContain(`export const maxDuration = ${MIN_MODEL_LEASE_SECONDS}`)
  })

})

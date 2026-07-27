// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  createSafetyIdentifier,
  ModelConfigurationError,
  ModelContractError,
  normalizeModelUsage,
} from './index'

describe('OpenAI safety identifiers', () => {
  it('is stable, opaque, user-specific, secret-specific, and API-bounded', () => {
    const first = createSafetyIdentifier('user_abc', 'a'.repeat(32))
    const repeated = createSafetyIdentifier(' user_abc ', 'a'.repeat(32))
    const anotherUser = createSafetyIdentifier('user_xyz', 'a'.repeat(32))
    const anotherSecret = createSafetyIdentifier('user_abc', 'b'.repeat(32))

    expect(first).toBe(repeated)
    expect(first).not.toBe(anotherUser)
    expect(first).not.toBe(anotherSecret)
    expect(first).not.toContain('user_abc')
    expect(first).toMatch(/^wc_[A-Za-z0-9_-]{43}$/u)
    expect(first.length).toBeLessThanOrEqual(64)
  })

  it('rejects weak server secrets', () => {
    expect(() => createSafetyIdentifier('user_abc', 'too-short'))
      .toThrow(ModelConfigurationError)
  })
})

describe('OpenAI usage normalization', () => {
  it('distinguishes missing usage from an actual zero-token report', () => {
    expect(normalizeModelUsage(undefined)).toEqual({
      reported: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    })

    expect(normalizeModelUsage({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    }).reported).toBe(true)
  })

  it('rejects malformed accounting metadata', () => {
    expect(() => normalizeModelUsage({
      input_tokens: -1,
      output_tokens: 2,
      total_tokens: 1,
    })).toThrow(ModelContractError)
  })
})

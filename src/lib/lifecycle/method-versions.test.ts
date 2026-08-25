import { describe, expect, it } from 'vitest'

import {
  ANSWER_PROMPT_VERSION,
  DIVISION_PROMPT_VERSION,
} from '../../server/openai/types'
import { CURRENT_METHOD_VERSION_TUPLE } from './method-versions.mjs'
import {
  CHARLOTTE_PROMPT_VERSION,
  GATE_ALGORITHM_VERSION,
  PORTIA_CONTRACT_VERSION,
  PORTIA_PROMPT_VERSION,
  WEBCHESS_LIFECYCLE_VERSION,
} from './versions'

describe('canonical current method-version tuple', () => {
  it('is immutable and contains the exact seven reviewed stages', () => {
    expect(Object.isFrozen(CURRENT_METHOD_VERSION_TUPLE)).toBe(true)
    expect(CURRENT_METHOD_VERSION_TUPLE).toEqual({
      lifecycle: 'webchess-lifecycle-v2.5',
      divisionPrompt: 'webchess-division-v5',
      portiaPrompt: 'webchess-portia-v5',
      portiaReview: 'webchess-portia-review-v3',
      gateAlgorithm: 'webchess-gate-v5',
      answerPrompt: 'webchess-answer-v5',
      charlottePrompt: 'webchess-charlotte-v6',
    })
  })

  it('is the authority re-exported by lifecycle and provider modules', () => {
    expect(WEBCHESS_LIFECYCLE_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.lifecycle,
    )
    expect(DIVISION_PROMPT_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.divisionPrompt,
    )
    expect(PORTIA_PROMPT_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.portiaPrompt,
    )
    expect(PORTIA_CONTRACT_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.portiaReview,
    )
    expect(GATE_ALGORITHM_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.gateAlgorithm,
    )
    expect(ANSWER_PROMPT_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.answerPrompt,
    )
    expect(CHARLOTTE_PROMPT_VERSION).toBe(
      CURRENT_METHOD_VERSION_TUPLE.charlottePrompt,
    )
  })
})

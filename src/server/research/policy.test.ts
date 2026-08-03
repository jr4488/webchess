// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  RESEARCH_BOUNDS,
  RESEARCH_POLICY_VERSION,
  planResearchForStage,
} from './policy'

describe('visible research policy', () => {
  it('requires research for a current factual dependency', () => {
    const decision = planResearchForStage({
      stage: 'portia',
      problem: 'What is the current medical guidance for this treatment today?',
    })

    expect(decision).toEqual({
      needed: true,
      materiality: 'required',
      query: 'What is the current medical guidance for this treatment today? current authoritative sources evidence',
      reason: 'portia needs current external knowledge because the question contains a time-sensitive, regulated, or otherwise changeable factual dependency.',
    })
  })

  it('marks bounded research helpful for a technical recommendation', () => {
    const decision = planResearchForStage({
      stage: 'answer',
      problem: 'Give me a novel way to make LLMs faster.',
    })

    expect(decision).toEqual({
      needed: true,
      materiality: 'helpful',
      query: 'Give me a novel way to make LLMs faster. authoritative sources recent evidence',
      reason: 'answer requested bounded research because current external evidence can materially improve this technical, comparative, or recommendation question.',
    })
  })

  it('preserves the budget when no current or external fact is material', () => {
    expect(planResearchForStage({
      stage: 'charlotte',
      problem: 'Explain why this metaphor feels hopeful to a child.',
    })).toEqual({
      needed: false,
      materiality: null,
      query: null,
      reason: 'charlotte found no material current or external factual dependency, so the research budget was preserved.',
    })
  })

  it.each([
    [
      'chess',
      'What is the latest weather forecast for our tournament?',
      'Chess remains deterministic; external research cannot alter legal moves or board weights.',
    ],
    [
      'web',
      'What is the latest weather forecast for our tournament?',
      'Web records provenance but does not introduce new evidence after the answer lifecycle has finished.',
    ],
  ] as const)('never hides research inside the %s stage', (stage, problem, reason) => {
    expect(planResearchForStage({ stage, problem })).toEqual({
      needed: false,
      materiality: null,
      query: null,
      reason,
    })
  })

  it('publishes a single-invocation, bounded policy configuration', () => {
    expect(RESEARCH_POLICY_VERSION).toBe('webchess-visible-research-v1')
    expect(RESEARCH_BOUNDS).toEqual({
      invocationLimit: 1,
      resultLimit: 5,
      sourceLimit: 5,
      timeoutMs: 120_000,
      synthesisCharacterLimit: 12_000,
    })
  })
})

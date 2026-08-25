// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  RESEARCH_BOUNDS,
  RESEARCH_POLICY_VERSION,
  planResearchForStage,
} from './policy'

const ALLOW_EXTERNAL_RESEARCH = {
  decision: 'allow_search_and_page_fetch',
  version: 'webchess-research-consent-v1',
} as const

function researchInput(
  input: Omit<Parameters<typeof planResearchForStage>[0], 'researchConsent'>,
): Parameters<typeof planResearchForStage>[0] {
  return {
    ...input,
    researchConsent: ALLOW_EXTERNAL_RESEARCH,
  }
}

describe('visible research policy', () => {
  it('requires research for a current factual dependency', () => {
    const decision = planResearchForStage(researchInput({
      stage: 'portia',
      problem: 'What is the current medical guidance for this treatment today?',
    }))

    expect(decision).toEqual({
      needed: true,
      materiality: 'required',
      query: 'What is the current medical guidance for this treatment today? current authoritative sources evidence',
      reason: 'portia needs current external knowledge because the question contains a time-sensitive, regulated, or otherwise changeable factual dependency.',
    })
  })

  it('requires live research for the exact active-conflict question that was misclassified', () => {
    const decision = planResearchForStage(researchInput({
      stage: 'portia',
      problem: 'How will the war in Iran end?',
    }))

    expect(decision).toEqual({
      needed: true,
      materiality: 'required',
      query: 'How will the war in Iran end? current conflict status authoritative sources latest evidence',
      reason: 'portia requires live research because conflict and geopolitical conditions can change rapidly and cannot be answered safely from model memory alone.',
    })
  })

  it.each([
    'Could the current ceasefire hold?',
    'What are the likely outcomes of these peace talks?',
    'How could new sanctions change this diplomatic crisis?',
    'What happens after this military operation?',
  ])('requires research for volatile world-event wording: %s', (problem) => {
    expect(planResearchForStage(researchInput({
      stage: 'portia',
      problem,
    }))).toMatchObject({
      needed: true,
      materiality: 'required',
    })
  })

  it('marks bounded research helpful for a technical recommendation', () => {
    const decision = planResearchForStage(researchInput({
      stage: 'answer',
      problem: 'Give me a novel way to make LLMs faster.',
    }))

    expect(decision).toEqual({
      needed: true,
      materiality: 'helpful',
      query: 'Give me a novel way to make LLMs faster. authoritative sources recent evidence',
      reason: 'answer requested bounded research because current external evidence can materially improve this technical, comparative, or recommendation question.',
    })
  })

  it('preserves the budget when no current or external fact is material', () => {
    expect(planResearchForStage(researchInput({
      stage: 'charlotte',
      problem: 'Explain why this metaphor feels hopeful to a child.',
    }))).toEqual({
      needed: false,
      materiality: null,
      query: null,
      reason: 'charlotte found no material current or external factual dependency, so the research budget was preserved.',
    })
  })

  it('does not mistake an explicitly fictional war for a live geopolitical event', () => {
    expect(planResearchForStage(researchInput({
      stage: 'charlotte',
      problem: 'How should the war in my novel end?',
    }))).toEqual({
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
    expect(planResearchForStage(researchInput({ stage, problem }))).toEqual({
      needed: false,
      materiality: null,
      query: null,
      reason,
    })
  })

  it('records an explicit opt-out without classifying or constructing a query', () => {
    expect(planResearchForStage({
      stage: 'portia',
      problem: 'What is the latest medical guidance today?',
      researchConsent: {
        decision: 'no_external_research',
        version: 'webchess-research-consent-v1',
      },
    })).toEqual({
      needed: false,
      materiality: null,
      query: null,
      reason: 'External research was not run because this game records an explicit opt-out.',
    })
  })

  it('fails closed for a historical game with no recorded research consent', () => {
    expect(planResearchForStage({
      stage: 'answer',
      problem: 'Give me the latest technical recommendation.',
      researchConsent: {
        decision: 'no_external_research',
        version: 'legacy-no-research-consent-v0',
      },
    })).toEqual({
      needed: false,
      materiality: null,
      query: null,
      reason: 'External research was not run because this historical game has no recorded research consent.',
    })
  })

  it('publishes a single-invocation, bounded policy configuration', () => {
    expect(RESEARCH_POLICY_VERSION).toBe('webchess-visible-research-v4')
    expect(RESEARCH_BOUNDS).toEqual({
      invocationLimit: 1,
      resultLimit: 5,
      sourceLimit: 5,
      timeoutMs: 300_000,
      synthesisCharacterLimit: 12_000,
    })
  })
})

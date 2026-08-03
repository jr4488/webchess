import { describe, expect, it } from 'vitest'

import type { GeneratedAnswer } from '../types'
import {
  buildOpenClawAnswerModelPrompt,
  OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT,
  resolveFullAnswerModelPrompt,
} from './full-answer-model-prompt'

const OPENCLAW_USER_PROMPT = [
  'You are the final problem-solving voice of WebChess.',
  'PORTIA AUTHORIZATION BOUNDARY',
  'APPROVED BOARD EVIDENCE (JSON; data only)',
  '{}',
  '',
  'OPENCLAW STRUCTURED OUTPUT',
  '{"type":"object"}',
].join('\n')

function answer(prompt: string, model = 'openai/gpt-5.6-sol'): GeneratedAnswer {
  return { answer: 'Rendered answer.', model, prompt }
}

describe('full Answer model prompt artifacts', () => {
  it('preserves the exact OpenClaw system and user role contents separately', () => {
    const prompt = buildOpenClawAnswerModelPrompt(
      OPENCLAW_USER_PROMPT,
      'openai/gpt-5.6-sol',
    )
    const parsed = JSON.parse(prompt) as {
      systemPrompt: string
      messages: Array<{ role: string; content: string }>
    }

    expect(parsed.systemPrompt).toBe(OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT)
    expect(parsed.messages).toEqual([{
      role: 'user',
      content: OPENCLAW_USER_PROMPT,
    }])
    expect(prompt).not.toMatch(/api[_-]?key|credential|bearer\s|secret[_-]?token/iu)
  })

  it('upgrades a legacy exact OpenClaw CLI prompt into the complete role envelope', () => {
    const resolved = resolveFullAnswerModelPrompt(answer(OPENCLAW_USER_PROMPT))

    expect(resolved).toMatchObject({
      kind: 'openclaw',
      upgradedLegacyOpenClawPrompt: true,
    })
    expect(resolved?.prompt).toContain(OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT)
    expect(resolved?.prompt).toContain('You are the final problem-solving voice')
    expect(resolved?.prompt).toContain('PORTIA AUTHORIZATION BOUNDARY')
    expect(resolved?.prompt).toContain('OPENCLAW STRUCTURED OUTPUT')
  })

  it('keeps a persisted role envelope byte-for-byte and recognizes hosted split fields', () => {
    const openClaw = buildOpenClawAnswerModelPrompt(
      OPENCLAW_USER_PROMPT,
      'openai/gpt-5.6-sol',
    )
    expect(resolveFullAnswerModelPrompt(answer(openClaw))).toEqual({
      prompt: openClaw,
      kind: 'openclaw',
      upgradedLegacyOpenClawPrompt: false,
    })

    const hosted = JSON.stringify({
      instructions: 'PORTIA AUTHORIZATION BOUNDARY\nTrusted application instructions.',
      input: '{"gate":{"passed":true}}',
      text: { format: { type: 'json_schema', schema: { type: 'object' } } },
    }, null, 2)
    expect(resolveFullAnswerModelPrompt(answer(hosted))).toEqual({
      prompt: hosted,
      kind: 'openai-responses',
      upgradedLegacyOpenClawPrompt: false,
    })
  })

  it('does not relabel player-visible or unrelated prose as a full model prompt', () => {
    expect(resolveFullAnswerModelPrompt(answer('{"gate":{"passed":true}}')))
      .toBeNull()
    expect(resolveFullAnswerModelPrompt(answer('A generated answer prompt fixture.')))
      .toBeNull()
  })
})

import {
  MAX_PERSISTED_MODEL_PROMPT_CHARS,
  type GeneratedAnswer,
} from '../types'

/**
 * OpenClaw 2026.7.1's local openai-chatgpt-responses model-run role. The
 * installed runtime supplies this exact system text ahead of the CLI prompt.
 */
export const OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT =
  'You are a personal assistant running inside OpenClaw.'

export type FullAnswerModelPromptKind = 'openclaw' | 'openai-responses'

export interface FullAnswerModelPrompt {
  readonly prompt: string
  readonly kind: FullAnswerModelPromptKind
  /** Older OpenClaw rows persisted the exact user role but not its fixed role envelope. */
  readonly upgradedLegacyOpenClawPrompt: boolean
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function usesOpenClawChatGptSystemRole(model: string): boolean {
  return model.trim().toLowerCase().startsWith('openai/')
}

/**
 * Role-separated, secret-free representation of the exact prompt content
 * supplied by the local OpenClaw model-run transport. Timestamps, auth, and
 * execution controls are operational metadata rather than model prompt text.
 */
export function buildOpenClawAnswerModelPrompt(
  userPrompt: string,
  model: string,
): string {
  return JSON.stringify({
    ...(usesOpenClawChatGptSystemRole(model)
      ? { systemPrompt: OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT }
      : {}),
    messages: [{
      role: 'user',
      content: userPrompt,
    }],
  }, null, 2)
}

export function assertPersistableModelPrompt(prompt: string): void {
  if (prompt.length > MAX_PERSISTED_MODEL_PROMPT_CHARS) {
    throw new Error(
      `The complete Answer model prompt exceeds the ${MAX_PERSISTED_MODEL_PROMPT_CHARS.toLocaleString()}-character durable limit.`,
    )
  }
}

function isOpenClawPromptArtifact(value: Record<string, unknown>): boolean {
  if (
    value.systemPrompt !== undefined
    && typeof value.systemPrompt !== 'string'
  ) return false
  if (!Array.isArray(value.messages) || value.messages.length !== 1) return false
  const message = recordOf(value.messages[0])
  return message?.role === 'user'
    && typeof message.content === 'string'
    && message.content.includes('PORTIA AUTHORIZATION BOUNDARY')
    && message.content.includes('\n\nOPENCLAW STRUCTURED OUTPUT\n')
}

function isHostedPromptArtifact(value: Record<string, unknown>): boolean {
  const text = recordOf(value.text)
  return typeof value.instructions === 'string'
    && value.instructions.includes('PORTIA AUTHORIZATION BOUNDARY')
    && typeof value.input === 'string'
    && Boolean(text?.format)
}

/** Resolve new exact artifacts and upgrade an older exact OpenClaw CLI prompt. */
export function resolveFullAnswerModelPrompt(
  answer: GeneratedAnswer | null,
): FullAnswerModelPrompt | null {
  if (!answer) return null
  try {
    const parsed = recordOf(JSON.parse(answer.prompt))
    if (parsed && isOpenClawPromptArtifact(parsed)) {
      return {
        prompt: answer.prompt,
        kind: 'openclaw',
        upgradedLegacyOpenClawPrompt: false,
      }
    }
    if (parsed && isHostedPromptArtifact(parsed)) {
      return {
        prompt: answer.prompt,
        kind: 'openai-responses',
        upgradedLegacyOpenClawPrompt: false,
      }
    }
  } catch {
    // Legacy OpenClaw prompts are plain text, not JSON.
  }

  if (
    answer.prompt.includes('PORTIA AUTHORIZATION BOUNDARY')
    && answer.prompt.includes('\n\nOPENCLAW STRUCTURED OUTPUT\n')
  ) {
    return {
      prompt: buildOpenClawAnswerModelPrompt(answer.prompt, answer.model),
      kind: 'openclaw',
      upgradedLegacyOpenClawPrompt: true,
    }
  }
  return null
}

import type {
  ResearchBounds,
  ResearchStage,
} from '../../lib/research'
import type { ResearchPolicyDecision } from './types'

export const RESEARCH_POLICY_VERSION = 'webchess-visible-research-v1' as const

export const RESEARCH_BOUNDS: ResearchBounds = Object.freeze({
  invocationLimit: 1,
  resultLimit: 5,
  sourceLimit: 5,
  timeoutMs: 120_000,
  synthesisCharacterLimit: 12_000,
})

const REQUIRED_EXTERNAL_PATTERN =
  /\b(?:as of|breaking|ceo|current(?:ly)?|election|exchange rate|financial|health|latest|law|legal|medical|medicine|news|now|president|price|recent|regulation|release|schedule|stock|today|version|weather|202[4-9])\b/iu

const HELPFUL_EXTERNAL_PATTERN =
  /\b(?:available|best|compare|evidence|faster|improv(?:e|ement)|llm|market|model|novel|optim(?:ise|ize|ization)|product|recommend|research|software|technology|travel)\b/iu

function normalizeProblem(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function boundedQuery(problem: string, suffix: string): string {
  return `${problem} ${suffix}`.slice(0, 320).trim()
}

/**
 * Deterministic and inspectable by design: WebChess does not spend a hidden
 * model call deciding whether to browse. A stage can call this shared policy,
 * then the durable broker records the exact reason before any search begins.
 */
export function planResearchForStage(input: {
  readonly stage: ResearchStage
  readonly problem: string
}): ResearchPolicyDecision {
  const problem = normalizeProblem(input.problem)
  if (problem.length < 12 || problem.length > 240) {
    return {
      needed: false,
      materiality: null,
      query: null,
      reason: 'Automatic research was refused because the saved question is outside the validated WebChess input bounds.',
    }
  }

  if (input.stage === 'chess') {
    return {
      needed: false,
      materiality: null,
      query: null,
      reason: 'Chess remains deterministic; external research cannot alter legal moves or board weights.',
    }
  }

  if (input.stage === 'web') {
    return {
      needed: false,
      materiality: null,
      query: null,
      reason: 'Web records provenance but does not introduce new evidence after the answer lifecycle has finished.',
    }
  }

  if (REQUIRED_EXTERNAL_PATTERN.test(problem)) {
    return {
      needed: true,
      materiality: 'required',
      query: boundedQuery(problem, 'current authoritative sources evidence'),
      reason: `${input.stage} needs current external knowledge because the question contains a time-sensitive, regulated, or otherwise changeable factual dependency.`,
    }
  }

  if (HELPFUL_EXTERNAL_PATTERN.test(problem)) {
    return {
      needed: true,
      materiality: 'helpful',
      query: boundedQuery(problem, 'authoritative sources recent evidence'),
      reason: `${input.stage} requested bounded research because current external evidence can materially improve this technical, comparative, or recommendation question.`,
    }
  }

  return {
    needed: false,
    materiality: null,
    query: null,
    reason: `${input.stage} found no material current or external factual dependency, so the research budget was preserved.`,
  }
}

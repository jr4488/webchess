import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { replayGameEvents } from '@/lib/game-replay'
import { composeProblemParts } from '@/lib/division'
import type { ProblemPart } from '@/types'
import {
  buildDivisionPrompt,
  buildWebChessPrompt,
  DivisionOutputSchema,
  normalizeDivisionFacets,
  normalizeDivisionProblem,
  normalizeWebChessAnswer,
  parseServerDerivedEvidence,
  type ServerDerivedEvidence,
} from '@/server/openai'

import {
  modelAttribution,
  type OpenClawBridgeRequester,
  runOpenClawModel,
} from './cli'
import type { OpenClawConfig } from './config'
import { OpenClawPublicError } from './errors'

const MAX_GAME_EVENTS = 256

export const OpenClawDivideBodySchema = z.strictObject({
  problem: z.string(),
})

const DivisionSeedSchema = z.string().uuid()

export const OpenClawAnswerBodySchema = z.strictObject({
  problem: z.string(),
  division: z.strictObject({
    seed: DivisionSeedSchema,
    facets: DivisionOutputSchema.shape.facets,
  }),
  events: z.array(z.unknown()).max(MAX_GAME_EVENTS),
})

export type OpenClawAnswerBody = z.infer<typeof OpenClawAnswerBodySchema>

export interface OpenClawDivisionResult {
  division: {
    facets: z.infer<typeof DivisionOutputSchema>['facets']
    model: string
    parts: ProblemPart[]
    prompt: string
    seed: string
  }
}

export interface OpenClawAnswerResult {
  answer: {
    answer: string
    model: string
    prompt: string
  }
}

const DIVISION_JSON_CONTRACT = `OPENCLAW JSON OUTPUT
Return exactly one JSON object and no commentary. The object must have this shape:
{"facets":[{"id":1,"title":"...","focus":"...","question":"...","keyword":"..."}]}
The facets array must contain exactly 64 objects and must satisfy every requirement above.`

const ANSWER_JSON_CONTRACT = `OPENCLAW JSON OUTPUT
Return exactly one JSON object and no commentary. The object must have this shape:
{"answer":"...","what_the_conflicts_emphasized":"...","the_tension_to_hold":"...","three_next_moves":["...","...","..."],"what_could_change_the_answer":"..."}
Use only these five fields and satisfy every length, structure, and word-count requirement above.`

export function parseStructuredModelOutput(value: string): unknown {
  const trimmed = value.trim()
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed

  try {
    return JSON.parse(candidate) as unknown
  } catch {
    throw new OpenClawPublicError(
      'INVALID_MODEL_RESPONSE',
      502,
      'The configured OpenClaw model did not return valid structured JSON.',
    )
  }
}

function modelResponseError(): OpenClawPublicError {
  return new OpenClawPublicError(
    'INVALID_MODEL_RESPONSE',
    502,
    'The configured OpenClaw model did not satisfy the WebChess response contract.',
  )
}

function evidenceFromReplay(
  problem: string,
  replay: ReturnType<typeof replayGameEvents>,
): ServerDerivedEvidence {
  if (!replay.outcome) {
    throw new OpenClawPublicError(
      'GAME_NOT_COMPLETE',
      409,
      'Finish the local WebChess game before requesting its final reading.',
    )
  }

  return parseServerDerivedEvidence({
    problem,
    turnCount: replay.completedPlies,
    outcome: {
      winner: replay.outcome.winner,
      reason: replay.outcome.reason,
      completedTurn: replay.outcome.completedTurn,
    },
    captures: replay.captures.map((capture) => ({
      turn: capture.turn,
      resonance: capture.resonance,
      cell: {
        ring: capture.cell.ring,
        sector: capture.cell.sector,
      },
      attacker: {
        side: capture.attacker.side,
        kind: capture.attacker.kind,
      },
      captured: {
        side: capture.captured.side,
        kind: capture.captured.kind,
      },
      part: {
        id: capture.part.id,
        title: capture.part.title,
        focus: capture.part.focus,
        hexagram: capture.part.hexagram,
        hexagramName: capture.part.hexagramName,
        theme: capture.part.theme,
        dimension: capture.part.dimension,
        movement: capture.part.movement,
        prompt: capture.part.prompt,
        keyword: capture.part.keyword,
      },
    })),
  })
}

export async function generateOpenClawDivision(
  problemValue: unknown,
  config: OpenClawConfig,
  options: {
    request?: OpenClawBridgeRequester
    seed?: () => string
    signal?: AbortSignal
  } = {},
): Promise<OpenClawDivisionResult> {
  let problem: string
  try {
    problem = normalizeDivisionProblem(problemValue)
  } catch {
    throw new OpenClawPublicError(
      'INVALID_REQUEST',
      400,
      'The problem must contain 12–240 characters.',
    )
  }

  const prompt = `${buildDivisionPrompt(problem)}

${DIVISION_JSON_CONTRACT}`
  const generated = await runOpenClawModel(prompt, config, {
    request: options.request,
    signal: options.signal,
  })

  let facets: z.infer<typeof DivisionOutputSchema>['facets']
  try {
    facets = normalizeDivisionFacets(
      parseStructuredModelOutput(generated.outputText),
      problem,
    )
  } catch (error) {
    if (error instanceof OpenClawPublicError) throw error
    throw modelResponseError()
  }

  const seed = (options.seed ?? randomUUID)()
  const parts = composeProblemParts(facets, seed)
  return {
    division: {
      facets,
      model: modelAttribution(generated.provider, generated.model),
      parts,
      prompt,
      seed,
    },
  }
}

export async function generateOpenClawAnswer(
  input: OpenClawAnswerBody,
  config: OpenClawConfig,
  options: {
    request?: OpenClawBridgeRequester
    signal?: AbortSignal
  } = {},
): Promise<OpenClawAnswerResult> {
  let problem: string
  let facets: z.infer<typeof DivisionOutputSchema>['facets']
  try {
    problem = normalizeDivisionProblem(input.problem)
    facets = normalizeDivisionFacets(
      { facets: input.division.facets },
      problem,
    )
  } catch {
    throw new OpenClawPublicError(
      'INVALID_REQUEST',
      400,
      'The saved local division is not valid for this problem.',
    )
  }

  const parts = composeProblemParts(facets, input.division.seed)
  let replay: ReturnType<typeof replayGameEvents>
  try {
    replay = replayGameEvents(input.events, parts)
  } catch {
    throw new OpenClawPublicError(
      'INVALID_GAME_REPLAY',
      400,
      'The saved move history could not be replayed under the WebChess rules.',
    )
  }

  const evidence = evidenceFromReplay(problem, replay)
  const prompt = `${buildWebChessPrompt(evidence)}

${ANSWER_JSON_CONTRACT}`
  const generated = await runOpenClawModel(prompt, config, {
    request: options.request,
    signal: options.signal,
  })

  let answer: ReturnType<typeof normalizeWebChessAnswer>
  try {
    answer = normalizeWebChessAnswer(
      parseStructuredModelOutput(generated.outputText),
    )
  } catch (error) {
    if (error instanceof OpenClawPublicError) throw error
    throw modelResponseError()
  }

  return {
    answer: {
      answer: answer.answer,
      model: modelAttribution(generated.provider, generated.model),
      prompt,
    },
  }
}

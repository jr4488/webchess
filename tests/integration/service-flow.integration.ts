import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getLegalMoves,
  getPieceAt,
} from '../../src/lib/game'
import type { DurableGame } from '../../src/lib/webchess-api'
import { DurableGameRepository } from '../../src/server/games'
import {
  createApiServicesWithDependencies,
} from '../../src/server/http/service-adapter'
import {
  generateAnswer,
  generateDivision,
} from '../../src/server/openai'
import type {
  ServerDerivedEvidence,
} from '../../src/server/openai'
import {
  createUsageController,
} from '../../src/server/usage'
import type {
  UsageConfig,
} from '../../src/server/usage'
import type { ProblemFacet } from '../../src/types'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type {
  PostgresTestDatabase,
} from './postgres-test-database'

const NOW = new Date('2026-07-26T21:00:00.000Z')
const OWNER = 'user_service_flow_integration'
const IP_ADDRESS = '203.0.113.72'
const PROBLEM =
  'Which durable and reversible next step should this complete service flow test?'
const DIVISION_REQUEST_ID = '31000000-0000-4000-8000-000000000001'
const ANSWER_REQUEST_ID = '31000000-0000-4000-8000-000000000002'
const SOFTWARE_VERSION = 'service-flow-integration'
const HMAC_SECRET = 'service-flow-hmac-secret-material'.repeat(2)
const DELETION_HMAC_SECRET =
  'service-flow-deletion-secret-material'.repeat(2)

const USAGE_CONFIG: UsageConfig = {
  hmacSecret: HMAC_SECRET,
  deletionHmacSecret: DELETION_HMAC_SECRET,
  dailyGameLimit: 10,
  dailyModelRequestLimit: 20,
  dailyGlobalModelRequestLimit: 40,
  hourlyModelRequestLimit: 20,
  hourlyIpModelRequestLimit: 40,
  hourlyGameStartLimit: 20,
  hourlyIpGameStartLimit: 40,
  hourlyGameMoveLimit: 1_000,
  hourlyIpGameMoveLimit: 2_000,
  hourlyAccountExportLimit: 10,
  hourlyIpAccountExportLimit: 20,
  concurrentModelLimit: 1,
  globalModelConcurrentLimit: 4,
  modelLeaseSeconds: 180,
}

const FACETS: readonly ProblemFacet[] = Array.from(
  { length: 64 },
  (_, index) => {
    const id = index + 1
    return {
      id,
      title: `Service flow signal ${id}`,
      focus: `The distinct service flow condition represented by durable signal ${id}.`,
      question: `Which observation would clarify durable signal ${id}?`,
      keyword: `durable signal ${id}`,
    }
  },
)

function operationId(index: number): string {
  return `32000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function requireState(game: DurableGame) {
  if (!game.state) {
    throw new Error(`Game ${game.id} has no replayable state.`)
  }
  return game.state
}

function nextDeterministicMove(game: DurableGame): {
  readonly pieceId: string
  readonly to: {
    readonly ring: number
    readonly sector: number
  }
} {
  const state = requireState(game)
  const candidates = state.pieces
    .filter((piece) => piece.side === state.turn)
    .flatMap((piece) =>
      getLegalMoves(piece, state.pieces).map((to) => {
        const captured = getPieceAt(state.pieces, to)
        const promotes =
          piece.kind === 'pawn' &&
          (
            (piece.side === 'white' && to.ring === 0) ||
            (piece.side === 'black' && to.ring === 7)
          )
        const score = captured?.kind === 'king'
          ? 3
          : captured
            ? 2
            : promotes
              ? 1
              : 0
        return {
          pieceId: piece.id,
          score,
          to,
        }
      }),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.pieceId.localeCompare(right.pieceId) ||
        left.to.ring - right.to.ring ||
        left.to.sector - right.to.sector,
    )

  const selected = candidates[0]
  if (!selected) {
    throw new Error(`No legal ${state.turn} service-flow move was available.`)
  }
  return {
    pieceId: selected.pieceId,
    to: selected.to,
  }
}

let database: PostgresTestDatabase
let leaseSequence: number
let answerEvidence: ServerDerivedEvidence | null

const divisionGenerator: typeof generateDivision = vi.fn(async () => ({
  providerId: 'resp_service_flow_division',
  model: 'gpt-5.6-sol',
  prompt: 'Deterministic service-flow division prompt.',
  result: {
    facets: [...FACETS],
  },
  usage: {
    reported: true,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cachedInputTokens: 20,
    cacheWriteInputTokens: 5,
    reasoningOutputTokens: 20,
  },
}))

const answerGenerator: typeof generateAnswer = vi.fn(async (evidence) => {
  answerEvidence = evidence
  return {
    providerId: 'resp_service_flow_answer',
    model: 'gpt-5.6-sol',
    prompt: 'Deterministic service-flow answer prompt.',
    result: {
      answer: 'Persist the smallest reversible next step, observe it, and reassess.',
      sections: {
        answer: 'Persist the smallest reversible next step and reassess.',
        what_the_conflicts_emphasized:
          'The durable replay preserved each conflict used by this test.',
        the_tension_to_hold:
          'Keep reliability and reversibility visible at the same time.',
        three_next_moves: [
          'Record the smallest concrete experiment before beginning it.',
          'Observe one result that could change the current direction.',
          'Revisit the durable record before expanding the commitment.',
        ],
        what_could_change_the_answer:
          'New evidence from the reversible experiment should trigger review.',
      },
      wordCount: 500,
    },
    usage: {
      reported: true,
      inputTokens: 80,
      outputTokens: 60,
      totalTokens: 140,
      cachedInputTokens: 10,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 25,
    },
  }
})

function createServices() {
  const repository = new DurableGameRepository(database.adapter)
  const usage = createUsageController({
    db: database.adapter,
    config: USAGE_CONFIG,
    now: () => new Date(NOW),
    randomUuid: () => {
      leaseSequence += 1
      return `33000000-0000-4000-8000-${String(leaseSequence).padStart(12, '0')}`
    },
  })
  return {
    repository,
    services: createApiServicesWithDependencies({
      accountExportMaxBytes: 3_000_000,
      answerGenerator,
      database: database.adapter,
      divisionGenerator,
      hmacSecret: HMAC_SECRET,
      openAiApiKey: 'sk-integration-stub-never-sent',
      repository,
      softwareVersion: SOFTWARE_VERSION,
      usage,
    }),
    usage,
  }
}

function operationContext(id: string) {
  return {
    idempotencyKey: id,
    ipAddress: IP_ADDRESS,
    requestId: id,
    signal: new AbortController().signal,
  }
}

beforeEach(async () => {
  database = await createPostgresTestDatabase('service_flow')
  await database.migrate()
  leaseSequence = 0
  answerEvidence = null
  vi.mocked(divisionGenerator).mockClear()
  vi.mocked(answerGenerator).mockClear()
})

afterEach(async () => {
  await database.dispose()
})

describe('complete API service flow against PostgreSQL', () => {
  it('persists divide, play, answer, usage, and refresh recovery', async () => {
    const { services } = createServices()
    let game = await services.divide({
      ownerId: OWNER,
      problem: PROBLEM,
      ...operationContext(DIVISION_REQUEST_ID),
      idempotencyKey: operationId(1),
      requestId: DIVISION_REQUEST_ID,
    })

    expect(game).toMatchObject({
      id: DIVISION_REQUEST_ID,
      revision: 1,
      status: 'mapped',
      problem: PROBLEM,
      division: {
        facets: expect.arrayContaining([
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 64 }),
        ]),
        model: 'gpt-5.6-sol',
      },
    })
    expect(game.division?.facets).toHaveLength(64)
    expect(divisionGenerator).toHaveBeenCalledOnce()

    game = await services.startGame({
      ownerId: OWNER,
      gameId: game.id,
      expectedRevision: game.revision,
      ...operationContext(operationId(2)),
    })
    expect(game.status).toBe('playing')
    expect(requireState(game).completedPlies).toBe(0)

    let clientMoveCount = 0
    while (!requireState(game).outcome) {
      const move = nextDeterministicMove(game)
      clientMoveCount += 1
      const operation = operationId(100 + clientMoveCount)
      game = await services.move({
        ownerId: OWNER,
        gameId: game.id,
        expectedRevision: game.revision,
        pieceId: move.pieceId,
        to: move.to,
        ...operationContext(operation),
      })
      if (clientMoveCount > 270) {
        throw new Error('The service-flow game exceeded its bounded replay.')
      }
    }

    const terminalState = requireState(game)
    expect(game.status).toBe('completed')
    expect(terminalState.outcome).not.toBeNull()
    expect(terminalState.events.length).toBeGreaterThanOrEqual(
      clientMoveCount,
    )

    const answered = await services.answer({
      ownerId: OWNER,
      gameId: game.id,
      expectedRevision: game.revision,
      ...operationContext(ANSWER_REQUEST_ID),
      idempotencyKey: operationId(900),
      requestId: ANSWER_REQUEST_ID,
    })
    game = answered.game
    expect(game.status).toBe('answered')
    expect(answered.answer).toEqual({
      answer: 'Persist the smallest reversible next step, observe it, and reassess.',
      model: 'gpt-5.6-sol',
      prompt: 'Deterministic service-flow answer prompt.',
    })
    expect(answerGenerator).toHaveBeenCalledOnce()
    expect(answerEvidence).toMatchObject({
      problem: PROBLEM,
      turnCount: terminalState.completedPlies,
      outcome: {
        winner: terminalState.outcome?.winner,
        reason: terminalState.outcome?.reason,
        completedTurn: terminalState.outcome?.completedTurn,
      },
    })
    expect(answerEvidence?.captures).toHaveLength(
      terminalState.captures.length,
    )

    const firstCurrent = await services.getCurrentGame({
      ownerId: OWNER,
      requestId: operationId(901),
      signal: new AbortController().signal,
    })
    expect(firstCurrent).toMatchObject({
      id: game.id,
      revision: game.revision,
      status: 'answered',
      answer: answered.answer,
    })

    const reloaded = createServices()
    const recovered = await reloaded.services.getCurrentGame({
      ownerId: OWNER,
      requestId: operationId(902),
      signal: new AbortController().signal,
    })
    expect(recovered).toMatchObject({
      id: game.id,
      revision: game.revision,
      status: 'answered',
      problem: PROBLEM,
      answer: answered.answer,
      state: {
        completedPlies: terminalState.completedPlies,
        outcome: terminalState.outcome,
      },
    })
    expect(recovered?.state?.events).toEqual(terminalState.events)
    expect(divisionGenerator).toHaveBeenCalledOnce()
    expect(answerGenerator).toHaveBeenCalledOnce()

    await expect(
      reloaded.services.getAccountUsage({
        ownerId: OWNER,
        requestId: operationId(903),
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      modelOperations: {
        used: 2,
        reserved: 0,
        limit: USAGE_CONFIG.dailyModelRequestLimit,
      },
      gameStarts: {
        used: 1,
        reserved: 0,
        limit: USAGE_CONFIG.dailyGameLimit,
      },
      activeModelRequests: 0,
    })

    const durableGame = await database.adapter.query({
      text: `
        SELECT
          status,
          revision::integer,
          outcome ->> 'reason' AS outcome_reason,
          answer_payload ->> 'answer' AS answer
        FROM games
        WHERE id = $1::uuid
      `,
      values: [game.id],
    })
    expect(durableGame.rows).toEqual([{
      status: 'answered',
      revision: game.revision,
      outcome_reason: terminalState.outcome?.reason,
      answer: answered.answer.answer,
    }])

    const durableEvents = await database.adapter.query({
      text: `
        SELECT
          count(*)::integer AS total,
          count(*) FILTER (WHERE source = 'client')::integer AS client_moves,
          max(ply)::integer AS final_ply
        FROM game_events
        WHERE game_id = $1::uuid
      `,
      values: [game.id],
    })
    expect(durableEvents.rows).toEqual([{
      total: terminalState.events.length,
      client_moves: clientMoveCount,
      final_ply: terminalState.completedPlies,
    }])

    const ledger = await database.adapter.query({
      text: `
        SELECT
          operation,
          status,
          provider_response_id,
          usage_reported,
          input_tokens::integer,
          output_tokens::integer,
          reasoning_tokens::integer,
          total_tokens::integer,
          result_payload ->> 'format' AS result_format
        FROM model_requests
        WHERE clerk_user_id = $1
        ORDER BY operation
      `,
      values: [OWNER],
    })
    expect(ledger.rows).toEqual([
      {
        operation: 'answer',
        status: 'succeeded',
        provider_response_id: 'resp_service_flow_answer',
        usage_reported: true,
        input_tokens: 80,
        output_tokens: 60,
        reasoning_tokens: 25,
        total_tokens: 140,
        result_format: 'webchess-answer-result/1',
      },
      {
        operation: 'division',
        status: 'succeeded',
        provider_response_id: 'resp_service_flow_division',
        usage_reported: true,
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: 20,
        total_tokens: 150,
        result_format: 'webchess-division-result/1',
      },
    ])

    const usageBuckets = await database.adapter.query({
      text: `
        SELECT
          subject_type,
          metric,
          used::integer,
          reserved::integer
        FROM usage_buckets
        WHERE
          subject_type = 'global'
          OR subject_key = $1
        ORDER BY subject_type, metric
      `,
      values: [OWNER],
    })
    expect(usageBuckets.rows).toEqual([
      {
        subject_type: 'global',
        metric: 'model_requests',
        used: 2,
        reserved: 0,
      },
      {
        subject_type: 'user',
        metric: 'game_starts',
        used: 1,
        reserved: 0,
      },
      {
        subject_type: 'user',
        metric: 'model_requests',
        used: 2,
        reserved: 0,
      },
    ])

    const moveRates = await database.adapter.query({
      text: `
        SELECT
          key_type,
          count
        FROM rate_buckets
        WHERE action = 'game_move'
        ORDER BY key_type
      `,
    })
    expect(moveRates.rows).toEqual([
      { key_type: 'ip', count: clientMoveCount },
      { key_type: 'user', count: clientMoveCount },
    ])

    const replayId = operationId(904)
    const replayed = await reloaded.services.replay({
      ownerId: OWNER,
      gameId: game.id,
      expectedRevision: game.revision,
      ...operationContext(replayId),
    })
    expect(replayed).toMatchObject({
      id: replayId,
      sourceGameId: game.id,
      revision: 0,
      status: 'mapped',
    })

    const exported = await reloaded.services.exportAccount({
      ownerId: OWNER,
      ipAddress: IP_ADDRESS,
      requestId: operationId(905),
      signal: new AbortController().signal,
    })
    expect(exported).toMatchObject({
      gameStartRequests: [{
        idempotencyKey: replayId,
        kind: 'replay',
        sourceGameId: game.id,
        expectedRevision: String(game.revision),
        activatedAt: NOW.toISOString(),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }],
    })
  })
})

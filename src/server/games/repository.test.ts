// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  CURRENT_GAME_VERSIONS,
} from '../../lib/game-contract'
import { composeProblemParts } from '../../lib/division'
import type { GameEvent, ReplayState } from '../../lib/game-contract'
import {
  acceptMoveCommand,
  createReplayState,
} from '../../lib/game-replay'
import {
  getLegalMoves,
  hasLegalMove,
} from '../../lib/game'
import { makeProblemFacets } from '../../test/fixtures'
import type { ProblemPart } from '../../types'
import {
  hashCanonicalJson,
  sha256Hex,
} from '../db'
import type {
  CanonicalJson,
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
  SqlTransactionOptions,
} from '../db'
import {
  GameRepositoryError,
  isGameRepositoryError,
} from './errors'
import {
  computeDivisionDigest,
  DurableGameRepository,
  normalizeProblem,
} from './repository'

const OWNER_ID = 'user_repository_test'
const OTHER_OWNER_ID = 'user_other_test'
const GAME_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-07-26T20:00:00.000Z'
const PROBLEM = 'How should I make this durable decision?'
const SEED = 'repository-seed'
const MODEL = 'gpt-5.6-sol'
const PROMPT_VERSION = 'division-v1'
const PROMPT = 'Canonical division prompt for repository tests.'
const FACETS = makeProblemFacets('Repository facet')
const PARTS = composeProblemParts(FACETS, SEED)
const RESEARCH_CONSENT = {
  version: 'webchess-research-consent-v1',
  decision: 'allow_search_and_page_fetch',
} as const

function jsonValue(value: unknown): CanonicalJson {
  return JSON.parse(JSON.stringify(value)) as CanonicalJson
}

function result<Row extends SqlRow>(
  rows: readonly Row[],
  command = 'SELECT',
): SqlResult<Row> {
  return {
    command,
    rowCount: rows.length,
    rows,
  }
}

interface ScriptStep {
  readonly includes: string
  readonly rows: readonly SqlRow[]
}

class ScriptedAdapter implements SqlAdapter {
  readonly calls: SqlStatement[] = []
  readonly transactions: Array<{
    readonly statements: readonly SqlStatement[]
    readonly options: SqlTransactionOptions
  }> = []

  constructor(private readonly steps: ScriptStep[]) {}

  async query<Row extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>> {
    this.calls.push(statement)
    const step = this.steps.shift()
    if (!step) {
      throw new Error(`Unexpected SQL query: ${statement.text}`)
    }
    expect(statement.text).toContain(step.includes)
    return result(step.rows as readonly Row[])
  }

  async transaction(
    statements: readonly SqlStatement[],
    options: SqlTransactionOptions = {},
  ): Promise<readonly SqlResult[]> {
    this.transactions.push({ statements, options })
    expect(statements).toHaveLength(2)
    expect(statements[0]?.text).toContain(
      "hashtextextended('webchess-usage-reservation-v1', 0)",
    )
    const mutation = statements[1]
    if (!mutation) {
      throw new Error('Missing scripted transaction mutation.')
    }
    return [
      result([{ held: null }]),
      await this.query(mutation),
    ]
  }

  expectComplete(): void {
    expect(this.steps).toEqual([])
  }
}

function divisionDigest(): string {
  return computeDivisionDigest({
    problemSha256: sha256Hex(PROBLEM),
    seed: SEED,
    facets: FACETS,
    parts: PARTS,
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    promptSha256: sha256Hex(PROMPT),
  })
}

function gameRow(
  overrides: Partial<Record<string, unknown>> = {},
): SqlRow {
  return {
    id: GAME_ID,
    clerk_user_id: OWNER_ID,
    source_game_id: null,
    is_current: true,
    revision: '2',
    status: 'playing',
    problem: PROBLEM,
    problem_sha256: sha256Hex(PROBLEM),
    research_consent_version: RESEARCH_CONSENT.version,
    research_consent_decision: RESEARCH_CONSENT.decision,
    research_consent_recorded_at: NOW,
    division_seed: SEED,
    division_facets: FACETS,
    problem_parts: PARTS,
    division_model: MODEL,
    division_prompt_version: PROMPT_VERSION,
    division_prompt_sha256: sha256Hex(PROMPT),
    division_digest: divisionDigest(),
    event_version: CURRENT_GAME_VERSIONS.event,
    rules_version: CURRENT_GAME_VERSIONS.rules,
    engine_version: CURRENT_GAME_VERSIONS.engine,
    cast_version: CURRENT_GAME_VERSIONS.cast,
    software_version: '0.2.0-test',
    outcome: null,
    answer_payload: null,
    created_at: NOW,
    updated_at: NOW,
    completed_at: null,
    answered_at: null,
    ...overrides,
  }
}

function eventRows(
  events: readonly GameEvent[],
  revisions: readonly number[] = events.map((event) => event.ply),
): SqlRow[] {
  return events.map((event, index) => {
    if (event.type === 'forced-pass') {
      return {
        game_id: GAME_ID,
        ply: event.ply,
        kind: 'pass',
        source: 'server',
        side: event.side,
        piece_id: null,
        captured_piece_id: null,
        promoted_to: null,
        from_ring: null,
        from_sector: null,
        to_ring: null,
        to_sector: null,
        idempotency_key: null,
        request_sha256: null,
        game_revision: String(revisions[index]),
        created_at: NOW,
      }
    }
    return {
      game_id: GAME_ID,
      ply: event.ply,
      kind: 'move',
      source: 'client',
      side: event.side,
      piece_id: event.pieceId,
      captured_piece_id: event.capturedPieceId ?? null,
      promoted_to: event.promotedTo ?? null,
      from_ring: event.from.ring,
      from_sector: event.from.sector,
      to_ring: event.to.ring,
      to_sector: event.to.sector,
      idempotency_key:
        index === events.length - 1 ? IDEMPOTENCY_KEY : crypto.randomUUID(),
      request_sha256: 'a'.repeat(64),
      game_revision: String(revisions[index]),
      created_at: NOW,
    }
  })
}

function firstMoveState(): ReplayState {
  return acceptMoveCommand(
    createReplayState(),
    {
      expectedPly: 1,
      pieceId: 'white-pawn-1',
      to: { ring: 4, sector: 0 },
    },
    PARTS,
  ).state
}

function dividingRow(
  overrides: Partial<Record<string, unknown>> = {},
): SqlRow {
  return gameRow({
    revision: '0',
    status: 'dividing',
    division_seed: null,
    division_facets: null,
    problem_parts: null,
    division_model: null,
    division_prompt_version: null,
    division_prompt_sha256: null,
    division_digest: null,
    ...overrides,
  })
}

function playTerminalGame(parts: readonly ProblemPart[]): ReplayState {
  let state = createReplayState()
  while (!state.outcome) {
    if (!hasLegalMove(state.pieces, state.turn)) {
      throw new Error('Repository terminal fixture unexpectedly required a pass.')
    }
    const piece = state.pieces.find(
      (candidate) =>
        candidate.side === state.turn &&
        getLegalMoves(candidate, state.pieces).length > 0,
    )
    if (!piece) {
      throw new Error('Repository terminal fixture has no legal piece.')
    }
    const to = getLegalMoves(piece, state.pieces)[0]
    state = acceptMoveCommand(
      state,
      {
        expectedPly: state.completedPlies + 1,
        pieceId: piece.id,
        to,
      },
      parts,
    ).state
  }
  return state
}

let cachedTerminal: ReplayState | undefined

function terminalFixture(): ReplayState {
  cachedTerminal ??= playTerminalGame(PARTS)
  return cachedTerminal
}

function terminalRow(
  status: 'completed' | 'answering' | 'answer_failed' | 'answered' = 'completed',
  overrides: Partial<Record<string, unknown>> = {},
): SqlRow {
  const terminal = terminalFixture()
  return gameRow({
    revision: String(terminal.events.length),
    status,
    outcome: jsonValue(terminal.outcome),
    completed_at: NOW,
    answer_payload: status === 'answered'
      ? {
          answer: 'The durable reading.',
          model: MODEL,
          prompt: 'Canonical answer prompt.',
        }
      : null,
    answered_at: status === 'answered' ? NOW : null,
    ...overrides,
  })
}

function terminalEventRows(): SqlRow[] {
  const terminal = terminalFixture()
  return eventRows(
    terminal.events,
    terminal.events.map((_, index) => index + 1),
  )
}

function finishInput(
  overrides: Record<string, unknown> = {},
) {
  return {
    ownerId: OWNER_ID,
    gameId: GAME_ID,
    expectedRevision: 0,
    analysis: {
      facets: FACETS,
      seed: SEED,
      model: MODEL,
      prompt: PROMPT,
    },
    parts: PARTS,
    promptVersion: PROMPT_VERSION,
    ...overrides,
  }
}

describe('durable game lifecycle', () => {
  it('requires an explicit current research choice before creating a root game', async () => {
    const repository = new DurableGameRepository(new ScriptedAdapter([]))
    await expect(repository.createDivision({
      ownerId: OWNER_ID,
      problem: PROBLEM,
      softwareVersion: '0.2.0-test',
      gameId: GAME_ID,
    })).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('creates an owner-bound current division without requiring runtime secrets', async () => {
    const database = new ScriptedAdapter([
      {
        includes: 'WITH existing AS',
        rows: [{ ...dividingRow(), created: true }],
      },
    ])
    const repository = new DurableGameRepository(database)

    const game = await repository.createDivision({
      ownerId: OWNER_ID,
      problem: `  ${PROBLEM}  `,
      softwareVersion: '0.2.0-test',
      researchConsent: RESEARCH_CONSENT,
      gameId: GAME_ID,
    })

    expect(game).toMatchObject({
      id: GAME_ID,
      status: 'dividing',
      revision: 0,
      problem: PROBLEM,
      researchConsent: {
        ...RESEARCH_CONSENT,
        recordedAt: NOW,
      },
      division: null,
      game: null,
    })
    expect(database.calls[0]?.values).toEqual([
      OWNER_ID,
      GAME_ID,
      PROBLEM,
      sha256Hex(PROBLEM),
      CURRENT_GAME_VERSIONS.event,
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      CURRENT_GAME_VERSIONS.cast,
      '0.2.0-test',
      null,
      RESEARCH_CONSENT.version,
      RESEARCH_CONSENT.decision,
      null,
    ])
    expect(database.calls[0]?.text).not.toContain(
      'INSERT INTO user_controls',
    )
    expect(database.calls[0]?.text).toContain(
      'JOIN model_requests AS requests',
    )
    expect(database.calls[0]?.text).toContain(
      "requests.status IN ('reserved', 'in_progress')",
    )
    expect(database.calls[0]?.text).toContain(
      'AND NOT controls.suspended',
    )
    expect(database.calls[0]?.text).toContain(
      "'ACCOUNT_DELETION_PENDING'",
    )
    expect(database.calls[0]?.text).toContain(
      'FOR UPDATE OF controls, requests',
    )
    expect(database.transactions[0]?.options).toEqual({
      isolationLevel: 'ReadCommitted',
    })
  })

  it('returns an existing division for an ambiguous create retry', async () => {
    const database = new ScriptedAdapter([
      {
        includes: 'WITH existing AS',
        rows: [{ ...dividingRow(), created: false }],
      },
    ])
    const repository = new DurableGameRepository(database)

    const result = await repository.getOrCreateDivision({
      ownerId: OWNER_ID,
      problem: PROBLEM,
      softwareVersion: '0.2.0-test',
      researchConsent: RESEARCH_CONSENT,
      gameId: GAME_ID,
    })

    expect(result).toMatchObject({
      created: false,
      game: { id: GAME_ID, status: 'dividing', revision: 0 },
    })
    expect(database.calls[0]?.text).toContain(
      'AND NOT EXISTS (SELECT 1 FROM existing)',
    )
  })

  it('finishes the canonical server cast and starts play with CAS revisions', async () => {
    const mapped = gameRow({ revision: '1', status: 'mapped' })
    const finishDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [dividingRow()] },
      { includes: "status = 'mapped'", rows: [mapped] },
    ])
    const finishRepository = new DurableGameRepository(finishDatabase)

    const finished = await finishRepository.finishDivision({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 0,
      analysis: {
        facets: FACETS,
        seed: SEED,
        model: MODEL,
        prompt: PROMPT,
      },
      parts: PARTS,
      promptVersion: PROMPT_VERSION,
    })

    expect(finished).toMatchObject({
      status: 'mapped',
      revision: 1,
      game: { completedPlies: 0, turn: 'white' },
    })
    expect(finishDatabase.calls[1]?.values?.[9]).toBe(divisionDigest())

    const playing = gameRow({ revision: '2', status: 'playing' })
    const startDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [mapped] },
      { includes: "status = 'playing'", rows: [playing] },
    ])
    const startRepository = new DurableGameRepository(startDatabase)
    const started = await startRepository.startGame({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    })

    expect(started).toMatchObject({
      status: 'playing',
      revision: 2,
      game: { completedPlies: 0, outcome: null },
    })
  })

  it('persists and reloads optional v4 cast applications without changing legacy shapes', async () => {
    const facets = FACETS.map((facet) => ({
      ...facet,
      castApplication:
        `The fixed direction shapes repository facet ${facet.id} into a concrete inquiry.`,
    }))
    const parts = composeProblemParts(facets, SEED)
    const promptVersion = 'webchess-division-v4'
    const digest = computeDivisionDigest({
      problemSha256: sha256Hex(PROBLEM),
      seed: SEED,
      facets,
      parts,
      model: MODEL,
      promptVersion,
      promptSha256: sha256Hex(PROMPT),
    })
    const mapped = gameRow({
      revision: '1',
      status: 'mapped',
      division_facets: facets,
      problem_parts: parts,
      division_prompt_version: promptVersion,
      division_digest: digest,
    })
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [dividingRow()] },
      { includes: "status = 'mapped'", rows: [mapped] },
      { includes: 'FROM game_events', rows: [] },
    ])

    const finished = await new DurableGameRepository(database).finishDivision({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 0,
      analysis: { facets, seed: SEED, model: MODEL, prompt: PROMPT },
      parts,
      promptVersion,
    })

    expect(JSON.parse(String(database.calls[1]?.values?.[4]))).toEqual(facets)
    expect(JSON.parse(String(database.calls[1]?.values?.[5]))).toEqual(parts)
    expect(finished.division?.facets[0]?.castApplication).toBe(
      facets[0]!.castApplication,
    )
    expect(finished.division?.parts[0]?.castApplication).toBe(
      parts[0]!.castApplication,
    )
  })

  it('stores an answer only after replaying a terminal game', async () => {
    const terminal = terminalFixture()
    const rows = eventRows(
      terminal.events,
      terminal.events.map((_, index) => index + 1),
    )
    const completedRevision = terminal.events.length
    const completed = gameRow({
      revision: String(completedRevision),
      status: 'completed',
      outcome: jsonValue(terminal.outcome),
      completed_at: NOW,
    })
    const answering = gameRow({
      revision: String(completedRevision + 1),
      status: 'answering',
      outcome: jsonValue(terminal.outcome),
      completed_at: NOW,
    })
    const beginDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [completed] },
      { includes: 'FROM game_events', rows },
      { includes: "status = 'answering'", rows: [answering] },
      { includes: 'FROM game_events', rows },
    ])
    const beginRepository = new DurableGameRepository(beginDatabase)

    const reserved = await beginRepository.beginAnswer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: completedRevision,
    })
    expect(reserved.status).toBe('answering')

    const answer = {
      answer: 'The durable reading.',
      model: MODEL,
      prompt: 'Canonical answer prompt.',
    }
    const answered = gameRow({
      revision: String(completedRevision + 2),
      status: 'answered',
      outcome: jsonValue(terminal.outcome),
      answer_payload: answer,
      completed_at: NOW,
      answered_at: NOW,
    })
    const storeDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [answering] },
      { includes: 'FROM game_events', rows },
      { includes: "status = 'answered'", rows: [answered] },
      { includes: 'FROM game_events', rows },
    ])
    const storeRepository = new DurableGameRepository(storeDatabase)

    const stored = await storeRepository.storeAnswer({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: completedRevision + 1,
      answer,
    })
    expect(stored).toMatchObject({
      status: 'answered',
      revision: completedRevision + 2,
      answer,
      game: { outcome: terminal.outcome },
    })
    expect(storeDatabase.calls[2]?.values?.[3]).toBe(
      JSON.stringify(answer),
    )
  })

  it('abandons an in-progress game and removes it from current-game lookup', async () => {
    const abandoned = gameRow({
      revision: '3',
      status: 'abandoned',
      is_current: false,
    })
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      { includes: "status = 'abandoned'", rows: [abandoned] },
      { includes: 'FROM game_events', rows: [] },
    ])
    const repository = new DurableGameRepository(database)

    const game = await repository.abandonGame({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
    })

    expect(game).toMatchObject({
      status: 'abandoned',
      revision: 3,
      isCurrent: false,
    })
    expect(database.calls[1]?.text).toContain('is_current = false')
  })

  it.each(['dividing', 'division_failed'] as const)(
    'abandons a pre-division %s game without inventing division material',
    async (status) => {
      const before = dividingRow({ status })
      const abandoned = dividingRow({
        status: 'abandoned',
        is_current: false,
        revision: '1',
      })
      const database = new ScriptedAdapter([
        { includes: 'FROM games', rows: [before] },
        { includes: "status = 'abandoned'", rows: [abandoned] },
        { includes: 'FROM game_events', rows: [] },
      ])

      const game = await new DurableGameRepository(database).abandonGame({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 0,
        idempotencyKey: IDEMPOTENCY_KEY,
      })

      expect(game).toMatchObject({
        status: 'abandoned',
        isCurrent: false,
        revision: 1,
        division: null,
        game: null,
      })
    },
  )

  it.each(['completed', 'answered'] as const)(
    'durably abandons a %s game without deleting its replay or answer payload',
    async (status) => {
      const before = terminalRow(status)
      const expectedRevision = terminalFixture().events.length
      const abandoned = {
        ...before,
        revision: String(expectedRevision + 1),
        status: 'abandoned',
        is_current: false,
      }
      const database = new ScriptedAdapter([
        { includes: 'FROM games', rows: [before] },
        { includes: "status = 'abandoned'", rows: [abandoned] },
        { includes: 'FROM game_events', rows: terminalEventRows() },
      ])

      const game = await new DurableGameRepository(database).abandonGame({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision,
        idempotencyKey: IDEMPOTENCY_KEY,
      })

      expect(game).toMatchObject({
        status: 'abandoned',
        revision: expectedRevision + 1,
        isCurrent: false,
        answer: status === 'answered'
          ? { answer: 'The durable reading.' }
          : null,
      })
      expect(game.game?.events).toHaveLength(terminalFixture().events.length)
      expect(database.calls[1]?.text).toContain("'completed'")
      expect(database.calls[1]?.text).toContain("'answered'")
    },
  )
})

describe('durable game repository ownership and integrity', () => {
  it('uses the same not-found result for unknown and cross-owner ids', async () => {
    for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
      const database = new ScriptedAdapter([
        { includes: 'FROM games', rows: [] },
      ])
      const repository = new DurableGameRepository(database)

      await expect(
        repository.getOwnedGame(ownerId, GAME_ID),
      ).rejects.toMatchObject({
        code: 'not-found',
        message: 'Game not found.',
      })
      expect(database.calls[0]?.values).toEqual([GAME_ID, ownerId])
      database.expectComplete()
    }
  })

  it('fails closed when immutable division data changes', async () => {
    const database = new ScriptedAdapter([
      {
        includes: 'FROM games',
        rows: [gameRow({ division_seed: 'tampered-seed' })],
      },
      { includes: 'FROM game_events', rows: [] },
    ])
    const repository = new DurableGameRepository(database)

    await expect(
      repository.getOwnedGame(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({ code: 'integrity-error' })
  })

  it('reconstructs state from canonical events after a cold read', async () => {
    const state = firstMoveState()
    const database = new ScriptedAdapter([
      {
        includes: 'FROM games',
        rows: [gameRow({ revision: '3' })],
      },
      {
        includes: 'FROM game_events',
        rows: eventRows(state.events, [3]),
      },
    ])
    const repository = new DurableGameRepository(database)

    const game = await repository.getOwnedGame(OWNER_ID, GAME_ID)

    expect(game.game).toMatchObject({
      completedPlies: 1,
      turn: 'black',
      quietPlies: 1,
      outcome: null,
    })
    expect(
      game.game?.pieces.find((piece) => piece.id === 'white-pawn-1')?.position,
    ).toEqual({ ring: 4, sector: 0 })
  })
})

describe('durable move compare-and-swap', () => {
  it('persists only the server-derived event and advances one revision', async () => {
    const committed = gameRow({
      revision: '3',
      updated_at: '2026-07-26T20:01:00.000Z',
      inserted_count: 1,
    })
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      { includes: 'idempotency_key = $2::uuid', rows: [] },
      { includes: 'game_revision <= $2::bigint', rows: [] },
      { includes: 'WITH advanced AS', rows: [committed] },
    ])
    const repository = new DurableGameRepository(database)

    const mutation = await repository.appendMove({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      command: {
        pieceId: 'white-pawn-1',
        to: { ring: 4, sector: 0 },
      },
    })

    expect(mutation).toMatchObject({
      idempotent: false,
      game: {
        revision: 3,
        status: 'playing',
        game: { completedPlies: 1, turn: 'black' },
      },
      appendedEvents: [
        {
          type: 'move',
          side: 'white',
          pieceId: 'white-pawn-1',
          from: { ring: 6, sector: 0 },
          to: { ring: 4, sector: 0 },
        },
      ],
    })

    const commit = database.calls[3]
    expect(commit?.text).toContain('AND revision = $3::bigint')
    expect(commit?.values?.slice(0, 3)).toEqual([
      GAME_ID,
      OWNER_ID,
      2,
    ])
    const persistedEvents = JSON.parse(String(commit?.values?.[5]))
    expect(persistedEvents).toEqual([
      expect.objectContaining({
        kind: 'move',
        source: 'client',
        side: 'white',
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    ])
    expect(persistedEvents[0]).not.toHaveProperty('outcome')
    expect(persistedEvents[0]).not.toHaveProperty('capture')
    database.expectComplete()
  })

  it('rejects a stale revision before issuing a commit statement', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow({ revision: '9' })] },
      { includes: 'idempotency_key = $2::uuid', rows: [] },
    ])
    const repository = new DurableGameRepository(database)

    await expect(
      repository.appendMove({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
        command: {
          pieceId: 'white-pawn-1',
          to: { ring: 4, sector: 0 },
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(database.calls).toHaveLength(2)
  })

  it('rejects reuse of an idempotency key with a changed move body', async () => {
    const duplicate = eventRows(firstMoveState().events, [3])[0]
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow({ revision: '3' })] },
      {
        includes: 'idempotency_key = $2::uuid',
        rows: [{ ...duplicate, request_sha256: 'b'.repeat(64) }],
      },
    ])
    const repository = new DurableGameRepository(database)

    await expect(
      repository.appendMove({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
        command: {
          pieceId: 'white-pawn-1',
          to: { ring: 4, sector: 0 },
        },
      }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('returns the committed move when the same HTTP intent is retried', async () => {
    const command = {
      pieceId: 'white-pawn-1',
      to: { ring: 4, sector: 0 },
    }
    const requestSha256 = hashCanonicalJson(jsonValue({
      operation: 'game-move/1',
      expectedRevision: 2,
      command,
    }))
    const persisted = {
      ...eventRows(firstMoveState().events, [3])[0],
      request_sha256: requestSha256,
    }
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow({ revision: '3' })] },
      { includes: 'idempotency_key = $2::uuid', rows: [persisted] },
      { includes: 'game_revision <= $2::bigint', rows: [persisted] },
    ])
    const repository = new DurableGameRepository(database)

    const retried = await repository.appendMove({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      command,
    })

    expect(retried).toMatchObject({
      idempotent: true,
      game: {
        revision: 3,
        game: { completedPlies: 1, turn: 'black' },
      },
      appendedEvents: [{ type: 'move', pieceId: 'white-pawn-1' }],
    })
    expect(database.calls).toHaveLength(3)
  })
})

describe('terminal replay and division integrity', () => {
  it('derives terminal evidence from events instead of trusting a browser', async () => {
    const terminal = terminalFixture()
    const rows = eventRows(
      terminal.events,
      terminal.events.map((_, index) => index + 1),
    )
    const terminalRow = gameRow({
      revision: String(terminal.events.length),
      status: 'completed',
      outcome: jsonValue(terminal.outcome),
      completed_at: NOW,
    })
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow] },
      { includes: 'FROM game_events', rows },
    ])
    const repository = new DurableGameRepository(database)

    const snapshot = await repository.getTerminalReplay(OWNER_ID, GAME_ID)

    expect(snapshot.game.outcome).toEqual(terminal.outcome)
    expect(snapshot.game.completedPlies).toBeGreaterThan(0)
    expect(snapshot.game.events).toHaveLength(terminal.events.length)
  })

  it('hashes division data canonically', () => {
    const digest = divisionDigest()
    const reorderedFacets = FACETS.map((facet) => ({
      keyword: facet.keyword,
      question: facet.question,
      focus: facet.focus,
      title: facet.title,
      id: facet.id,
    }))

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(
      computeDivisionDigest({
        problemSha256: sha256Hex(PROBLEM),
        seed: SEED,
        facets: reorderedFacets,
        parts: PARTS,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        promptSha256: sha256Hex(PROMPT),
      }),
    ).toBe(digest)
    expect(
      hashCanonicalJson(jsonValue({ digest })),
    ).not.toBe(digest)
  })

})

describe('repository validation and fail-closed snapshots', () => {
  it('rejects invalid public inputs before querying the database', async () => {
    const repository = new DurableGameRepository(new ScriptedAdapter([]))

    expect(normalizeProblem(`  ${PROBLEM}  `)).toBe(PROBLEM)
    expect(() => normalizeProblem('too short')).toThrow(GameRepositoryError)
    expect(() => normalizeProblem('x'.repeat(241))).toThrow(GameRepositoryError)
    expect(() =>
      (normalizeProblem as (problem: unknown) => string)(null),
    ).toThrow(GameRepositoryError)

    await expect(
      repository.getCurrentGame('x'),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      repository.getOwnedGame(OWNER_ID, 'not-a-uuid'),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      repository.failDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: -1,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('creates a random game id when the caller does not supply one', async () => {
    const database = new ScriptedAdapter([
      {
        includes: 'WITH existing AS',
        rows: [{ ...dividingRow(), created: true }],
      },
    ])
    const repository = new DurableGameRepository(database)

    await repository.createDivision({
      ownerId: OWNER_ID,
      problem: PROBLEM,
      softwareVersion: '0.2.0-test',
      researchConsent: RESEARCH_CONSENT,
    })

    expect(database.calls[0]?.values?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it.each([
    ['problem digest', { problem_sha256: '0'.repeat(64) }],
    ['event version', { event_version: 999 }],
    ['rules version', { rules_version: 'unsupported-rules' }],
    ['engine version', { engine_version: 'unsupported-engine' }],
    ['cast version', { cast_version: 'unsupported-cast' }],
    ['quarantined status', { status: 'integrity_error' }],
    ['revision range', { revision: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n) }],
  ])('rejects a snapshot with invalid %s', async (_label, overrides) => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow(overrides)] },
      { includes: 'FROM game_events', rows: [] },
    ])
    const repository = new DurableGameRepository(database)

    await expect(
      repository.getOwnedGame(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({ code: 'integrity-error' })
  })

  it('rejects partial and malformed immutable division data', async () => {
    const cases = [
      dividingRow({ division_seed: SEED }),
      gameRow({
        division_facets: Array.from({ length: 64 }, () => ({})),
      }),
      gameRow({
        problem_parts: Array.from({ length: 64 }, () => ({})),
      }),
    ]

    for (const row of cases) {
      const database = new ScriptedAdapter([
        { includes: 'FROM games', rows: [row] },
        { includes: 'FROM game_events', rows: [] },
      ])
      await expect(
        new DurableGameRepository(database).getOwnedGame(OWNER_ID, GAME_ID),
      ).rejects.toMatchObject({ code: 'integrity-error' })
    }
  })

  it('rejects malformed answers and database records without leaking parser errors', async () => {
    const badAnswerDatabase = new ScriptedAdapter([
      {
        includes: 'FROM games',
        rows: [gameRow({
          answer_payload: { answer: '', model: MODEL, prompt: PROMPT },
        })],
      },
      { includes: 'FROM game_events', rows: [] },
    ])
    await expect(
      new DurableGameRepository(badAnswerDatabase)
        .getOwnedGame(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({
      code: 'integrity-error',
      message: 'The stored answer is invalid.',
    })

    const badGameDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [{ ...gameRow(), id: 'invalid' }] },
    ])
    await expect(
      new DurableGameRepository(badGameDatabase)
        .getOwnedGame(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({
      code: 'integrity-error',
      message: 'The database returned an invalid game record.',
    })

    const badEventDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      {
        includes: 'FROM game_events',
        rows: [{ ...eventRows(firstMoveState().events, [3])[0], ply: 999 }],
      },
    ])
    await expect(
      new DurableGameRepository(badEventDatabase)
        .getOwnedGame(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({
      code: 'integrity-error',
      message: 'The database returned an invalid game event.',
    })
  })

  it('rejects events attached to an undivided game', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [dividingRow({ revision: '3' })] },
      {
        includes: 'FROM game_events',
        rows: eventRows(firstMoveState().events, [3]),
      },
    ])

    await expect(
      new DurableGameRepository(database).getOwnedGame(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({
      code: 'integrity-error',
      message: expect.stringContaining('Undivided game'),
    })
  })

  it('rejects status and outcome data that disagree with replay', async () => {
    const terminal = terminalFixture()
    const cases: Array<{
      row: SqlRow
      events: SqlRow[]
      message: string
    }> = [
      {
        row: gameRow({
          revision: String(terminal.events.length),
          status: 'playing',
          outcome: jsonValue(terminal.outcome),
        }),
        events: terminalEventRows(),
        message: 'terminal but stored as playing',
      },
      {
        row: gameRow({
          status: 'completed',
          outcome: { winner: 'white', reason: 'king-captured' },
        }),
        events: [],
        message: 'without a terminal replay',
      },
      {
        row: terminalRow('completed', {
          outcome: { winner: 'black', reason: 'king-captured' },
        }),
        events: terminalEventRows(),
        message: 'does not match its event log',
      },
      {
        row: gameRow({
          outcome: { winner: 'white', reason: 'king-captured' },
        }),
        events: [],
        message: 'outcome before its replay is terminal',
      },
      {
        row: gameRow({ revision: '3', status: 'mapped' }),
        events: eventRows(firstMoveState().events, [3]),
        message: 'Mapped game',
      },
    ]

    for (const testCase of cases) {
      const database = new ScriptedAdapter([
        { includes: 'FROM games', rows: [testCase.row] },
        { includes: 'FROM game_events', rows: testCase.events },
      ])
      await expect(
        new DurableGameRepository(database).getOwnedGame(OWNER_ID, GAME_ID),
      ).rejects.toMatchObject({
        code: 'integrity-error',
        message: expect.stringContaining(testCase.message),
      })
    }
  })

  it('requires a terminal replay for terminal-only operations', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow({ status: 'mapped' })] },
      { includes: 'FROM game_events', rows: [] },
    ])

    await expect(
      new DurableGameRepository(database)
        .getTerminalReplay(OWNER_ID, GAME_ID),
    ).rejects.toMatchObject({ code: 'not-terminal' })
  })

  it('rejects duplicate rows for one move idempotency key', async () => {
    const duplicate = eventRows(firstMoveState().events, [3])[0]
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      {
        includes: 'idempotency_key = $2::uuid',
        rows: [duplicate, duplicate],
      },
    ])

    await expect(
      new DurableGameRepository(database).appendMove({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
        command: {
          pieceId: 'white-pawn-1',
          to: { ring: 4, sector: 0 },
        },
      }),
    ).rejects.toMatchObject({ code: 'integrity-error' })
  })
})

describe('division idempotency and compare-and-swap recovery', () => {
  it('cannot create a shell after its owner and reservation disappear', async () => {
    const database = new ScriptedAdapter([
      { includes: 'WITH existing AS MATERIALIZED', rows: [] },
      { includes: 'FROM games', rows: [] },
    ])

    await expect(
      new DurableGameRepository(database).getOrCreateDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: '0.2.0-test',
        researchConsent: RESEARCH_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })

    expect(database.calls[0]?.text).not.toContain(
      'INSERT INTO user_controls',
    )
    expect(database.calls[0]?.text).toContain(
      'FROM eligible_owner',
    )
  })

  it('rejects an insert result without an explicit created flag', async () => {
    const database = new ScriptedAdapter([
      { includes: 'WITH existing AS', rows: [dividingRow()] },
    ])

    await expect(
      new DurableGameRepository(database).getOrCreateDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: '0.2.0-test',
        researchConsent: RESEARCH_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'integrity-error' })
  })

  it('recovers an identical concurrent division insert', async () => {
    const database = new ScriptedAdapter([
      { includes: 'WITH existing AS', rows: [] },
      { includes: 'FROM games', rows: [dividingRow()] },
      { includes: 'FROM game_events', rows: [] },
    ])

    const recovered = await new DurableGameRepository(database)
      .getOrCreateDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: '0.2.0-test',
        researchConsent: RESEARCH_CONSENT,
      })

    expect(recovered).toMatchObject({
      created: false,
      game: { status: 'dividing', revision: 0 },
    })
  })

  it('maps a missing or changed concurrent insert to an idempotency conflict', async () => {
    const missingDatabase = new ScriptedAdapter([
      { includes: 'WITH existing AS', rows: [] },
      { includes: 'FROM games', rows: [] },
    ])
    await expect(
      new DurableGameRepository(missingDatabase).getOrCreateDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: '0.2.0-test',
        researchConsent: RESEARCH_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })

    const mismatches: Array<Partial<Record<string, unknown>>> = [
      { problem_sha256: '0'.repeat(64) },
      { event_version: 999 },
      { rules_version: 'different-rules' },
      { engine_version: 'different-engine' },
      { cast_version: 'different-cast' },
      { software_version: 'different-software' },
    ]
    for (const mismatch of mismatches) {
      const database = new ScriptedAdapter([
        { includes: 'WITH existing AS', rows: [] },
        { includes: 'FROM games', rows: [dividingRow(mismatch)] },
      ])
      await expect(
        new DurableGameRepository(database).getOrCreateDivision({
          ownerId: OWNER_ID,
          gameId: GAME_ID,
          problem: PROBLEM,
          softwareVersion: '0.2.0-test',
          researchConsent: RESEARCH_CONSENT,
        }),
      ).rejects.toMatchObject({ code: 'idempotency-conflict' })
    }
  })

  it('replays an already-mapped result returned by a create retry', async () => {
    const database = new ScriptedAdapter([
      {
        includes: 'WITH existing AS',
        rows: [{ ...gameRow({ revision: '1', status: 'mapped' }), created: false }],
      },
      { includes: 'FROM game_events', rows: [] },
    ])

    const recovered = await new DurableGameRepository(database)
      .getOrCreateDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: '0.2.0-test',
        researchConsent: RESEARCH_CONSENT,
      })

    expect(recovered.game).toMatchObject({
      status: 'mapped',
      game: { completedPlies: 0 },
    })
  })

  it('validates canonical division material before performing a write', async () => {
    const repository = new DurableGameRepository(new ScriptedAdapter([]))
    const changedParts = PARTS.map((part, index) =>
      index === 0 ? { ...part, keyword: `${part.keyword} changed` } : part,
    )

    await expect(
      repository.finishDivision(finishInput({ parts: changedParts })),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      repository.finishDivision(finishInput({
        analysis: {
          facets: FACETS,
          seed: '',
          model: MODEL,
          prompt: PROMPT,
        },
        parts: composeProblemParts(FACETS, ''),
      })),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      repository.finishDivision(finishInput({
        analysis: {
          facets: FACETS,
          seed: Number.NaN,
          model: MODEL,
          prompt: PROMPT,
        },
        parts: composeProblemParts(FACETS, Number.NaN),
      })),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    const longSeed = 'x'.repeat(513)
    await expect(
      repository.finishDivision(finishInput({
        analysis: {
          facets: FACETS,
          seed: longSeed,
          model: MODEL,
          prompt: PROMPT,
        },
        parts: composeProblemParts(FACETS, longSeed),
      })),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      repository.finishDivision(finishInput({
        analysis: {
          facets: FACETS,
          seed: SEED,
          model: MODEL,
          prompt: ' ',
        },
      })),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('returns an identical completed cast and rejects a different retry', async () => {
    const mapped = gameRow({ revision: '1', status: 'mapped' })
    const identicalDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [mapped] },
      { includes: 'FROM game_events', rows: [] },
    ])
    const identical = await new DurableGameRepository(identicalDatabase)
      .finishDivision(finishInput())
    expect(identical.status).toBe('mapped')

    const changedDatabase = new ScriptedAdapter([
      {
        includes: 'FROM games',
        rows: [gameRow({
          revision: '1',
          status: 'mapped',
          division_digest: '0'.repeat(64),
        })],
      },
    ])
    await expect(
      new DurableGameRepository(changedDatabase)
        .finishDivision(finishInput()),
    ).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('marks a failed division and explains each CAS failure distinctly', async () => {
    const failedDatabase = new ScriptedAdapter([
      {
        includes: "status = 'division_failed'",
        rows: [dividingRow({ revision: '1', status: 'division_failed' })],
      },
    ])
    const failed = await new DurableGameRepository(failedDatabase)
      .failDivision({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 0,
      })
    expect(failed).toMatchObject({ status: 'division_failed', revision: 1 })

    const failures = [
      {
        row: dividingRow({ revision: '1' }),
        code: 'conflict',
        message: 'revision changed',
      },
      {
        row: dividingRow({ is_current: false }),
        code: 'invalid-state',
        message: 'no longer the current game',
      },
      {
        row: dividingRow({ status: 'division_failed' }),
        code: 'invalid-state',
        message: 'cannot perform this operation',
      },
      {
        row: dividingRow(),
        code: 'conflict',
        message: 'changed while',
      },
    ]
    for (const failure of failures) {
      const database = new ScriptedAdapter([
        { includes: "status = 'division_failed'", rows: [] },
        { includes: 'FROM games', rows: [failure.row] },
      ])
      await expect(
        new DurableGameRepository(database).failDivision({
          ownerId: OWNER_ID,
          gameId: GAME_ID,
          expectedRevision: 0,
        }),
      ).rejects.toMatchObject({
        code: failure.code,
        message: expect.stringContaining(failure.message),
      })
    }
  })

  it('uses the CAS explanation when finishing a division loses a race', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [dividingRow()] },
      { includes: "status = 'mapped'", rows: [] },
      { includes: 'FROM games', rows: [dividingRow({ revision: '1' })] },
    ])

    await expect(
      new DurableGameRepository(database).finishDivision(finishInput()),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('returns both present and absent current-game lookups', async () => {
    const presentDatabase = new ScriptedAdapter([
      { includes: 'AND is_current', rows: [gameRow({ status: 'mapped' })] },
      { includes: 'FROM game_events', rows: [] },
    ])
    await expect(
      new DurableGameRepository(presentDatabase).getCurrentGame(OWNER_ID),
    ).resolves.toMatchObject({ id: GAME_ID })

    const absentDatabase = new ScriptedAdapter([
      { includes: 'AND is_current', rows: [] },
    ])
    await expect(
      new DurableGameRepository(absentDatabase).getCurrentGame(OWNER_ID),
    ).resolves.toBeNull()
  })
})

describe('start and move race recovery', () => {
  it('treats an already-playing start as idempotent', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      { includes: 'FROM game_events', rows: [] },
    ])

    await expect(
      new DurableGameRepository(database).startGame({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({ status: 'playing' })
  })

  it('recovers when another request starts the game first', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow({ revision: '1', status: 'mapped' })] },
      { includes: "status = 'playing'", rows: [] },
      { includes: 'FROM games', rows: [gameRow({ revision: '2' })] },
      { includes: 'FROM game_events', rows: [] },
    ])

    await expect(
      new DurableGameRepository(database).startGame({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({ status: 'playing', revision: 2 })
  })

  it('rejects moves outside the current playing game', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow({ status: 'mapped' })] },
      { includes: 'idempotency_key = $2::uuid', rows: [] },
    ])

    await expect(
      new DurableGameRepository(database).appendMove({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
        command: {
          pieceId: 'white-pawn-1',
          to: { ring: 4, sector: 0 },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('rejects a partial database commit of canonical move events', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      { includes: 'idempotency_key = $2::uuid', rows: [] },
      { includes: 'game_revision <= $2::bigint', rows: [] },
      {
        includes: 'WITH advanced AS',
        rows: [{ ...gameRow({ revision: '3' }), inserted_count: 0 }],
      },
    ])

    await expect(
      new DurableGameRepository(database).appendMove({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
        command: {
          pieceId: 'white-pawn-1',
          to: { ring: 4, sector: 0 },
        },
      }),
    ).rejects.toMatchObject({ code: 'integrity-error' })
  })

  it('recovers a move that wins the commit race', async () => {
    const command = {
      pieceId: 'white-pawn-1',
      to: { ring: 4, sector: 0 },
    }
    const requestSha256 = hashCanonicalJson(jsonValue({
      operation: 'game-move/1',
      expectedRevision: 2,
      command,
    }))
    const persisted = {
      ...eventRows(firstMoveState().events, [3])[0],
      request_sha256: requestSha256,
    }
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [gameRow()] },
      { includes: 'idempotency_key = $2::uuid', rows: [] },
      { includes: 'game_revision <= $2::bigint', rows: [] },
      { includes: 'WITH advanced AS', rows: [] },
      { includes: 'idempotency_key = $2::uuid', rows: [persisted] },
      { includes: 'FROM games', rows: [gameRow({ revision: '3' })] },
      { includes: 'game_revision <= $2::bigint', rows: [persisted] },
    ])

    const recovered = await new DurableGameRepository(database).appendMove({
      ownerId: OWNER_ID,
      gameId: GAME_ID,
      expectedRevision: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      command,
    })

    expect(recovered).toMatchObject({
      idempotent: true,
      game: { revision: 3 },
    })
  })
})

describe('answer state idempotency and race recovery', () => {
  it.each(['answering', 'answered'] as const)(
    'returns an already-%s terminal game when beginning an answer is retried',
    async (status) => {
      const database = new ScriptedAdapter([
        { includes: 'FROM games', rows: [terminalRow(status)] },
        { includes: 'FROM game_events', rows: terminalEventRows() },
      ])

      await expect(
        new DurableGameRepository(database).beginAnswer({
          ownerId: OWNER_ID,
          gameId: GAME_ID,
          expectedRevision: terminalFixture().events.length,
        }),
      ).resolves.toMatchObject({ status })
    },
  )

  it('rejects beginning an answer from another terminal status', async () => {
    const terminal = terminalFixture()
    const database = new ScriptedAdapter([
      {
        includes: 'FROM games',
        rows: [gameRow({
          revision: String(terminal.events.length),
          status: 'abandoned',
          is_current: false,
          outcome: jsonValue(terminal.outcome),
          completed_at: NOW,
        })],
      },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])

    await expect(
      new DurableGameRepository(database).beginAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: terminal.events.length,
      }),
    ).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('recovers when another request reserves answer generation first', async () => {
    const revision = terminalFixture().events.length
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow('completed')] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
      { includes: "status = 'answering'", rows: [] },
      {
        includes: 'FROM games',
        rows: [terminalRow('answering', { revision: String(revision + 1) })],
      },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])

    await expect(
      new DurableGameRepository(database).beginAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: revision,
      }),
    ).resolves.toMatchObject({
      status: 'answering',
      revision: revision + 1,
    })
  })

  it('makes storing the same answer idempotent and rejects replacement', async () => {
    const answer = {
      answer: 'The durable reading.',
      model: MODEL,
      prompt: 'Canonical answer prompt.',
    }
    const identicalDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow('answered')] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])
    await expect(
      new DurableGameRepository(identicalDatabase).storeAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: terminalFixture().events.length,
        answer,
      }),
    ).resolves.toMatchObject({ status: 'answered', answer })

    const differentDatabase = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow('answered')] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])
    await expect(
      new DurableGameRepository(differentDatabase).storeAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: terminalFixture().events.length,
        answer: { ...answer, answer: 'A different reading.' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('requires answer generation to be reserved before storing', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow('completed')] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])

    await expect(
      new DurableGameRepository(database).storeAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: terminalFixture().events.length,
        answer: {
          answer: 'The durable reading.',
          model: MODEL,
          prompt: 'Canonical answer prompt.',
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('recovers when the same answer is stored by a racing request', async () => {
    const revision = terminalFixture().events.length
    const answer = {
      answer: 'The durable reading.',
      model: MODEL,
      prompt: 'Canonical answer prompt.',
    }
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow('answering')] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
      { includes: "status = 'answered'", rows: [] },
      {
        includes: 'FROM games',
        rows: [terminalRow('answered', { revision: String(revision + 1) })],
      },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])

    await expect(
      new DurableGameRepository(database).storeAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: revision,
        answer,
      }),
    ).resolves.toMatchObject({
      status: 'answered',
      answer,
    })
  })

  it('persists and idempotently recovers an answer failure', async () => {
    const revision = terminalFixture().events.length
    const failedRow = terminalRow('answer_failed', {
      revision: String(revision + 1),
    })
    const successDatabase = new ScriptedAdapter([
      { includes: "status = 'answer_failed'", rows: [failedRow] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])
    await expect(
      new DurableGameRepository(successDatabase).failAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: revision,
      }),
    ).resolves.toMatchObject({ status: 'answer_failed' })

    const retryDatabase = new ScriptedAdapter([
      { includes: "status = 'answer_failed'", rows: [] },
      { includes: 'FROM games', rows: [failedRow] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])
    await expect(
      new DurableGameRepository(retryDatabase).failAnswer({
        ownerId: OWNER_ID,
        gameId: GAME_ID,
        expectedRevision: revision,
      }),
    ).resolves.toMatchObject({ status: 'answer_failed' })
  })

  it('reads the stored answer through the owner-bound snapshot', async () => {
    const database = new ScriptedAdapter([
      { includes: 'FROM games', rows: [terminalRow('answered')] },
      { includes: 'FROM game_events', rows: terminalEventRows() },
    ])

    await expect(
      new DurableGameRepository(database)
        .getStoredAnswer(OWNER_ID, GAME_ID),
    ).resolves.toMatchObject({ answer: 'The durable reading.' })
  })
})

describe('repository error identity', () => {
  it('exposes stable route-safe error codes', () => {
    const error = new GameRepositoryError('not-found', 'Game not found.')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('GameRepositoryError')
    expect(error.code).toBe('not-found')
    expect(isGameRepositoryError(error)).toBe(true)
    expect(isGameRepositoryError(new Error('other'))).toBe(false)
  })
})

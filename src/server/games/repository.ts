import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  CURRENT_GAME_VERSIONS,
  GAME_EVENT_VERSION,
} from '../../lib/game-contract'
import type {
  GameEvent,
  ReplayState,
} from '../../lib/game-contract'
import {
  acceptMoveCommand,
  replayGameEvents,
  toGameView,
} from '../../lib/game-replay'
import { composeProblemParts } from '../../lib/division'
import {
  MAX_PERSISTED_MODEL_PROMPT_CHARS,
  type GeneratedAnswer,
  type ProblemFacet,
  type ProblemPart,
} from '../../types'
import {
  gameEventRowSchema,
  gameRowSchema,
  hashCanonicalJson,
  parseOptionalResultRow,
  parseResultRows,
  parseSingleResultRow,
  sha256Hex,
} from '../db'
import type {
  CanonicalJson,
  GameEventRow,
  GameRow,
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
} from '../db'
import { GameRepositoryError } from './errors'
import type {
  AbandonGameInput,
  AppendMoveInput,
  ChangeAnswerStatusInput,
  CreateDivisionInput,
  CreateDivisionResult,
  DurableDivision,
  DurableGameSnapshot,
  FinishDivisionInput,
  MoveMutationResult,
  StartGameInput,
  StoreAnswerInput,
  TerminalGameSnapshot,
} from './types'

const uuidSchema = z.string().uuid()
const ownerSchema = z.string().min(3).max(255)
const versionSchema = z.string().trim().min(1).max(120)
const promptVersionSchema = z.string().trim().min(1).max(80)

const problemFacetSchema = z.object({
  id: z.number().int().min(1).max(64),
  title: z.string().trim().min(1),
  focus: z.string().trim().min(1),
  question: z.string().trim().min(1),
  keyword: z.string().trim().min(1),
})

const problemPartSchema = z.object({
  id: z.number().int().min(1).max(64),
  title: z.string().trim().min(1),
  focus: z.string().trim().min(1),
  hexagram: z.number().int().min(1).max(64),
  hexagramName: z.string().trim().min(1),
  theme: z.string().trim().min(1),
  dimension: z.string().trim().min(1),
  movement: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  keyword: z.string().trim().min(1),
})

const facetsSchema = z
  .array(problemFacetSchema)
  .length(64)
  .refine(
    (facets) => new Set(facets.map((facet) => facet.id)).size === 64,
    'Division facets must contain each id exactly once.',
  )

const partsSchema = z
  .array(problemPartSchema)
  .length(64)
  .refine(
    (parts) => new Set(parts.map((part) => part.id)).size === 64,
    'Problem parts must contain each id exactly once.',
  )

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(100_000),
  model: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(MAX_PERSISTED_MODEL_PROMPT_CHARS),
})

const SELECT_GAME_COLUMNS = `
  id,
  clerk_user_id,
  source_game_id,
  is_current,
  revision,
  status,
  problem,
  problem_sha256,
  division_seed,
  division_facets,
  problem_parts,
  division_model,
  division_prompt_version,
  division_prompt_sha256,
  division_digest,
  event_version,
  rules_version,
  engine_version,
  cast_version,
  software_version,
  outcome,
  answer_payload,
  created_at,
  updated_at,
  completed_at,
  answered_at
`

const SELECT_EVENT_COLUMNS = `
  game_id,
  ply,
  kind,
  source,
  side,
  piece_id,
  captured_piece_id,
  promoted_to,
  from_ring,
  from_sector,
  to_ring,
  to_sector,
  idempotency_key,
  request_sha256,
  game_revision,
  created_at
`

const TERMINAL_STATUSES = new Set([
  'completed',
  'answering',
  'answer_failed',
  'answered',
])

const ABANDONABLE_STATUSES = new Set([
  'dividing',
  'division_failed',
  'mapped',
  'playing',
  'completed',
  'answer_failed',
  'answered',
])

/**
 * This must remain identical to the usage/account-deletion lock. It is
 * intentionally repeated here to keep the game repository independent of the
 * usage implementation while serializing their shared ownership boundary.
 *
 * The lock runs as its own statement in a READ COMMITTED transaction. Putting
 * it in the mutation CTE would retain a snapshot taken before a blocked lock
 * acquisition and could resurrect rows after a concurrent forced deletion.
 */
const USAGE_OWNERSHIP_LOCK_STATEMENT: SqlStatement = {
  text: `
    SELECT pg_advisory_xact_lock(
      hashtextextended('webchess-usage-reservation-v1', 0)
    ) AS held
  `,
}

function asCanonicalJson(value: unknown): CanonicalJson {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Value cannot be represented as JSON.')
  }
  return JSON.parse(serialized) as CanonicalJson
}

function assertOwner(ownerId: string): string {
  const parsed = ownerSchema.safeParse(ownerId)
  if (!parsed.success) {
    throw new GameRepositoryError(
      'invalid-input',
      'A valid authenticated owner is required.',
      { cause: parsed.error },
    )
  }
  return parsed.data
}

function assertUuid(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) {
    throw new GameRepositoryError(
      'invalid-input',
      `${label} must be a UUID.`,
      { cause: parsed.error },
    )
  }
  return parsed.data
}

function assertRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GameRepositoryError(
      'invalid-input',
      'Expected revision must be a nonnegative safe integer.',
    )
  }
  return value
}

function revisionNumber(value: bigint): number {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new GameRepositoryError(
      'integrity-error',
      'The stored game revision is outside the supported range.',
    )
  }
  return revision
}

function validatedFacets(value: unknown): ProblemFacet[] {
  const result = facetsSchema.safeParse(value)
  if (!result.success) {
    throw new GameRepositoryError(
      'integrity-error',
      'The stored semantic division is invalid.',
      { cause: result.error },
    )
  }
  return result.data
}

function validatedParts(value: unknown): ProblemPart[] {
  const result = partsSchema.safeParse(value)
  if (!result.success) {
    throw new GameRepositoryError(
      'integrity-error',
      'The stored board mapping is invalid.',
      { cause: result.error },
    )
  }
  return result.data
}

function validatedAnswer(value: unknown): GeneratedAnswer | null {
  if (value === null) return null
  const result = answerSchema.safeParse(value)
  if (!result.success) {
    throw new GameRepositoryError(
      'integrity-error',
      'The stored answer is invalid.',
      { cause: result.error },
    )
  }
  return result.data
}

function sameJson(left: unknown, right: unknown): boolean {
  return hashCanonicalJson(asCanonicalJson(left)) ===
    hashCanonicalJson(asCanonicalJson(right))
}

export function normalizeProblem(problem: string): string {
  if (typeof problem !== 'string') {
    throw new GameRepositoryError(
      'invalid-input',
      'Problem must be text.',
    )
  }

  const normalized = problem.trim().replace(/\s+/g, ' ')
  if (normalized.length < 12 || normalized.length > 240) {
    throw new GameRepositoryError(
      'invalid-input',
      'Problem must contain between 12 and 240 characters.',
    )
  }
  return normalized
}

interface DivisionDigestInput {
  readonly problemSha256: string
  readonly seed: string
  readonly facets: readonly ProblemFacet[]
  readonly parts: readonly ProblemPart[]
  readonly model: string
  readonly promptVersion: string
  readonly promptSha256: string
}

/**
 * Hashes every immutable input needed to interpret a cast. JSONB may reorder
 * object keys, so the database hash helper uses canonical key ordering.
 */
export function computeDivisionDigest(input: DivisionDigestInput): string {
  return hashCanonicalJson(asCanonicalJson({
    format: 'webchess-division/1',
    problemSha256: input.problemSha256,
    seed: input.seed,
    facets: input.facets,
    parts: input.parts,
    model: input.model,
    promptVersion: input.promptVersion,
    promptSha256: input.promptSha256,
    eventVersion: CURRENT_GAME_VERSIONS.event,
    rulesVersion: CURRENT_GAME_VERSIONS.rules,
    castVersion: CURRENT_GAME_VERSIONS.cast,
    engineVersion: CURRENT_GAME_VERSIONS.engine,
  }))
}

function eventFromRow(row: GameEventRow): GameEvent {
  if (row.kind === 'pass') {
    return {
      version: GAME_EVENT_VERSION,
      type: 'forced-pass',
      ply: row.ply,
      side: row.side,
      reason: 'no-legal-move',
    }
  }

  if (
    row.piece_id === null ||
    row.from_ring === null ||
    row.from_sector === null ||
    row.to_ring === null ||
    row.to_sector === null
  ) {
    throw new GameRepositoryError(
      'integrity-error',
      `Move event at ply ${row.ply} is incomplete.`,
    )
  }

  return {
    version: GAME_EVENT_VERSION,
    type: 'move',
    ply: row.ply,
    side: row.side,
    pieceId: row.piece_id,
    from: { ring: row.from_ring, sector: row.from_sector },
    to: { ring: row.to_ring, sector: row.to_sector },
    ...(row.captured_piece_id === null
      ? {}
      : { capturedPieceId: row.captured_piece_id }),
    ...(row.promoted_to === null ? {} : { promotedTo: row.promoted_to }),
  }
}

function statusMatchesReplay(row: GameRow, replay: ReplayState): void {
  const terminal = replay.outcome !== null
  if (
    (row.status === 'mapped' || row.status === 'playing') &&
    terminal
  ) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} is terminal but stored as ${row.status}.`,
    )
  }
  if (TERMINAL_STATUSES.has(row.status) && !terminal) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} is stored as ${row.status} without a terminal replay.`,
    )
  }

  if (terminal) {
    if (row.outcome === null || !sameJson(row.outcome, replay.outcome)) {
      throw new GameRepositoryError(
        'integrity-error',
        `Game ${row.id} has outcome data that does not match its event log.`,
      )
    }
  } else if (row.outcome !== null) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} has an outcome before its replay is terminal.`,
    )
  }
}

function divisionFromRow(row: GameRow): DurableDivision | null {
  const divisionValues = [
    row.division_seed,
    row.division_facets,
    row.problem_parts,
    row.division_model,
    row.division_prompt_version,
    row.division_prompt_sha256,
    row.division_digest,
  ]
  const present = divisionValues.filter((value) => value !== null).length
  if (present === 0) return null
  if (present !== divisionValues.length) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} has a partial semantic division.`,
    )
  }

  const facets = validatedFacets(row.division_facets)
  const parts = validatedParts(row.problem_parts)
  const division: DurableDivision = {
    seed: row.division_seed!,
    facets,
    parts,
    model: row.division_model!,
    promptVersion: row.division_prompt_version!,
    promptSha256: row.division_prompt_sha256!,
    digest: row.division_digest!,
  }
  const digest = computeDivisionDigest({
    problemSha256: row.problem_sha256,
    seed: division.seed,
    facets,
    parts,
    model: division.model,
    promptVersion: division.promptVersion,
    promptSha256: division.promptSha256,
  })
  if (digest !== division.digest) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} failed its immutable division digest.`,
    )
  }
  return division
}

function snapshotFrom(
  row: GameRow,
  eventRows: readonly GameEventRow[],
): DurableGameSnapshot {
  if (sha256Hex(row.problem) !== row.problem_sha256) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} failed its problem digest.`,
    )
  }
  if (
    row.event_version !== CURRENT_GAME_VERSIONS.event ||
    row.rules_version !== CURRENT_GAME_VERSIONS.rules ||
    row.engine_version !== CURRENT_GAME_VERSIONS.engine ||
    row.cast_version !== CURRENT_GAME_VERSIONS.cast
  ) {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} uses an unsupported method version.`,
    )
  }
  if (row.status === 'integrity_error') {
    throw new GameRepositoryError(
      'integrity-error',
      `Game ${row.id} was quarantined after an integrity failure.`,
    )
  }

  const division = divisionFromRow(row)
  if (division === null) {
    if (eventRows.length !== 0) {
      throw new GameRepositoryError(
        'integrity-error',
        `Undivided game ${row.id} contains game events.`,
      )
    }
    if (
      row.status !== 'dividing' &&
      row.status !== 'division_failed' &&
      row.status !== 'abandoned'
    ) {
      throw new GameRepositoryError(
        'integrity-error',
        `Game ${row.id} has no division in status ${row.status}.`,
      )
    }

    return {
      id: row.id,
      sourceGameId: row.source_game_id,
      isCurrent: row.is_current,
      revision: revisionNumber(row.revision),
      status: row.status,
      problem: row.problem,
      division: null,
      game: null,
      answer: validatedAnswer(row.answer_payload),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      answeredAt: row.answered_at ? new Date(row.answered_at) : null,
    }
  }

  const replay = replayGameEvents(eventRows.map(eventFromRow), division.parts)
  statusMatchesReplay(row, replay)
  if (row.status === 'mapped' && eventRows.length !== 0) {
    throw new GameRepositoryError(
      'integrity-error',
      `Mapped game ${row.id} already contains events.`,
    )
  }

  return {
    id: row.id,
    sourceGameId: row.source_game_id,
    isCurrent: row.is_current,
    revision: revisionNumber(row.revision),
    status: row.status,
    problem: row.problem,
    division,
    game: toGameView(replay),
    answer: validatedAnswer(row.answer_payload),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    answeredAt: row.answered_at ? new Date(row.answered_at) : null,
  }
}

function terminalSnapshot(
  snapshot: DurableGameSnapshot,
): TerminalGameSnapshot {
  if (
    snapshot.division === null ||
    snapshot.game === null ||
    snapshot.game.outcome === null
  ) {
    throw new GameRepositoryError(
      'not-terminal',
      'The game must finish before this operation.',
    )
  }
  return snapshot as TerminalGameSnapshot
}

function parsedGame(result: SqlResult): GameRow {
  try {
    return parseSingleResultRow(result, gameRowSchema)
  } catch (error) {
    throw new GameRepositoryError(
      'integrity-error',
      'The database returned an invalid game record.',
      { cause: error },
    )
  }
}

function parsedOptionalGame(result: SqlResult): GameRow | undefined {
  try {
    return parseOptionalResultRow(result, gameRowSchema)
  } catch (error) {
    throw new GameRepositoryError(
      'integrity-error',
      'The database returned an invalid game record.',
      { cause: error },
    )
  }
}

function parsedEvents(result: SqlResult): readonly GameEventRow[] {
  try {
    return parseResultRows(result, gameEventRowSchema)
  } catch (error) {
    throw new GameRepositoryError(
      'integrity-error',
      'The database returned an invalid game event.',
      { cause: error },
    )
  }
}

interface MutationRow extends SqlRow {
  readonly inserted_count?: unknown
}

interface CreateMutationRow extends SqlRow {
  readonly created?: unknown
}

export class DurableGameRepository {
  constructor(private readonly database: SqlAdapter) {}

  private async ownedRow(ownerId: string, gameId: string): Promise<GameRow> {
    const owner = assertOwner(ownerId)
    const id = assertUuid(gameId, 'Game id')
    const result = await this.database.query({
      text: `
        SELECT ${SELECT_GAME_COLUMNS}
        FROM games
        WHERE id = $1::uuid
          AND clerk_user_id = $2
      `,
      values: [id, owner],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      throw new GameRepositoryError('not-found', 'Game not found.')
    }
    return row
  }

  private async eventRows(
    gameId: string,
    maximumRevision: bigint,
  ): Promise<readonly GameEventRow[]> {
    const result = await this.database.query({
      text: `
        SELECT ${SELECT_EVENT_COLUMNS}
        FROM game_events
        WHERE game_id = $1::uuid
          AND game_revision <= $2::bigint
        ORDER BY ply
      `,
      values: [gameId, maximumRevision.toString()],
    })
    return parsedEvents(result)
  }

  private async snapshotForRow(row: GameRow): Promise<DurableGameSnapshot> {
    const events = await this.eventRows(row.id, row.revision)
    return snapshotFrom(row, events)
  }

  private async idempotentMoveRow(
    gameId: string,
    idempotencyKey: string,
  ): Promise<GameEventRow | undefined> {
    const result = await this.database.query({
      text: `
        SELECT ${SELECT_EVENT_COLUMNS}
        FROM game_events
        WHERE game_id = $1::uuid
          AND idempotency_key = $2::uuid
      `,
      values: [gameId, idempotencyKey],
    })
    const rows = parsedEvents(result)
    if (rows.length > 1) {
      throw new GameRepositoryError(
        'integrity-error',
        'An idempotency key resolved to multiple moves.',
      )
    }
    return rows[0]
  }

  private async duplicateMoveResult(
    row: GameRow,
    event: GameEventRow,
    requestSha256: string,
  ): Promise<MoveMutationResult> {
    if (event.request_sha256 !== requestSha256) {
      throw new GameRepositoryError(
        'idempotency-conflict',
        'That idempotency key was already used for a different move.',
      )
    }

    const events = await this.eventRows(row.id, event.game_revision)
    const replay = replayGameEvents(
      events.map(eventFromRow),
      validatedParts(row.problem_parts),
    )
    const historicalStatus = replay.outcome ? 'completed' : 'playing'
    const historicalRow: GameRow = {
      ...row,
      revision: event.game_revision,
      status: historicalStatus,
      outcome: replay.outcome
        ? asCanonicalJson(replay.outcome) as Record<string, unknown>
        : null,
      answer_payload: null,
      answered_at: null,
      completed_at: replay.outcome ? row.completed_at : null,
    }
    const appendedEvents = events
      .filter((candidate) => candidate.game_revision === event.game_revision)
      .map(eventFromRow)

    return {
      game: snapshotFrom(historicalRow, events),
      appendedEvents,
      idempotent: true,
    }
  }

  private async explainCasFailure(
    ownerId: string,
    gameId: string,
    expectedRevision: number,
    allowedStatuses: ReadonlySet<string>,
  ): Promise<never> {
    const row = await this.ownedRow(ownerId, gameId)
    if (revisionNumber(row.revision) !== expectedRevision) {
      throw new GameRepositoryError(
        'conflict',
        `Game revision changed from ${expectedRevision} to ${row.revision.toString()}.`,
      )
    }
    if (!row.is_current) {
      throw new GameRepositoryError(
        'invalid-state',
        'The game is no longer the current game.',
      )
    }
    if (!allowedStatuses.has(row.status)) {
      throw new GameRepositoryError(
        'invalid-state',
        `The game cannot perform this operation while ${row.status}.`,
      )
    }
    throw new GameRepositoryError(
      'conflict',
      'The game changed while the operation was being committed.',
    )
  }

  async createDivision(
    input: CreateDivisionInput,
  ): Promise<DurableGameSnapshot> {
    return (await this.getOrCreateDivision({
      ...input,
      gameId: input.gameId ?? randomUUID(),
    })).game
  }

  /**
   * Creates the division shell exactly once. Callers should derive gameId from
   * the durable model-request id so an ambiguous route retry reaches this same
   * row instead of retiring it and creating another game. Identity/control
   * rows are provisioned only by the usage boundary: this repository requires
   * the active control and live division reservation to already exist, and
   * locks both before it retires or creates any game.
   */
  async getOrCreateDivision(
    input: CreateDivisionInput & { readonly gameId: string },
  ): Promise<CreateDivisionResult> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const problem = normalizeProblem(input.problem)
    const softwareVersion = versionSchema.parse(input.softwareVersion)
    const problemSha256 = sha256Hex(problem)
    const sourceGameId = input.sourceGameId === undefined
      ? null
      : assertUuid(input.sourceGameId, 'Source game id')
    if (sourceGameId !== null) {
      await this.ownedRow(ownerId, sourceGameId)
    }

    const statements: readonly SqlStatement[] = [
      USAGE_OWNERSHIP_LOCK_STATEMENT,
      {
        text: `
        WITH existing AS MATERIALIZED (
          SELECT ${SELECT_GAME_COLUMNS}
          FROM games
          WHERE id = $2::uuid
        ),
        eligible_owner AS MATERIALIZED (
          SELECT controls.clerk_user_id
          FROM user_controls AS controls
          JOIN model_requests AS requests
            ON requests.id = $2::uuid
            AND requests.clerk_user_id = controls.clerk_user_id
            AND requests.operation = 'division'
            AND requests.game_id IS NULL
            AND requests.status IN ('reserved', 'in_progress')
          WHERE controls.clerk_user_id = $1
            AND NOT controls.suspended
            AND controls.reason_code IS DISTINCT FROM
              'ACCOUNT_DELETION_PENDING'
          FOR UPDATE OF controls, requests
        ),
        retired AS (
          UPDATE games AS games
          SET is_current = false,
              updated_at = now()
          FROM eligible_owner
          WHERE games.clerk_user_id = $1
            AND games.clerk_user_id = eligible_owner.clerk_user_id
            AND games.is_current
            AND NOT EXISTS (SELECT 1 FROM existing)
          RETURNING games.id
        ),
        inserted AS (
          INSERT INTO games (
            id,
            clerk_user_id,
            source_game_id,
            is_current,
            revision,
            status,
            problem,
            problem_sha256,
            event_version,
            rules_version,
            engine_version,
            cast_version,
            software_version
          )
          SELECT
            $2::uuid,
            eligible_owner.clerk_user_id,
            $10::uuid,
            true,
            0,
            'dividing',
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9
          FROM eligible_owner
          CROSS JOIN (SELECT count(*) FROM retired) AS retired_count
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          ON CONFLICT DO NOTHING
          RETURNING ${SELECT_GAME_COLUMNS}
        )
        SELECT inserted.*, true AS created
        FROM inserted
        UNION ALL
        SELECT existing.*, false AS created
        FROM existing
        WHERE existing.clerk_user_id = $1
          AND existing.problem_sha256 = $4
          AND existing.event_version = $5
          AND existing.rules_version = $6
          AND existing.engine_version = $7
          AND existing.cast_version = $8
          AND existing.software_version = $9
          AND existing.source_game_id IS NOT DISTINCT FROM $10::uuid
      `,
        values: [
          ownerId,
          gameId,
          problem,
          problemSha256,
          CURRENT_GAME_VERSIONS.event,
          CURRENT_GAME_VERSIONS.rules,
          CURRENT_GAME_VERSIONS.engine,
          CURRENT_GAME_VERSIONS.cast,
          softwareVersion,
          sourceGameId,
        ],
      },
    ]
    const results = await this.database.transaction(
      statements,
      { isolationLevel: 'ReadCommitted' },
    )
    const result = results[1] as SqlResult<CreateMutationRow> | undefined
    if (!result) {
      throw new GameRepositoryError(
        'integrity-error',
        'The division ownership transaction returned no mutation result.',
      )
    }

    const raw = result.rows[0]
    if (raw) {
      if (raw.created !== true && raw.created !== false) {
        throw new GameRepositoryError(
          'integrity-error',
          'The database did not identify whether the game was created.',
        )
      }
      const row = parsedGame(result)
      return {
        game: row.status === 'dividing'
          ? snapshotFrom(row, [])
          : await this.snapshotForRow(row),
        created: raw.created,
      }
    }

    // A concurrent identical insert may be invisible to the first statement's
    // snapshot even though ON CONFLICT waited for it. Re-read once.
    let raced: GameRow
    try {
      raced = await this.ownedRow(ownerId, gameId)
    } catch (error) {
      if (
        error instanceof GameRepositoryError &&
        error.code === 'not-found'
      ) {
        throw new GameRepositoryError(
          'idempotency-conflict',
          'That game id was already used for a different division.',
        )
      }
      throw error
    }
    if (
      raced.problem_sha256 !== problemSha256 ||
      raced.event_version !== CURRENT_GAME_VERSIONS.event ||
      raced.rules_version !== CURRENT_GAME_VERSIONS.rules ||
      raced.engine_version !== CURRENT_GAME_VERSIONS.engine ||
      raced.cast_version !== CURRENT_GAME_VERSIONS.cast ||
      raced.software_version !== softwareVersion ||
      raced.source_game_id !== sourceGameId
    ) {
      throw new GameRepositoryError(
        'idempotency-conflict',
        'That game id was already used for a different division.',
      )
    }
    return {
      game: await this.snapshotForRow(raced),
      created: false,
    }
  }

  async finishDivision(
    input: FinishDivisionInput,
  ): Promise<DurableGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const facets = facetsSchema.parse(input.analysis.facets)
    const parts = partsSchema.parse(input.parts)
    const canonicalParts = composeProblemParts(
      facets,
      input.analysis.seed,
    )
    if (!sameJson(parts, canonicalParts)) {
      throw new GameRepositoryError(
        'invalid-input',
        'Problem parts do not match the canonical server-side cast.',
      )
    }
    if (
      !(
        (typeof input.analysis.seed === 'string' &&
          input.analysis.seed.trim().length > 0) ||
        (typeof input.analysis.seed === 'number' &&
          Number.isFinite(input.analysis.seed))
      )
    ) {
      throw new GameRepositoryError(
        'invalid-input',
        'Division seed must be a finite number or non-empty string.',
      )
    }
    const seed = String(input.analysis.seed).trim()
    const model = versionSchema.parse(input.analysis.model)
    const promptVersion = promptVersionSchema.parse(input.promptVersion)
    if (seed.length === 0 || seed.length > 512) {
      throw new GameRepositoryError(
        'invalid-input',
        'Division seed must contain between 1 and 512 characters.',
      )
    }
    if (
      typeof input.analysis.prompt !== 'string' ||
      input.analysis.prompt.trim().length === 0
    ) {
      throw new GameRepositoryError(
        'invalid-input',
        'The canonical division prompt is required.',
      )
    }

    const existing = await this.ownedRow(ownerId, gameId)
    const promptSha256 = sha256Hex(input.analysis.prompt)
    const divisionDigest = computeDivisionDigest({
      problemSha256: existing.problem_sha256,
      seed,
      facets,
      parts,
      model,
      promptVersion,
      promptSha256,
    })
    if (existing.status !== 'dividing') {
      if (existing.division_digest === divisionDigest) {
        return this.snapshotForRow(existing)
      }
      throw new GameRepositoryError(
        'invalid-state',
        `The division cannot finish while the game is ${existing.status}.`,
      )
    }

    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'mapped',
            division_seed = $4,
            division_facets = $5::jsonb,
            problem_parts = $6::jsonb,
            division_model = $7,
            division_prompt_version = $8,
            division_prompt_sha256 = $9,
            division_digest = $10,
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status = 'dividing'
          AND is_current
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [
        gameId,
        ownerId,
        expectedRevision,
        seed,
        JSON.stringify(facets),
        JSON.stringify(parts),
        model,
        promptVersion,
        promptSha256,
        divisionDigest,
      ],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      return this.explainCasFailure(
        ownerId,
        gameId,
        expectedRevision,
        new Set(['dividing']),
      )
    }
    return snapshotFrom(row, [])
  }

  async failDivision(
    input: ChangeAnswerStatusInput,
  ): Promise<DurableGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'division_failed',
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status = 'dividing'
          AND is_current
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [gameId, ownerId, expectedRevision],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      return this.explainCasFailure(
        ownerId,
        gameId,
        expectedRevision,
        new Set(['dividing']),
      )
    }
    return snapshotFrom(row, [])
  }

  async getOwnedGame(
    ownerId: string,
    gameId: string,
  ): Promise<DurableGameSnapshot> {
    return this.snapshotForRow(await this.ownedRow(ownerId, gameId))
  }

  async getCurrentGame(
    ownerId: string,
  ): Promise<DurableGameSnapshot | null> {
    const owner = assertOwner(ownerId)
    const result = await this.database.query({
      text: `
        SELECT ${SELECT_GAME_COLUMNS}
        FROM games
        WHERE clerk_user_id = $1
          AND is_current
        ORDER BY updated_at DESC, id
        LIMIT 1
      `,
      values: [owner],
    })
    const row = parsedOptionalGame(result)
    return row ? this.snapshotForRow(row) : null
  }

  async startGame(input: StartGameInput): Promise<DurableGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    assertUuid(input.idempotencyKey, 'Idempotency key')
    const expectedRevision = assertRevision(input.expectedRevision)
    const before = await this.ownedRow(ownerId, gameId)
    if (before.status === 'playing') {
      return this.snapshotForRow(before)
    }

    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'playing',
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status = 'mapped'
          AND is_current
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [gameId, ownerId, expectedRevision],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      const current = await this.ownedRow(ownerId, gameId)
      if (
        current.status === 'playing' &&
        revisionNumber(current.revision) === expectedRevision + 1
      ) {
        return this.snapshotForRow(current)
      }
      return this.explainCasFailure(
        ownerId,
        gameId,
        expectedRevision,
        new Set(['mapped']),
      )
    }
    return snapshotFrom(row, [])
  }

  async appendMove(input: AppendMoveInput): Promise<MoveMutationResult> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const idempotencyKey = assertUuid(
      input.idempotencyKey,
      'Idempotency key',
    )
    const expectedRevision = assertRevision(input.expectedRevision)
    const requestSha256 = hashCanonicalJson(asCanonicalJson({
      operation: 'game-move/1',
      expectedRevision,
      command: input.command,
    }))
    const row = await this.ownedRow(ownerId, gameId)
    const duplicate = await this.idempotentMoveRow(gameId, idempotencyKey)
    if (duplicate) {
      return this.duplicateMoveResult(row, duplicate, requestSha256)
    }
    if (revisionNumber(row.revision) !== expectedRevision) {
      throw new GameRepositoryError(
        'conflict',
        `Game revision changed from ${expectedRevision} to ${row.revision.toString()}.`,
      )
    }
    if (row.status !== 'playing' || !row.is_current) {
      throw new GameRepositoryError(
        'invalid-state',
        'Only the current playing game can accept a move.',
      )
    }

    const snapshot = await this.snapshotForRow(row)
    if (snapshot.division === null || snapshot.game === null) {
      throw new GameRepositoryError(
        'integrity-error',
        'A playing game is missing its semantic division.',
      )
    }
    const accepted = acceptMoveCommand(
      snapshot.game,
      {
        ...input.command,
        expectedPly: snapshot.game.completedPlies + 1,
      },
      snapshot.division.parts,
    )
    if (accepted.appendedEvents.length === 0) {
      throw new GameRepositoryError(
        'integrity-error',
        'A legal move produced no canonical events.',
      )
    }

    const eventPayload = accepted.appendedEvents.map((event) => {
      if (event.type === 'forced-pass') {
        return {
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
        }
      }
      return {
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
        idempotency_key: idempotencyKey,
        request_sha256: requestSha256,
      }
    })
    if (eventPayload.filter((event) => event.source === 'client').length !== 1) {
      throw new GameRepositoryError(
        'integrity-error',
        'A move mutation must contain exactly one client move.',
      )
    }

    const nextStatus = accepted.state.outcome ? 'completed' : 'playing'
    const outcomeJson = accepted.state.outcome
      ? JSON.stringify(accepted.state.outcome)
      : null
    const result = await this.database.query<MutationRow>({
      text: `
        WITH advanced AS (
          UPDATE games
          SET revision = revision + 1,
              status = $4,
              outcome = $5::jsonb,
              completed_at = CASE
                WHEN $4 = 'completed' THEN now()
                ELSE completed_at
              END,
              updated_at = now()
          WHERE id = $1::uuid
            AND clerk_user_id = $2
            AND revision = $3::bigint
            AND status = 'playing'
            AND is_current
          RETURNING ${SELECT_GAME_COLUMNS}
        ),
        inserted AS (
          INSERT INTO game_events (
            game_id,
            ply,
            kind,
            source,
            side,
            piece_id,
            captured_piece_id,
            promoted_to,
            from_ring,
            from_sector,
            to_ring,
            to_sector,
            idempotency_key,
            request_sha256,
            game_revision
          )
          SELECT
            advanced.id,
            event.ply,
            event.kind,
            event.source,
            event.side,
            event.piece_id,
            event.captured_piece_id,
            event.promoted_to,
            event.from_ring,
            event.from_sector,
            event.to_ring,
            event.to_sector,
            event.idempotency_key,
            event.request_sha256,
            advanced.revision
          FROM advanced
          CROSS JOIN jsonb_to_recordset($6::jsonb) AS event(
            ply smallint,
            kind text,
            source text,
            side text,
            piece_id text,
            captured_piece_id text,
            promoted_to text,
            from_ring smallint,
            from_sector smallint,
            to_ring smallint,
            to_sector smallint,
            idempotency_key uuid,
            request_sha256 char(64)
          )
          RETURNING ply
        )
        SELECT
          advanced.*,
          (SELECT count(*)::integer FROM inserted) AS inserted_count
        FROM advanced
      `,
      values: [
        gameId,
        ownerId,
        expectedRevision,
        nextStatus,
        outcomeJson,
        JSON.stringify(eventPayload),
      ],
    })

    if (result.rows.length === 0) {
      const racedDuplicate = await this.idempotentMoveRow(
        gameId,
        idempotencyKey,
      )
      if (racedDuplicate) {
        const current = await this.ownedRow(ownerId, gameId)
        return this.duplicateMoveResult(
          current,
          racedDuplicate,
          requestSha256,
        )
      }
      return this.explainCasFailure(
        ownerId,
        gameId,
        expectedRevision,
        new Set(['playing']),
      )
    }
    const insertedCount = Number(result.rows[0]?.inserted_count)
    if (
      !Number.isSafeInteger(insertedCount) ||
      insertedCount !== accepted.appendedEvents.length
    ) {
      throw new GameRepositoryError(
        'integrity-error',
        'The database did not persist the complete move transition.',
      )
    }

    const committedRow = parsedGame(result)
    return {
      game: {
        ...snapshot,
        revision: revisionNumber(committedRow.revision),
        status: committedRow.status,
        game: toGameView(accepted.state),
        updatedAt: new Date(committedRow.updated_at),
        completedAt: committedRow.completed_at
          ? new Date(committedRow.completed_at)
          : null,
      },
      appendedEvents: accepted.appendedEvents,
      idempotent: false,
    }
  }

  async getTerminalReplay(
    ownerId: string,
    gameId: string,
  ): Promise<TerminalGameSnapshot> {
    return terminalSnapshot(await this.getOwnedGame(ownerId, gameId))
  }

  async beginAnswer(
    input: ChangeAnswerStatusInput,
  ): Promise<TerminalGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const before = await this.getTerminalReplay(ownerId, gameId)
    if (before.status === 'answering' || before.status === 'answered') {
      return before
    }
    if (before.status !== 'completed' && before.status !== 'answer_failed') {
      throw new GameRepositoryError(
        'invalid-state',
        `An answer cannot begin while the game is ${before.status}.`,
      )
    }

    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'answering',
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status IN ('completed', 'answer_failed')
          AND is_current
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [gameId, ownerId, expectedRevision],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      return terminalSnapshot(
        await this.explainAnswerCasFailure(
          ownerId,
          gameId,
          expectedRevision,
          new Set(['completed', 'answer_failed']),
        ),
      )
    }
    const events = await this.eventRows(row.id, row.revision)
    return terminalSnapshot(snapshotFrom(row, events))
  }

  private async explainAnswerCasFailure(
    ownerId: string,
    gameId: string,
    expectedRevision: number,
    allowedStatuses: ReadonlySet<string>,
  ): Promise<DurableGameSnapshot> {
    const current = await this.getOwnedGame(ownerId, gameId)
    if (
      current.status === 'answering' ||
      current.status === 'answered'
    ) {
      return current
    }
    if (current.revision !== expectedRevision) {
      throw new GameRepositoryError(
        'conflict',
        `Game revision changed from ${expectedRevision} to ${current.revision}.`,
      )
    }
    if (!allowedStatuses.has(current.status) || !current.isCurrent) {
      throw new GameRepositoryError(
        'invalid-state',
        `An answer cannot change while the game is ${current.status}.`,
      )
    }
    throw new GameRepositoryError(
      'conflict',
      'The answer state changed while it was being committed.',
    )
  }

  async storeAnswer(
    input: StoreAnswerInput,
  ): Promise<TerminalGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const answer = answerSchema.parse(input.answer)
    const before = await this.getTerminalReplay(ownerId, gameId)
    if (before.status === 'answered') {
      if (sameJson(before.answer, answer)) return before
      throw new GameRepositoryError(
        'conflict',
        'This game already has a different stored answer.',
      )
    }
    if (before.status !== 'answering') {
      throw new GameRepositoryError(
        'invalid-state',
        'The game must reserve answer generation before storing an answer.',
      )
    }

    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'answered',
            answer_payload = $4::jsonb,
            answered_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status = 'answering'
          AND is_current
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [
        gameId,
        ownerId,
        expectedRevision,
        JSON.stringify(answer),
      ],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      const current = await this.getTerminalReplay(ownerId, gameId)
      if (current.status === 'answered' && sameJson(current.answer, answer)) {
        return current
      }
      return terminalSnapshot(
        await this.explainAnswerCasFailure(
          ownerId,
          gameId,
          expectedRevision,
          new Set(['answering']),
        ),
      )
    }
    const events = await this.eventRows(row.id, row.revision)
    return terminalSnapshot(snapshotFrom(row, events))
  }

  async failAnswer(
    input: ChangeAnswerStatusInput,
  ): Promise<TerminalGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'answer_failed',
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status = 'answering'
          AND is_current
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [gameId, ownerId, expectedRevision],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      const current = await this.getTerminalReplay(ownerId, gameId)
      if (current.status === 'answer_failed') return current
      return terminalSnapshot(
        await this.explainAnswerCasFailure(
          ownerId,
          gameId,
          expectedRevision,
          new Set(['answering']),
        ),
      )
    }
    const events = await this.eventRows(row.id, row.revision)
    return terminalSnapshot(snapshotFrom(row, events))
  }

  async getStoredAnswer(
    ownerId: string,
    gameId: string,
  ): Promise<GeneratedAnswer | null> {
    return (await this.getOwnedGame(ownerId, gameId)).answer
  }

  async abandonGame(
    input: AbandonGameInput,
  ): Promise<DurableGameSnapshot> {
    const ownerId = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    assertUuid(input.idempotencyKey, 'Idempotency key')
    const expectedRevision = assertRevision(input.expectedRevision)
    const before = await this.ownedRow(ownerId, gameId)
    if (before.status === 'abandoned') {
      return this.snapshotForRow(before)
    }
    if (!ABANDONABLE_STATUSES.has(before.status)) {
      throw new GameRepositoryError(
        'invalid-state',
        `A ${before.status} game cannot be abandoned.`,
      )
    }

    const result = await this.database.query({
      text: `
        UPDATE games
        SET revision = revision + 1,
            status = 'abandoned',
            is_current = false,
            updated_at = now()
        WHERE id = $1::uuid
          AND clerk_user_id = $2
          AND revision = $3::bigint
          AND status IN (
            'dividing',
            'division_failed',
            'mapped',
            'playing',
            'completed',
            'answer_failed',
            'answered'
          )
        RETURNING ${SELECT_GAME_COLUMNS}
      `,
      values: [gameId, ownerId, expectedRevision],
    })
    const row = parsedOptionalGame(result)
    if (!row) {
      return this.explainCasFailure(
        ownerId,
        gameId,
        expectedRevision,
        ABANDONABLE_STATUSES,
      )
    }
    return this.snapshotForRow(row)
  }
}

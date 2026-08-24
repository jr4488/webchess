import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeProblemParts } from '../../src/lib/division'
import {
  getLegalMoves,
  getPieceAt,
} from '../../src/lib/game'
import { DurableGameRepository } from '../../src/server/games'
import type {
  DurableGameSnapshot,
  MoveMutationResult,
} from '../../src/server/games'
import type { CellCoord, ProblemFacet } from '../../src/types'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

const OWNER = 'user_game_repository_integration'
const GAME_ID = '21000000-0000-4000-8000-000000000001'
const PROBLEM = 'Which durable path should this complete WebChess replay illuminate?'
const SEED = 'integration-game-seed'
const MODEL = 'gpt-5.6-sol'
const PROMPT = 'Canonical integration division prompt.'
const PROMPT_VERSION = 'division-v1'
const SOFTWARE_VERSION = 'integration-test'
const RESEARCH_CONSENT = {
  version: 'webchess-research-consent-v1',
  decision: 'no_external_research',
} as const
const USAGE_OWNERSHIP_LOCK = {
  text: `
    SELECT pg_advisory_xact_lock(
      hashtextextended('webchess-usage-reservation-v1', 0)
    )
  `,
} as const

const FACETS: readonly ProblemFacet[] = Array.from(
  { length: 64 },
  (_, index) => ({
    id: index + 1,
    title: `Integration facet ${index + 1}`,
    focus: `Integration focus ${index + 1}`,
    question: `What clarifies integration facet ${index + 1}?`,
    keyword: `integration-${index + 1}`,
  }),
)
const PARTS = composeProblemParts(FACETS, SEED)

let database: PostgresTestDatabase
let repository: DurableGameRepository

async function seedDivisionReservation(
  ownerId = OWNER,
  requestId = GAME_ID,
): Promise<void> {
  await database.adapter.transaction([
    {
      text: `
        INSERT INTO user_controls (clerk_user_id)
        VALUES ($1)
      `,
      values: [ownerId],
    },
    {
      text: `
        INSERT INTO model_requests (
          id,
          clerk_user_id,
          game_id,
          operation,
          idempotency_key,
          request_sha256,
          status,
          provider,
          model,
          prompt_version,
          software_version
        )
        VALUES (
          $1::uuid,
          $2,
          NULL,
          'division',
          $1::uuid,
          $3,
          'reserved',
          'openai',
          $4,
          $5,
          $6
        )
      `,
      values: [
        requestId,
        ownerId,
        'b'.repeat(64),
        MODEL,
        PROMPT_VERSION,
        SOFTWARE_VERSION,
      ],
    },
  ])
}

beforeEach(async () => {
  database = await createPostgresTestDatabase('games')
  await database.migrate()
  repository = new DurableGameRepository(database.adapter)
  await seedDivisionReservation()
})

afterEach(async () => {
  await database.dispose()
})

function idempotencyKey(index: number): string {
  return `22000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function requireGame(snapshot: DurableGameSnapshot) {
  if (!snapshot.game) {
    throw new Error('Expected a replayable game snapshot.')
  }
  return snapshot.game
}

function legalDestination(
  snapshot: DurableGameSnapshot,
  pieceId: string,
  preferred: CellCoord,
): CellCoord {
  const game = requireGame(snapshot)
  const piece = game.pieces.find((candidate) => candidate.id === pieceId)
  if (!piece) {
    throw new Error(`Missing integration piece ${pieceId}.`)
  }
  const destination = getLegalMoves(piece, game.pieces).find(
    (candidate) =>
      candidate.ring === preferred.ring &&
      candidate.sector === preferred.sector,
  )
  if (!destination) {
    throw new Error(
      `${pieceId} cannot reach (${preferred.ring}, ${preferred.sector}).`,
    )
  }
  return destination
}

async function append(
  snapshot: DurableGameSnapshot,
  index: number,
  pieceId: string,
  to: CellCoord,
): Promise<MoveMutationResult> {
  return repository.appendMove({
    ownerId: OWNER,
    gameId: snapshot.id,
    expectedRevision: snapshot.revision,
    idempotencyKey: idempotencyKey(index),
    command: { pieceId, to },
  })
}

function nextDeterministicMove(snapshot: DurableGameSnapshot): {
  readonly pieceId: string
  readonly to: CellCoord
} {
  const game = requireGame(snapshot)
  const candidates = game.pieces
    .filter((piece) => piece.side === game.turn)
    .flatMap((piece) =>
      getLegalMoves(piece, game.pieces).map((to) => {
        const captured = getPieceAt(game.pieces, to)
        const promotes =
          piece.kind === 'pawn' &&
          ((piece.side === 'white' && to.ring === 0) ||
            (piece.side === 'black' && to.ring === 7))
        const score = captured?.kind === 'king'
          ? 3
          : captured
            ? 2
            : promotes
              ? 1
              : 0
        return { pieceId: piece.id, to, score }
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
    throw new Error(`No legal ${game.turn} integration move was available.`)
  }
  return { pieceId: selected.pieceId, to: selected.to }
}

async function createPlayingGame(): Promise<DurableGameSnapshot> {
  const created = await repository.getOrCreateDivision({
    ownerId: OWNER,
    gameId: GAME_ID,
    problem: PROBLEM,
    softwareVersion: SOFTWARE_VERSION,
    researchConsent: RESEARCH_CONSENT,
  })
  const mapped = await repository.finishDivision({
    ownerId: OWNER,
    gameId: GAME_ID,
    expectedRevision: created.game.revision,
    analysis: {
      facets: [...FACETS],
      seed: SEED,
      model: MODEL,
      prompt: PROMPT,
    },
    parts: PARTS,
    promptVersion: PROMPT_VERSION,
  })
  return repository.startGame({
    ownerId: OWNER,
    gameId: GAME_ID,
    expectedRevision: mapped.revision,
    idempotencyKey: idempotencyKey(0),
  })
}

describe('durable game repository against PostgreSQL', () => {
  it('does not recreate an owner or shell after force deletion wins', async () => {
    await database.adapter.transaction([
      USAGE_OWNERSHIP_LOCK,
      {
        text: `
          DELETE FROM user_controls
          WHERE clerk_user_id = $1
        `,
        values: [OWNER],
      },
    ])

    await expect(
      repository.getOrCreateDivision({
        ownerId: OWNER,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: SOFTWARE_VERSION,
        researchConsent: RESEARCH_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })

    const rows = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM user_controls) AS controls,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM games) AS games
      `,
    })
    expect(rows.rows).toEqual([
      { controls: 0, requests: 0, games: 0 },
    ])
  })

  it('leaves no resurrected rows when force deletion races shell creation', async () => {
    const creation = repository.getOrCreateDivision({
      ownerId: OWNER,
      gameId: GAME_ID,
      problem: PROBLEM,
      softwareVersion: SOFTWARE_VERSION,
      researchConsent: RESEARCH_CONSENT,
    })
    const deletion = database.adapter.transaction([
      USAGE_OWNERSHIP_LOCK,
      {
        text: `
          DELETE FROM user_controls
          WHERE clerk_user_id = $1
        `,
        values: [OWNER],
      },
    ])

    const [, deletionResult] = await Promise.allSettled([
      creation,
      deletion,
    ])
    expect(deletionResult.status).toBe('fulfilled')

    const rows = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM user_controls) AS controls,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM games) AS games
      `,
    })
    expect(rows.rows).toEqual([
      { controls: 0, requests: 0, games: 0 },
    ])
  })

  it('does not create a shell for a deletion-pending control row', async () => {
    await database.adapter.transaction([
      USAGE_OWNERSHIP_LOCK,
      {
        text: `
          UPDATE user_controls
          SET reason_code = 'ACCOUNT_DELETION_PENDING'
          WHERE clerk_user_id = $1
        `,
        values: [OWNER],
      },
    ])

    await expect(
      repository.getOrCreateDivision({
        ownerId: OWNER,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: SOFTWARE_VERSION,
        researchConsent: RESEARCH_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })

    const rows = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM user_controls) AS controls,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM games) AS games
      `,
    })
    expect(rows.rows).toEqual([
      { controls: 1, requests: 1, games: 0 },
    ])
  })

  it('serializes identical division creation and preserves one current game', async () => {
    const inputs = {
      ownerId: OWNER,
      gameId: GAME_ID,
      problem: PROBLEM,
      softwareVersion: SOFTWARE_VERSION,
      researchConsent: RESEARCH_CONSENT,
    }
    const results = await Promise.all([
      repository.getOrCreateDivision(inputs),
      repository.getOrCreateDivision(inputs),
    ])

    expect(results.map((result) => result.created).sort()).toEqual([
      false,
      true,
    ])
    expect(results[0].game.researchConsent).toEqual({
      ...RESEARCH_CONSENT,
      recordedAt: expect.any(String),
    })
    const rows = await database.adapter.query({
      text: `
        SELECT id::text, is_current
        FROM games
        WHERE clerk_user_id = $1
      `,
      values: [OWNER],
    })
    expect(rows.rows).toEqual([{ id: GAME_ID, is_current: true }])
  })

  it('persists CAS moves, capture and promotion fields, terminal replay, and answers', async () => {
    let snapshot = await createPlayingGame()
    const firstRevision = snapshot.revision
    const firstCommand = {
      pieceId: 'white-pawn-1',
      to: legalDestination(snapshot, 'white-pawn-1', {
        ring: 4,
        sector: 0,
      }),
    }
    const first = await append(
      snapshot,
      1,
      firstCommand.pieceId,
      firstCommand.to,
    )
    expect(first.idempotent).toBe(false)
    snapshot = first.game

    await expect(
      repository.appendMove({
        ownerId: OWNER,
        gameId: GAME_ID,
        expectedRevision: firstRevision,
        idempotencyKey: idempotencyKey(1),
        command: firstCommand,
      }),
    ).resolves.toMatchObject({
      idempotent: true,
      game: { revision: snapshot.revision },
    })
    await expect(
      repository.appendMove({
        ownerId: OWNER,
        gameId: GAME_ID,
        expectedRevision: firstRevision,
        idempotencyKey: idempotencyKey(200),
        command: {
          pieceId: 'white-pawn-2',
          to: { ring: 4, sector: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      repository.getOwnedGame('user_unrelated_owner', GAME_ID),
    ).rejects.toMatchObject({
      code: 'not-found',
      message: 'Game not found.',
    })

    snapshot = (
      await append(
        snapshot,
        2,
        'black-pawn-2',
        legalDestination(snapshot, 'black-pawn-2', {
          ring: 3,
          sector: 1,
        }),
      )
    ).game
    const capture = await append(
      snapshot,
      3,
      'white-pawn-1',
      legalDestination(snapshot, 'white-pawn-1', {
        ring: 3,
        sector: 1,
      }),
    )
    expect(capture.appendedEvents).toEqual([
      expect.objectContaining({
        type: 'move',
        pieceId: 'white-pawn-1',
        capturedPieceId: 'black-pawn-2',
      }),
    ])
    snapshot = capture.game

    const gameAfterCapture = requireGame(snapshot)
    const knight = gameAfterCapture.pieces.find(
      (piece) => piece.id === 'black-knight-1',
    )
    if (!knight) {
      throw new Error('Missing black knight promotion-path fixture.')
    }
    const knightDestination = getLegalMoves(
      knight,
      gameAfterCapture.pieces,
    ).find(
      (candidate) =>
        !(
          candidate.sector === 1 &&
          candidate.ring <= 2
        ),
    )
    if (!knightDestination) {
      throw new Error('The black knight could not clear the promotion path.')
    }
    snapshot = (
      await append(
        snapshot,
        4,
        'black-knight-1',
        knightDestination,
      )
    ).game
    snapshot = (
      await append(
        snapshot,
        5,
        'white-pawn-1',
        legalDestination(snapshot, 'white-pawn-1', {
          ring: 2,
          sector: 1,
        }),
      )
    ).game
    snapshot = (
      await append(
        snapshot,
        6,
        'black-pawn-8',
        legalDestination(snapshot, 'black-pawn-8', {
          ring: 3,
          sector: 7,
        }),
      )
    ).game
    snapshot = (
      await append(
        snapshot,
        7,
        'white-pawn-1',
        legalDestination(snapshot, 'white-pawn-1', {
          ring: 1,
          sector: 1,
        }),
      )
    ).game
    snapshot = (
      await append(
        snapshot,
        8,
        'black-pawn-7',
        legalDestination(snapshot, 'black-pawn-7', {
          ring: 3,
          sector: 6,
        }),
      )
    ).game
    const promotion = await append(
      snapshot,
      9,
      'white-pawn-1',
      legalDestination(snapshot, 'white-pawn-1', {
        ring: 0,
        sector: 1,
      }),
    )
    expect(promotion.appendedEvents).toEqual([
      expect.objectContaining({
        type: 'move',
        pieceId: 'white-pawn-1',
        promotedTo: 'queen',
      }),
    ])
    snapshot = promotion.game

    const specialEvents = await database.adapter.query({
      text: `
        SELECT
          ply,
          captured_piece_id,
          promoted_to,
          idempotency_key::text,
          request_sha256
        FROM game_events
        WHERE game_id = $1::uuid
          AND (
            captured_piece_id IS NOT NULL
            OR promoted_to IS NOT NULL
          )
        ORDER BY ply
      `,
      values: [GAME_ID],
    })
    expect(specialEvents.rows).toEqual([
      {
        ply: 3,
        captured_piece_id: 'black-pawn-2',
        promoted_to: null,
        idempotency_key: idempotencyKey(3),
        request_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        ply: 9,
        captured_piece_id: null,
        promoted_to: 'queen',
        idempotency_key: idempotencyKey(9),
        request_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ])

    const restored = await new DurableGameRepository(
      database.adapter,
    ).getOwnedGame(OWNER, GAME_ID)
    expect(restored).toMatchObject({
      revision: snapshot.revision,
      status: 'playing',
      game: {
        completedPlies: 9,
        turn: 'black',
      },
    })
    expect(
      restored.game?.pieces.find(
        (piece) => piece.id === 'white-pawn-1',
      ),
    ).toMatchObject({
      kind: 'queen',
      position: { ring: 0, sector: 1 },
    })
    snapshot = restored

    let moveIndex = 10
    while (!requireGame(snapshot).outcome) {
      const move = nextDeterministicMove(snapshot)
      snapshot = (
        await append(
          snapshot,
          moveIndex,
          move.pieceId,
          move.to,
        )
      ).game
      moveIndex += 1
      if (moveIndex > 270) {
        throw new Error('The integration game exceeded its bounded replay.')
      }
    }

    expect(snapshot.status).toBe('completed')
    const terminal = await repository.getTerminalReplay(OWNER, GAME_ID)
    expect(terminal.game.outcome).not.toBeNull()
    expect(terminal.game.events.length).toBeGreaterThanOrEqual(9)
    const passRows = await database.adapter.query({
      text: `
        SELECT
          kind,
          source,
          idempotency_key,
          request_sha256
        FROM game_events
        WHERE game_id = $1::uuid
          AND kind = 'pass'
        ORDER BY ply
      `,
      values: [GAME_ID],
    })
    for (const row of passRows.rows) {
      expect(row).toEqual({
        kind: 'pass',
        source: 'server',
        idempotency_key: null,
        request_sha256: null,
      })
    }

    let answering = await repository.beginAnswer({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: terminal.revision,
    })
    expect(answering.status).toBe('answering')
    const failed = await repository.failAnswer({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: answering.revision,
    })
    expect(failed.status).toBe('answer_failed')
    answering = await repository.beginAnswer({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: failed.revision,
    })

    const answer = {
      answer: 'The durable integration reading.',
      model: MODEL,
      prompt: 'Canonical integration answer prompt.',
    }
    const answered = await repository.storeAnswer({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: answering.revision,
      answer,
    })
    expect(answered).toMatchObject({
      status: 'answered',
      answer,
    })
    await expect(
      repository.storeAnswer({
        ownerId: OWNER,
        gameId: GAME_ID,
        expectedRevision: answering.revision,
        answer,
      }),
    ).resolves.toMatchObject({
      status: 'answered',
      answer,
    })

    await expect(repository.getCurrentGame(OWNER)).resolves.toMatchObject({
      id: GAME_ID,
      status: 'answered',
    })

    const currentRows = await database.adapter.query({
      text: `
        SELECT id::text
        FROM games
        WHERE clerk_user_id = $1
          AND is_current
      `,
      values: [OWNER],
    })
    expect(currentRows.rows).toEqual([{ id: GAME_ID }])
  })

  it('abandons an active game idempotently and clears refresh recovery', async () => {
    const playing = await createPlayingGame()
    const abandoned = await repository.abandonGame({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: playing.revision,
      idempotencyKey: idempotencyKey(250),
    })
    expect(abandoned).toMatchObject({
      status: 'abandoned',
      isCurrent: false,
      revision: playing.revision + 1,
    })
    await expect(
      repository.abandonGame({
        ownerId: OWNER,
        gameId: GAME_ID,
        expectedRevision: playing.revision,
        idempotencyKey: idempotencyKey(250),
      }),
    ).resolves.toMatchObject({
      status: 'abandoned',
      isCurrent: false,
      revision: playing.revision + 1,
    })
    await expect(repository.getCurrentGame(OWNER)).resolves.toBeNull()
  })

  it.each(['dividing', 'division_failed'] as const)(
    'abandons a pre-division %s shell and clears refresh recovery',
    async (status) => {
      let shell = (await repository.getOrCreateDivision({
        ownerId: OWNER,
        gameId: GAME_ID,
        problem: PROBLEM,
        softwareVersion: SOFTWARE_VERSION,
        researchConsent: RESEARCH_CONSENT,
      })).game
      if (status === 'division_failed') {
        shell = await repository.failDivision({
          ownerId: OWNER,
          gameId: GAME_ID,
          expectedRevision: shell.revision,
        })
      }

      const abandoned = await repository.abandonGame({
        ownerId: OWNER,
        gameId: GAME_ID,
        expectedRevision: shell.revision,
        idempotencyKey: idempotencyKey(251),
      })
      expect(abandoned).toMatchObject({
        status: 'abandoned',
        isCurrent: false,
        revision: shell.revision + 1,
        division: null,
        game: null,
      })
      await expect(repository.getCurrentGame(OWNER)).resolves.toBeNull()

      const rows = await database.adapter.query<{
        division_seed: string | null
        division_facets: unknown
        problem_parts: unknown
      }>({
        text: `
          SELECT division_seed, division_facets, problem_parts
          FROM games
          WHERE id = $1::uuid
        `,
        values: [GAME_ID],
      })
      expect(rows.rows).toEqual([{
        division_seed: null,
        division_facets: null,
        problem_parts: null,
      }])
    },
  )
})

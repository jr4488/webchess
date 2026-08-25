import { describe, expect, it, vi } from 'vitest'

import type {
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
  SqlTransactionOptions,
} from '../db/sql'
import { loadUsageConfig, usageConfigDefaults } from './config'
import {
  hashIpRateKey,
  hashUserRateKey,
} from './identifiers'
import {
  acquireUsageLockSql,
  activateReplayGameSql,
  beginProviderCallSql,
  attachModelRequestGameSql,
  cleanupExpiredLeasesSql,
  cleanupExpiredRateBucketsSql,
  consumeAccountExportRateSql,
  consumeGameMoveRateSql,
  consumeReplayGameStartSql,
  consumeWilburMutationRateSql,
  deleteAccountDataSql,
  deleteAccountGamesSql,
  ensureUsageBucketsSql,
  getModelRequestByIdempotencyKeySql,
  releaseReservationSql,
  reserveModelRequestSql,
  settleModelRequestSql,
  usageSummarySql,
  verifyReplayGameInvariantSql,
} from './queries'
import { createUsageController } from './service'
import type { UsageConfig } from './types'

const NOW = new Date('2026-07-26T19:12:34.000Z')
const HMAC_SECRET = 's'.repeat(48)
const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const LEASE_TOKEN = '33333333-3333-4333-8333-333333333333'
const USER_ID = 'user_clerk_123'
const IP_ADDRESS = '203.0.113.41'
const SHA = 'a'.repeat(64)

const CONFIG: UsageConfig = {
  hmacSecret: HMAC_SECRET,
  deletionHmacSecret: 'd'.repeat(48),
  dailyGameLimit: 2,
  dailyModelRequestLimit: 100,
  dailyGlobalModelRequestLimit: 200,
  hourlyModelRequestLimit: 20,
  hourlyIpModelRequestLimit: 40,
  hourlyGameStartLimit: 20,
  hourlyIpGameStartLimit: 40,
  hourlyGameMoveLimit: 600,
  hourlyIpGameMoveLimit: 1_200,
  hourlyAccountExportLimit: 2,
  hourlyIpAccountExportLimit: 10,
  hourlyWilburActionLimit: 120,
  hourlyIpWilburActionLimit: 240,
  hourlyWilburObservationLimit: 60,
  hourlyIpWilburObservationLimit: 120,
  concurrentModelLimit: 1,
  globalModelConcurrentLimit: 4,
  modelLeaseSeconds: 180,
}

function sqlResult(rows: readonly SqlRow[]): SqlResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    rows,
  }
}

class FakeSqlAdapter implements SqlAdapter {
  readonly transactions: Array<{
    readonly statements: readonly SqlStatement[]
    readonly options: SqlTransactionOptions | undefined
  }> = []

  readonly queries: SqlStatement[] = []

  transactionResults: readonly SqlResult[] = []
  queryResult: SqlResult = sqlResult([])

  async query<Row extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>> {
    this.queries.push(statement)
    return this.queryResult as SqlResult<Row>
  }

  async transaction(
    statements: readonly SqlStatement[],
    options?: SqlTransactionOptions,
  ): Promise<readonly SqlResult[]> {
    this.transactions.push({ statements, options })
    return this.transactionResults
  }
}

function reserveInput() {
  return {
    requestId: REQUEST_ID,
    userId: USER_ID,
    gameId: null,
    operation: 'division' as const,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestSha256: SHA,
    provider: 'openai',
    model: 'gpt-5.6-sol',
    promptVersion: 'division-v1',
    softwareVersion: 'test',
    countsAsGameStart: true,
    ipAddress: IP_ADDRESS,
  }
}

function wilburRateInput(
  overrides: Partial<{
    userId: string
    ipAddress: string
    kind: 'action' | 'observation'
    operation: 'create_action' | 'update_action' | 'append_observation'
    idempotencyKey: string
    requestDigest: string
  }> = {},
) {
  return {
    userId: USER_ID,
    ipAddress: IP_ADDRESS,
    kind: 'action' as const,
    operation: 'create_action' as const,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestDigest: SHA,
    ...overrides,
  }
}

function controllerWith(
  db: FakeSqlAdapter,
  config: UsageConfig = CONFIG,
) {
  return createUsageController({
    db,
    config,
    now: () => new Date(NOW),
    randomUuid: () => LEASE_TOKEN,
  })
}

describe('usage configuration', () => {
  it('loads conservative defaults and requires a strong HMAC secret', () => {
    expect(
      loadUsageConfig({
        WEBCHESS_HMAC_SECRET: HMAC_SECRET,
        WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
      }),
    ).toEqual({
      hmacSecret: HMAC_SECRET,
      deletionHmacSecret: 'd'.repeat(48),
      dailyGameLimit: 2,
      dailyModelRequestLimit: 100,
      dailyGlobalModelRequestLimit: 200,
      hourlyModelRequestLimit: 20,
      hourlyIpModelRequestLimit: 40,
      hourlyGameStartLimit: 20,
      hourlyIpGameStartLimit: 40,
      hourlyGameMoveLimit: 600,
      hourlyIpGameMoveLimit: 1_200,
      hourlyAccountExportLimit: 2,
      hourlyIpAccountExportLimit: 10,
      hourlyWilburActionLimit: 120,
      hourlyIpWilburActionLimit: 240,
      hourlyWilburObservationLimit: 60,
      hourlyIpWilburObservationLimit: 120,
      concurrentModelLimit: 1,
      globalModelConcurrentLimit: 4,
      modelLeaseSeconds: 335,
    })
    expect(usageConfigDefaults).toMatchObject({
      dailyGameLimit: 2,
      dailyModelRequestLimit: 100,
      dailyGlobalModelRequestLimit: 200,
      hourlyModelRequestLimit: 20,
      hourlyWilburActionLimit: 120,
      hourlyIpWilburActionLimit: 240,
      hourlyWilburObservationLimit: 60,
      hourlyIpWilburObservationLimit: 120,
      concurrentModelLimit: 1,
      globalModelConcurrentLimit: 4,
    })
    expect(() => loadUsageConfig({ WEBCHESS_HMAC_SECRET: 'too-short' })).toThrow(
      /at least 32 bytes/,
    )
    expect(() => loadUsageConfig({
      WEBCHESS_HMAC_SECRET: HMAC_SECRET,
      WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
      WEBCHESS_MODEL_LEASE_SECONDS: '334',
    })).toThrow(/at least 335/u)
  })

  it('rejects an app concurrency value that the schema cannot enforce', () => {
    expect(() =>
      loadUsageConfig({
        WEBCHESS_HMAC_SECRET: HMAC_SECRET,
        WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
        WEBCHESS_CONCURRENT_MODEL_LIMIT: '2',
      }),
    ).toThrow(/at most 1/)
  })

  it('loads independent Wilbur action and observation limits', () => {
    expect(
      loadUsageConfig({
        WEBCHESS_HMAC_SECRET: HMAC_SECRET,
        WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
        WEBCHESS_HOURLY_WILBUR_ACTION_LIMIT: '11',
        WEBCHESS_HOURLY_IP_WILBUR_ACTION_LIMIT: '12',
        WEBCHESS_HOURLY_WILBUR_OBSERVATION_LIMIT: '13',
        WEBCHESS_HOURLY_IP_WILBUR_OBSERVATION_LIMIT: '14',
      }),
    ).toMatchObject({
      hourlyWilburActionLimit: 11,
      hourlyIpWilburActionLimit: 12,
      hourlyWilburObservationLimit: 13,
      hourlyIpWilburObservationLimit: 14,
    })
  })

  it.each([
    ['WEBCHESS_HOURLY_WILBUR_ACTION_LIMIT', '100001', 100_000],
    ['WEBCHESS_HOURLY_IP_WILBUR_ACTION_LIMIT', '1000001', 1_000_000],
    ['WEBCHESS_HOURLY_WILBUR_OBSERVATION_LIMIT', '100001', 100_000],
    ['WEBCHESS_HOURLY_IP_WILBUR_OBSERVATION_LIMIT', '1000001', 1_000_000],
  ] as const)('bounds %s at its durable maximum', (name, value, maximum) => {
    expect(() =>
      loadUsageConfig({
        WEBCHESS_HMAC_SECRET: HMAC_SECRET,
        WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(48),
        [name]: value,
      }),
    ).toThrow(`must be at most ${maximum}`)
  })
})

describe('pseudonymous identifiers', () => {
  it('domain-separates persisted user and IP rate-limit keys', () => {
    const userRateKey = hashUserRateKey(HMAC_SECRET, USER_ID)
    const ipRateKey = hashIpRateKey(HMAC_SECRET, USER_ID)

    expect(userRateKey).toMatch(/^[0-9a-f]{64}$/)
    expect(ipRateKey).toMatch(/^[0-9a-f]{64}$/)
    expect(userRateKey).not.toBe(ipRateKey)
    expect(userRateKey).not.toContain(USER_ID)
    expect(ipRateKey).not.toContain(USER_ID)
  })
})

describe('reservation lifecycle', () => {
  it('reserves through a serializable two-statement Neon transaction', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ cleared_slots: 0 }]),
      sqlResult([]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          request_id: REQUEST_ID,
          game_id: null,
          status: 'reserved',
          lease_token: LEASE_TOKEN,
          lease_expires_at: '2026-07-26T19:15:34.000Z',
        },
      ]),
    ]

    const result = await controllerWith(db).reserveModelRequest(reserveInput())

    expect(result).toEqual({
      ok: true,
      kind: 'reserved',
      requestId: REQUEST_ID,
      gameId: null,
      status: 'reserved',
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: '2026-07-26T19:15:34.000Z',
    })
    expect(db.transactions).toHaveLength(1)
    const transaction = db.transactions[0]
    expect(transaction?.options).toEqual({ isolationLevel: 'ReadCommitted' })
    expect(transaction?.statements).toHaveLength(5)
    expect(transaction?.statements[0]?.text).toBe(acquireUsageLockSql)
    expect(transaction?.statements[1]?.text).toBe(cleanupExpiredLeasesSql)
    expect(transaction?.statements[2]?.text).toBe(
      cleanupExpiredRateBucketsSql,
    )
    expect(transaction?.statements[3]?.text).toBe(ensureUsageBucketsSql)
    expect(transaction?.statements[4]?.text).toBe(reserveModelRequestSql)

    const reservationValues = transaction?.statements[4]?.values ?? []
    expect(reservationValues).not.toContain(IP_ADDRESS)
    expect(reservationValues).toContain(
      hashIpRateKey(HMAC_SECRET, IP_ADDRESS),
    )
    expect(reservationValues).toContain(
      hashUserRateKey(HMAC_SECRET, USER_ID),
    )
  })

  it('replays a matching idempotent reservation without a new lease', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ cleared_slots: 0 }]),
      sqlResult([]),
      sqlResult([]),
      sqlResult([
        {
          code: 'EXISTING',
          retry_at: null,
          request_id: REQUEST_ID,
          game_id: null,
          status: 'succeeded',
          lease_token: null,
          lease_expires_at: null,
        },
      ]),
    ]

    await expect(
      controllerWith(db).reserveModelRequest(reserveInput()),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'existing',
      requestId: REQUEST_ID,
      gameId: null,
      status: 'succeeded',
      leaseToken: null,
    })
  })

  it('uses an explicit fixed lease cap for an Answer reservation', async () => {
    const db = new FakeSqlAdapter()
    const leaseExpiresAtCap = new Date(NOW.valueOf() + 335_000)
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ cleared_slots: 0 }]),
      sqlResult([]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          request_id: REQUEST_ID,
          game_id: REQUEST_ID,
          status: 'reserved',
          lease_token: LEASE_TOKEN,
          lease_expires_at: leaseExpiresAtCap,
        },
      ]),
    ]

    await expect(controllerWith(db, {
      ...CONFIG,
      modelLeaseSeconds: 335,
    }).reserveModelRequest({
      ...reserveInput(),
      gameId: REQUEST_ID,
      operation: 'answer',
      promptVersion: 'answer-v1',
      countsAsGameStart: false,
      leaseExpiresAtCap,
    })).resolves.toMatchObject({
      ok: true,
      kind: 'reserved',
      leaseExpiresAt: leaseExpiresAtCap.toISOString(),
    })

    const statement = db.transactions[0]?.statements[4]
    expect(statement?.values?.at(-1)).toBe(leaseExpiresAtCap.toISOString())
    expect(statement?.text).toContain('$28::timestamptz')
    expect(statement?.text).toContain("WHEN $4::text = 'answer' THEN least(")
  })

  it.each([
    ['ACCOUNT_SUSPENDED', 403, null],
    ['IDEMPOTENCY_CONFLICT', 409, null],
    ['MODEL_GLOBAL_DAILY_CAPACITY', 503, 17246],
    ['MODEL_HOURLY_RATE_LIMITED', 429, 2846],
    ['MODEL_GLOBAL_CAPACITY', 503, 6],
  ] as const)(
    'maps %s to an exact HTTP status and retry interval',
    async (code, httpStatus, retryAfterSeconds) => {
      const db = new FakeSqlAdapter()
      db.transactionResults = [
        sqlResult([{ held: null }]),
        sqlResult([{ cleared_slots: 0 }]),
        sqlResult([]),
        sqlResult([]),
        sqlResult([
          {
            code,
            retry_at:
              retryAfterSeconds === null
                ? null
                : new Date(NOW.valueOf() + retryAfterSeconds * 1000),
            request_id: null,
            game_id: null,
            status: null,
            lease_token: null,
            lease_expires_at: null,
          },
        ]),
      ]

      await expect(
        controllerWith(db).reserveModelRequest(reserveInput()),
      ).resolves.toEqual({
        ok: false,
        code,
        httpStatus,
        retryAfterSeconds,
      })
    },
  )

  it('rejects counting an answer as a game start before touching SQL', async () => {
    const db = new FakeSqlAdapter()
    const controller = controllerWith(db)

    await expect(
      controller.reserveModelRequest({
        ...reserveInput(),
        operation: 'answer',
      }),
    ).rejects.toThrow(/Division requests must count/)
    expect(db.transactions).toHaveLength(0)
  })

  it('rejects an Answer reservation without a fixed recovery cap', async () => {
    const db = new FakeSqlAdapter()

    await expect(controllerWith(db).reserveModelRequest({
      ...reserveInput(),
      gameId: REQUEST_ID,
      operation: 'answer',
      promptVersion: 'answer-v1',
      countsAsGameStart: false,
    })).rejects.toThrow(/fixed leaseExpiresAtCap/u)
    expect(db.transactions).toHaveLength(0)
  })

  it('attaches the deterministic game ID with owner and state checks in SQL', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALLOW', attached: 1 }]),
    ]

    await expect(
      controllerWith(db).attachModelRequestGame({
        userId: USER_ID,
        requestId: REQUEST_ID,
        gameId: REQUEST_ID,
      }),
    ).resolves.toEqual({ ok: true, attached: true })

    expect(db.transactions[0]?.statements[1]?.text).toBe(
      attachModelRequestGameSql,
    )
    expect(attachModelRequestGameSql).toContain(
      'games.clerk_user_id = $2::text',
    )
  })

  it('shares durable move limits across two controller instances and hashes IPs', async () => {
    const db = new FakeSqlAdapter()
    const limitedConfig: UsageConfig = {
      ...CONFIG,
      hourlyGameMoveLimit: 1,
      hourlyIpGameMoveLimit: 2,
    }
    const firstController = createUsageController({
      db,
      config: limitedConfig,
      now: () => new Date(NOW),
    })
    const secondController = createUsageController({
      db,
      config: limitedConfig,
      now: () => new Date(NOW),
    })

    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          user_count: 1,
          ip_count: 1,
          resets_at: '2026-07-26T20:00:00.000Z',
        },
      ]),
    ]
    await expect(
      firstController.consumeGameMoveRate({
        userId: USER_ID,
        ipAddress: IP_ADDRESS,
      }),
    ).resolves.toEqual({
      ok: true,
      remaining: { user: 0, ip: 1 },
      resetsAt: '2026-07-26T20:00:00.000Z',
    })

    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'GAME_MOVE_HOURLY_RATE_LIMITED',
          retry_at: '2026-07-26T20:00:00.000Z',
          user_count: 2,
          ip_count: 2,
          resets_at: '2026-07-26T20:00:00.000Z',
        },
      ]),
    ]
    await expect(
      secondController.consumeGameMoveRate({
        userId: USER_ID,
        ipAddress: IP_ADDRESS,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'GAME_MOVE_HOURLY_RATE_LIMITED',
      httpStatus: 429,
      retryAfterSeconds: 2846,
    })

    const moveStatement = db.transactions[1]?.statements[2]
    expect(moveStatement?.text).toBe(consumeGameMoveRateSql)
    expect(moveStatement?.values).not.toContain(IP_ADDRESS)
    expect(moveStatement?.values).toContain(
      hashIpRateKey(HMAC_SECRET, IP_ADDRESS),
    )
    expect(db.transactions[0]?.options).toEqual({
      isolationLevel: 'ReadCommitted',
    })
    expect(db.transactions[0]?.statements[0]?.text).toBe(acquireUsageLockSql)
    expect(db.transactions[0]?.statements[1]?.text).toBe(
      cleanupExpiredRateBucketsSql,
    )
    expect(db.transactions[1]?.options).toEqual({
      isolationLevel: 'ReadCommitted',
    })
  })

  it('durably rate-limits account exports without storing the raw IP address', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          user_count: 1,
          ip_count: 1,
          resets_at: '2026-07-26T20:00:00.000Z',
        },
      ]),
    ]

    await expect(
      controllerWith(db).consumeAccountExportRate({
        userId: USER_ID,
        ipAddress: IP_ADDRESS,
      }),
    ).resolves.toEqual({
      ok: true,
      remaining: { user: 1, ip: 9 },
      resetsAt: '2026-07-26T20:00:00.000Z',
    })

    const statement = db.transactions[0]?.statements[2]
    expect(statement?.text).toBe(consumeAccountExportRateSql)
    expect(statement?.values).not.toContain(IP_ADDRESS)
    expect(statement?.values).toContain(
      hashIpRateKey(HMAC_SECRET, IP_ADDRESS),
    )
    expect(db.transactions[0]?.statements[0]?.text).toBe(acquireUsageLockSql)
    expect(db.transactions[0]?.statements[1]?.text).toBe(
      cleanupExpiredRateBucketsSql,
    )
  })

  it('durably admits Wilbur actions with independent hashed user and IP limits', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          user_count: 1,
          ip_count: 1,
          resets_at: '2026-07-26T20:00:00.000Z',
          persisted: 1,
        },
      ]),
    ]

    await expect(
      controllerWith(db).consumeWilburMutationRate({
        ...wilburRateInput(),
      }),
    ).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      remaining: { user: 119, ip: 239 },
      resetsAt: '2026-07-26T20:00:00.000Z',
    })

    const statement = db.transactions[0]?.statements[2]
    expect(statement?.text).toBe(consumeWilburMutationRateSql)
    expect(statement?.values).not.toContain(IP_ADDRESS)
    expect(statement?.values).toContain(hashIpRateKey(HMAC_SECRET, IP_ADDRESS))
    expect(statement?.values?.slice(5, 10)).toEqual([
      120,
      240,
      'wilbur_action',
      'WILBUR_ACTION_HOURLY_RATE_LIMITED',
      'IP_WILBUR_ACTION_HOURLY_RATE_LIMITED',
    ])
    expect(statement?.values?.slice(11)).toEqual([
      'create_action',
      IDEMPOTENCY_KEY,
      SHA,
      'action',
    ])
    expect(consumeWilburMutationRateSql.indexOf('user_decision AS')).toBeLessThan(
      consumeWilburMutationRateSql.indexOf('ip_rate AS'),
    )
    expect(consumeWilburMutationRateSql).toContain(
      "WHERE user_decision.code = 'CONTINUE'",
    )
  })

  it('does not debit either rate bucket for an already-admitted exact replay', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([{
        code: 'EXISTING',
        retry_at: null,
        user_count: 1,
        ip_count: 1,
        resets_at: '2026-07-26T20:00:00.000Z',
      }]),
    ]

    await expect(
      controllerWith(db).consumeWilburMutationRate(wilburRateInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'existing',
      remaining: { user: 119, ip: 239 },
      resetsAt: '2026-07-26T20:00:00.000Z',
    })
    expect(consumeWilburMutationRateSql).toContain(
      "request_state.rate_admitted_at IS NOT NULL",
    )
    expect(consumeWilburMutationRateSql).toContain(
      "request_state.status = 'committed'",
    )
  })

  it.each([
    ['action', 'WILBUR_ACTION_HOURLY_RATE_LIMITED'],
    ['action', 'IP_WILBUR_ACTION_HOURLY_RATE_LIMITED'],
    ['observation', 'WILBUR_OBSERVATION_HOURLY_RATE_LIMITED'],
    ['observation', 'IP_WILBUR_OBSERVATION_HOURLY_RATE_LIMITED'],
  ] as const)('returns the distinct %s denial %s', async (kind, code) => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([
        {
          code,
          retry_at: '2026-07-26T20:00:00.000Z',
          user_count: 121,
          ip_count: 241,
          resets_at: '2026-07-26T20:00:00.000Z',
        },
      ]),
    ]

    await expect(
      controllerWith(db).consumeWilburMutationRate({
        ...wilburRateInput({
          kind,
          operation: kind === 'action'
            ? 'create_action'
            : 'append_observation',
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code,
      httpStatus: 429,
      retryAfterSeconds: 2846,
    })

    const expected = kind === 'action'
      ? [120, 240, 'wilbur_action']
      : [60, 120, 'wilbur_observation']
    expect(db.transactions[0]?.statements[2]?.values?.slice(5, 8)).toEqual(
      expected,
    )
  })

  it.each([
    'WILBUR_MUTATION_CONFLICT',
    'WILBUR_MUTATION_EXPIRED',
  ] as const)('replays the terminal Wilbur intent denial %s', async (code) => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([]),
      sqlResult([{
        code,
        retry_at: null,
        user_count: 0,
        ip_count: 0,
        resets_at: '2026-07-26T20:00:00.000Z',
      }]),
    ]

    await expect(controllerWith(db).consumeWilburMutationRate(
      wilburRateInput(),
    )).resolves.toEqual({
      ok: false,
      code,
      httpStatus: 409,
      retryAfterSeconds: null,
    })
  })

  it('rejects an invalid Wilbur mutation kind before touching SQL', async () => {
    const db = new FakeSqlAdapter()

    await expect(
      controllerWith(db).consumeWilburMutationRate({
        ...wilburRateInput(),
        kind: 'invalid' as 'action',
      }),
    ).rejects.toThrow(/kind must be action or observation/)
    expect(db.transactions).toHaveLength(0)
  })

  it('validates Wilbur ledger identity before touching SQL', async () => {
    const db = new FakeSqlAdapter()
    const usage = controllerWith(db)

    await expect(usage.consumeWilburMutationRate(wilburRateInput({
      operation: 'invalid' as 'create_action',
    }))).rejects.toThrow(/operation must be/)
    await expect(usage.consumeWilburMutationRate(wilburRateInput({
      operation: 'append_observation',
    }))).rejects.toThrow(/operation and kind/)
    await expect(usage.consumeWilburMutationRate(wilburRateInput({
      idempotencyKey: 'not-a-uuid',
    }))).rejects.toThrow(/idempotencyKey must be a UUID/)
    await expect(usage.consumeWilburMutationRate(wilburRateInput({
      requestDigest: 'not-a-digest',
    }))).rejects.toThrow(/requestDigest must be a lowercase SHA-256/)
    expect(db.transactions).toHaveLength(0)
  })

  it('consumes one durable replay game start and reuses its idempotency ledger', async () => {
    const db = new FakeSqlAdapter()
    const usage = controllerWith(db)
    const input = {
      userId: USER_ID,
      sourceGameId: REQUEST_ID,
      expectedRevision: 12,
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: IP_ADDRESS,
    }
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{
        code: 'ALLOW',
        retry_at: null,
        game_id: IDEMPOTENCY_KEY,
      }]),
      sqlResult([{ game_id: IDEMPOTENCY_KEY }]),
      sqlResult([{ integrity_gate: 1 }]),
    ]

    await expect(usage.consumeReplayGameStart(input)).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: IDEMPOTENCY_KEY,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(consumeReplayGameStartSql)
    expect(statement?.values).not.toContain(IP_ADDRESS)
    expect(statement?.values).toContain(
      hashIpRateKey(HMAC_SECRET, IP_ADDRESS),
    )
    expect(statement?.values?.slice(0, 4)).toEqual([
      USER_ID,
      REQUEST_ID,
      12,
      IDEMPOTENCY_KEY,
    ])
    expect(consumeReplayGameStartSql).toContain(
      'WHEN EXISTS (SELECT 1 FROM existing) THEN',
    )
    expect(consumeReplayGameStartSql).toContain(
      'used = usage_buckets.used + 1',
    )
    expect(db.transactions[0]?.statements[2]?.text).toBe(
      activateReplayGameSql,
    )
    expect(db.transactions[0]?.statements[3]?.text).toBe(
      verifyReplayGameInvariantSql,
    )
    expect(db.transactions[0]?.options).toEqual({
      isolationLevel: 'ReadCommitted',
    })

    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{
        code: 'EXISTING',
        retry_at: null,
        game_id: IDEMPOTENCY_KEY,
      }]),
      sqlResult([{ game_id: IDEMPOTENCY_KEY }]),
      sqlResult([{ integrity_gate: 1 }]),
    ]
    await expect(usage.consumeReplayGameStart(input)).resolves.toEqual({
      ok: true,
      kind: 'existing',
      gameId: IDEMPOTENCY_KEY,
    })
  })

  it('moves a reservation to provider usage before the network call', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALLOW' }]),
    ]

    await expect(
      controllerWith(db).beginProviderCall({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'in_progress',
      alreadyStarted: false,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(beginProviderCallSql)
    expect(statement?.text).toContain('reserved = greatest(buckets.reserved - 1')
    expect(statement?.text).toContain("status = 'in_progress'")
  })

  it('renews an in-progress request lease without consuming provider usage twice', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALREADY_STARTED' }]),
    ]

    await expect(
      controllerWith(db).beginProviderCall({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'in_progress',
      alreadyStarted: true,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(beginProviderCallSql)
    expect(statement?.values?.slice(0, 5)).toEqual([
      REQUEST_ID,
      USER_ID,
      LEASE_TOKEN,
      NOW.toISOString(),
      '2026-07-26T19:15:34.000Z',
    ])
    expect(statement?.text).toContain("decision.code = 'ALLOW'")
    expect(statement?.text).toContain("decision.code IN ('ALLOW', 'ALREADY_STARTED')")
    expect(statement?.text).toContain('ELSE $5::timestamptz')
  })

  it('never extends an Answer lease during an in-progress renewal', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALREADY_STARTED' }]),
    ]

    await expect(
      controllerWith(db).beginProviderCall({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyStarted: true,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toContain("request_state.operation = 'answer'")
    expect(statement?.text).toContain('request_state.lease_expires_at')
  })

  it.each([
    ['ACCOUNT_DELETED', 403],
    ['ACCOUNT_SUSPENDED', 403],
    ['ACCOUNT_TEMPORARILY_BLOCKED', 403],
    ['LEASE_EXPIRED', 410],
  ] as const)(
    'blocks provider start with %s at the durable transition seam',
    async (code, httpStatus) => {
      const db = new FakeSqlAdapter()
      db.transactionResults = [
        sqlResult([{ held: null }]),
        sqlResult([{ code }]),
      ]

      await expect(
        controllerWith(db).beginProviderCall({
          userId: USER_ID,
          requestId: REQUEST_ID,
          leaseToken: LEASE_TOKEN,
        }),
      ).resolves.toEqual({
        ok: false,
        code,
        httpStatus,
      })
      expect(db.transactions[0]?.statements[1]?.text).toBe(
        beginProviderCallSql,
      )
    },
  )

  it('settles success idempotently and records exact token usage', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALREADY_SETTLED' }]),
    ]
    const responseSha = 'b'.repeat(64)

    await expect(
      controllerWith(db).settleModelRequest({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'succeeded',
        providerResponseId: 'resp_123',
        responseSha256: responseSha,
        resultPayload: { facets: [] },
        usage: {
          reported: true,
          inputTokens: 12,
          cachedInputTokens: 3,
          cacheWriteInputTokens: 2,
          outputTokens: 9,
          reasoningTokens: 4,
          totalTokens: 21,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      alreadySettled: true,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(settleModelRequestSql)
    expect(statement?.values).toEqual([
      REQUEST_ID,
      USER_ID,
      LEASE_TOKEN,
      'succeeded',
      'resp_123',
      responseSha,
      null,
      null,
      NOW.toISOString(),
      12,
      3,
      2,
      9,
      4,
      21,
      '{"facets":[]}',
      true,
    ])
  })

  it('rejects a late settlement after the durable provider lease expires', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'LEASE_EXPIRED' }]),
    ]

    await expect(
      controllerWith(db).settleModelRequest({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'failed',
        failureCode: 'provider_timeout',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    expect(db.transactions[0]?.statements[1]?.text).toBe(
      settleModelRequestSql,
    )
  })

  it('persists and idempotently compares a sanitized failed-response provider ID', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALREADY_SETTLED' }]),
    ]

    await expect(
      controllerWith(db).settleModelRequest({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'failed',
        failureCode: 'provider_contract_invalid',
        providerResponseId: 'resp_failed_123',
        providerHttpStatus: 422,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'failed',
      alreadySettled: true,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(settleModelRequestSql)
    expect(statement?.values?.slice(3, 9)).toEqual([
      'failed',
      'resp_failed_123',
      null,
      'provider_contract_invalid',
      422,
      NOW.toISOString(),
    ])
    expect(settleModelRequestSql).toContain(
      'provider_response_id FROM request_state',
    )
    expect(settleModelRequestSql).toContain(
      'provider_response_id = $5::text',
    )
    expect(settleModelRequestSql).toContain(
      "= 'operation_already_succeeded'",
    )
    expect(settleModelRequestSql).toContain(
      "request_state.status = 'in_progress'",
    )
  })

  it('persists an indeterminate timeout idempotently and releases its durable slot', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALREADY_SETTLED' }]),
    ]

    await expect(
      controllerWith(db).settleModelRequest({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'indeterminate',
        failureCode: 'answer_operation_timeout',
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'indeterminate',
      alreadySettled: true,
    })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(settleModelRequestSql)
    expect(statement?.values?.slice(3, 9)).toEqual([
      'indeterminate',
      null,
      null,
      'answer_operation_timeout',
      null,
      NOW.toISOString(),
    ])
    expect(settleModelRequestSql).toContain(
      "$4::text IN ('failed', 'indeterminate')",
    )
    expect(settleModelRequestSql).toContain(
      "SET\n    request_id = NULL",
    )
    expect(settleModelRequestSql).toContain(
      'slots.request_id = completed_request.id',
    )
  })

  it('rejects reasoning traces in a durable result payload before SQL', async () => {
    const db = new FakeSqlAdapter()

    await expect(
      controllerWith(db).settleModelRequest({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'succeeded',
        providerResponseId: 'resp_123',
        responseSha256: 'b'.repeat(64),
        resultPayload: { reasoning: 'private trace' },
        usage: {
          reported: true,
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
          totalTokens: 2,
        },
      }),
    ).rejects.toThrow(/not allowed in resultPayload/)
    expect(db.transactions).toHaveLength(0)
  })

  it('persists unreported provider usage as unknown rather than zero', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALLOW' }]),
    ]

    await controllerWith(db).settleModelRequest({
      userId: USER_ID,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'succeeded',
      providerResponseId: 'resp_without_usage',
      responseSha256: 'c'.repeat(64),
      resultPayload: { answer: 'Validated result.' },
      usage: {
        reported: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
    })

    const values = db.transactions[0]?.statements[1]?.values
    expect(values?.slice(9, 15)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(values?.[16]).toBe(false)
  })

  it('releases an unstarted reservation and refunds both quota holds', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALLOW' }]),
    ]

    await expect(
      controllerWith(db).releaseReservation({
        userId: USER_ID,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        reason: 'provider_not_started',
      }),
    ).resolves.toEqual({ ok: true, released: true })

    const statement = db.transactions[0]?.statements[1]
    expect(statement?.text).toBe(releaseReservationSql)
    expect(statement?.values?.[4]).toBe('released_provider_not_started')
    expect(statement?.text).toContain('refund_model_reservation')
    expect(statement?.text).toContain('refund_game_reservation')
    expect(statement?.text).toContain(
      "status FROM request_state) NOT IN ('reserved', 'in_progress')",
    )
    expect(statement?.text).toContain(
      "$5::text <> 'released_provider_not_started'",
    )
    expect(statement?.text).toContain(
      "WHEN request_state.status = 'in_progress' THEN 1",
    )
    expect(statement?.text).toContain('provider_started_at = CASE')
  })

  it('reconciles expired leases through the durable lock protocol', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ expired_requests: '2', cleared_slots: 2 }]),
    ]

    await expect(
      controllerWith(db).reconcileExpiredLeases(),
    ).resolves.toEqual({
      expiredRequests: 2,
      clearedSlots: 2,
    })
  })

  it('blocks self deletion only for in-progress work and lets verified force win', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ expired_requests: 0, cleared_slots: 0 }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ACTIVE_MODEL_REQUEST',
          retry_at: '2026-07-26T19:15:34.000Z',
          deleted: false,
        },
      ]),
    ]

    await expect(
      controllerWith(db).deleteAccountData(USER_ID),
    ).resolves.toEqual({
      ok: false,
      code: 'ACTIVE_MODEL_REQUEST',
      httpStatus: 409,
      retryAfterSeconds: 180,
    })
    expect(db.transactions[0]?.statements[2]?.text).toBe(deleteAccountGamesSql)
    expect(db.transactions[0]?.statements[2]?.values).toEqual([
      USER_ID,
      NOW.toISOString(),
      false,
    ])
    expect(deleteAccountGamesSql).toContain("requests.status = 'in_progress'")
    expect(deleteAccountGamesSql).toContain('NOT $3::boolean')
    expect(db.transactions[0]?.statements[3]?.text).toBe(deleteAccountDataSql)
    expect(db.transactions[0]?.statements[3]?.values?.[3]).toBe(false)
    expect(deleteAccountDataSql).toContain("'ACCOUNT_DELETION_PENDING'")
    expect(deleteAccountDataSql).toContain('tombstone_user AS')
    expect(deleteAccountDataSql).toContain(
      "requests.status = 'in_progress'",
    )
    expect(deleteAccountDataSql).toContain(
      'NOT $4::boolean\n        AND EXISTS',
    )
    expect(deleteAccountDataSql).toContain(
      "requests.status = 'reserved'",
    )
    expect(deleteAccountDataSql).toContain('refund_global_reservations AS')
    expect(deleteAccountDataSql).toContain('insert_deletion_barrier AS')

    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ expired_requests: 0, cleared_slots: 0 }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          deleted: true,
        },
      ]),
    ]
    await expect(
      controllerWith(db).deleteAccountData(USER_ID, { force: true }),
    ).resolves.toEqual({
      ok: true,
      deleted: true,
    })
    expect(db.transactions[1]?.statements[2]?.values?.[2]).toBe(true)
    expect(db.transactions[1]?.statements[3]?.values?.[3]).toBe(true)
  })

  it('allows self deletion to cancel reserved work and retain a pending control', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ expired_requests: 0, cleared_slots: 0 }]),
      sqlResult([]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          deleted: true,
        },
      ]),
    ]

    await expect(
      controllerWith(db).deleteAccountData(USER_ID),
    ).resolves.toEqual({
      ok: true,
      deleted: true,
    })
    expect(db.transactions[0]?.statements[2]?.values?.[2]).toBe(false)
    expect(db.transactions[0]?.statements[3]?.values?.[3]).toBe(false)
    expect(db.transactions[0]?.statements[3]?.text).toContain(
      "'ACCOUNT_DELETION_PENDING'",
    )
  })
})

describe('usage summaries', () => {
  it('reports UTC-day used, reserved, remaining, and active counts', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([
        {
          code: 'ALLOW',
          retry_at: null,
          model_used: '7',
          model_reserved: '2',
          game_used: 1,
          game_reserved: 1n,
          model_limit: 100,
          game_limit: '2',
          active_count: 1,
        },
      ]),
    ]

    await expect(controllerWith(db).getUsageSummary(USER_ID)).resolves.toEqual({
      period: {
        startsAt: '2026-07-26T00:00:00.000Z',
        endsAt: '2026-07-27T00:00:00.000Z',
      },
      modelOperations: {
        used: 7,
        reserved: 2,
        limit: 100,
        remaining: 91,
      },
      gameStarts: {
        used: 1,
        reserved: 1,
        limit: 2,
        remaining: 0,
      },
      activeModelRequests: 1,
    })
    expect(db.transactions[0]?.statements[0]?.text).toBe(acquireUsageLockSql)
    expect(db.transactions[0]?.statements[1]?.text).toBe(usageSummarySql)
    expect(db.transactions[0]?.options).toEqual({
      isolationLevel: 'ReadCommitted',
    })
  })

  it('denies a usage summary after the non-PII deletion barrier wins', async () => {
    const db = new FakeSqlAdapter()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([
        {
          code: 'ACCOUNT_DELETED',
          retry_at: null,
          model_used: 0,
          model_reserved: 0,
          game_used: 0,
          game_reserved: 0,
          model_limit: CONFIG.dailyModelRequestLimit,
          game_limit: CONFIG.dailyGameLimit,
          active_count: 0,
        },
      ]),
    ]

    await expect(
      controllerWith(db).getUsageSummary(USER_ID),
    ).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
      retryAfterSeconds: null,
    })
  })

  it('recovers owner-scoped persisted model output by request and game', async () => {
    const db = new FakeSqlAdapter()
    db.queryResult = sqlResult([
      {
        request_id: REQUEST_ID,
        game_id: REQUEST_ID,
        operation: 'answer',
        status: 'succeeded',
        result_payload: { answer: 'A concise answer.' },
      },
    ])
    const controller = controllerWith(db)

    await expect(
      controller.getModelRequestResult({
        userId: USER_ID,
        requestId: REQUEST_ID,
      }),
    ).resolves.toMatchObject({
      found: true,
      requestId: REQUEST_ID,
      status: 'succeeded',
      resultPayload: { answer: 'A concise answer.' },
    })
    await expect(
      controller.getModelRequestByIdempotencyKey({
        userId: USER_ID,
        operation: 'division',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({
      found: true,
      requestId: REQUEST_ID,
      gameId: REQUEST_ID,
    })
    await expect(
      controller.getLatestModelRequestForGame({
        userId: USER_ID,
        gameId: REQUEST_ID,
        operation: 'answer',
      }),
    ).resolves.toMatchObject({
      found: true,
      gameId: REQUEST_ID,
      operation: 'answer',
    })
    await expect(
      controller.getSucceededModelResultForGame({
        userId: USER_ID,
        gameId: REQUEST_ID,
        operation: 'answer',
      }),
    ).resolves.toMatchObject({
      found: true,
      status: 'succeeded',
      resultPayload: { answer: 'A concise answer.' },
    })
    expect(db.queries[0]?.values).toEqual([REQUEST_ID, USER_ID])
    expect(db.queries[1]?.text).toBe(getModelRequestByIdempotencyKeySql)
    expect(db.queries[1]?.values).toEqual([
      USER_ID,
      'division',
      IDEMPOTENCY_KEY,
    ])
    expect(db.queries[2]?.values).toEqual([
      REQUEST_ID,
      USER_ID,
      'answer',
      null,
      null,
    ])
    expect(db.queries[3]?.values).toEqual([
      REQUEST_ID,
      USER_ID,
      'answer',
      null,
      null,
    ])
  })

  it('rejects a malformed model-request idempotency key before SQL', async () => {
    const db = new FakeSqlAdapter()

    await expect(
      controllerWith(db).getModelRequestByIdempotencyKey({
        userId: USER_ID,
        operation: 'division',
        idempotencyKey: 'not-a-uuid',
      }),
    ).rejects.toThrow(/idempotencyKey must be a UUID/)
    expect(db.queries).toHaveLength(0)
  })
})

describe('atomic SQL invariants', () => {
  it('serializes lease mutations and never persists a raw address', () => {
    expect(cleanupExpiredLeasesSql).toContain('pg_advisory_xact_lock')
    expect(reserveModelRequestSql).toContain('pg_advisory_xact_lock')
    expect(beginProviderCallSql).toContain('pg_advisory_xact_lock')
    expect(settleModelRequestSql).toContain('pg_advisory_xact_lock')
    expect(releaseReservationSql).toContain('pg_advisory_xact_lock')
    expect(reserveModelRequestSql).not.toContain('ipAddress')
    expect(reserveModelRequestSql).not.toContain('clerk_user_id = $12')
  })

  it('keeps the provider call outside every database transaction', async () => {
    const db = new FakeSqlAdapter()
    const provider = vi.fn()
    db.transactionResults = [
      sqlResult([{ held: null }]),
      sqlResult([{ code: 'ALLOW' }]),
    ]

    await controllerWith(db).beginProviderCall({
      userId: USER_ID,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })

    expect(provider).not.toHaveBeenCalled()
    expect(db.transactions[0]?.statements).toHaveLength(2)
  })
})

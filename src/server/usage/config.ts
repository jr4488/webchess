import 'server-only'

import type { UsageConfig } from './types'

const DEFAULTS = {
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
  concurrentModelLimit: 1,
  globalModelConcurrentLimit: 4,
  modelLeaseSeconds: 180,
} as const

function readPositiveInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }

  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`)
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`${name} must be at most ${maximum}.`)
  }

  return value
}

export function loadUsageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): UsageConfig {
  const hmacSecret = env.WEBCHESS_HMAC_SECRET
  if (!hmacSecret || Buffer.byteLength(hmacSecret, 'utf8') < 32) {
    throw new Error(
      'WEBCHESS_HMAC_SECRET must contain at least 32 bytes of secret material.',
    )
  }
  const deletionHmacSecret = env.WEBCHESS_DELETION_HMAC_SECRET
  if (
    !deletionHmacSecret ||
    Buffer.byteLength(deletionHmacSecret, 'utf8') < 32
  ) {
    throw new Error(
      'WEBCHESS_DELETION_HMAC_SECRET must contain at least 32 bytes of secret material.',
    )
  }

  const concurrentModelLimit = readPositiveInteger(
    env,
    'WEBCHESS_CONCURRENT_MODEL_LIMIT',
    DEFAULTS.concurrentModelLimit,
    1,
  )
  const modelLeaseSeconds = readPositiveInteger(
    env,
    'WEBCHESS_MODEL_LEASE_SECONDS',
    DEFAULTS.modelLeaseSeconds,
    900,
  )
  if (modelLeaseSeconds < 150) {
    throw new Error(
      'WEBCHESS_MODEL_LEASE_SECONDS must be at least 150 so it exceeds the production OpenAI timeout with a safety margin.',
    )
  }

  return {
    hmacSecret,
    deletionHmacSecret,
    dailyGameLimit: readPositiveInteger(
      env,
      'WEBCHESS_DAILY_GAME_LIMIT',
      DEFAULTS.dailyGameLimit,
      10_000,
    ),
    dailyModelRequestLimit: readPositiveInteger(
      env,
      'WEBCHESS_DAILY_MODEL_REQUEST_LIMIT',
      DEFAULTS.dailyModelRequestLimit,
      100_000,
    ),
    dailyGlobalModelRequestLimit: readPositiveInteger(
      env,
      'WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT',
      DEFAULTS.dailyGlobalModelRequestLimit,
      1_000_000,
    ),
    hourlyModelRequestLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT',
      DEFAULTS.hourlyModelRequestLimit,
      10_000,
    ),
    hourlyIpModelRequestLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT',
      DEFAULTS.hourlyIpModelRequestLimit,
      100_000,
    ),
    hourlyGameStartLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_GAME_START_LIMIT',
      DEFAULTS.hourlyGameStartLimit,
      100_000,
    ),
    hourlyIpGameStartLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_IP_GAME_START_LIMIT',
      DEFAULTS.hourlyIpGameStartLimit,
      1_000_000,
    ),
    hourlyGameMoveLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_GAME_MOVE_LIMIT',
      DEFAULTS.hourlyGameMoveLimit,
      100_000,
    ),
    hourlyIpGameMoveLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_IP_GAME_MOVE_LIMIT',
      DEFAULTS.hourlyIpGameMoveLimit,
      1_000_000,
    ),
    hourlyAccountExportLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_ACCOUNT_EXPORT_LIMIT',
      DEFAULTS.hourlyAccountExportLimit,
      1_000,
    ),
    hourlyIpAccountExportLimit: readPositiveInteger(
      env,
      'WEBCHESS_HOURLY_IP_ACCOUNT_EXPORT_LIMIT',
      DEFAULTS.hourlyIpAccountExportLimit,
      10_000,
    ),
    concurrentModelLimit: concurrentModelLimit as 1,
    globalModelConcurrentLimit: readPositiveInteger(
      env,
      'WEBCHESS_GLOBAL_MODEL_CONCURRENT_LIMIT',
      DEFAULTS.globalModelConcurrentLimit,
      4,
    ),
    modelLeaseSeconds,
  }
}

export const usageConfigDefaults = Object.freeze({ ...DEFAULTS })

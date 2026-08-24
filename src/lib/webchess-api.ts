import type { GameView } from './game-contract'
import {
  isWebChessCaseProfile,
  WEBCHESS_CASE_BUNDLE_MAX_BYTES,
} from './case-bundle-contract'
import type {
  WebChessCaseDownload,
  WebChessCaseProfile,
  WebChessCaseVerificationResult,
} from './case-bundle-contract'
import {
  ASSUMPTION_RESULTS,
  CURRENT_WEB_MEMORY_CONSENT_VERSION,
  CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION,
  LIFECYCLE_STATES,
  WILBUR_ACTION_STATUSES,
} from './lifecycle/contracts'
import type {
  AssumptionResult,
  LifecycleActivity,
  LifecycleAggregate,
  WebMemoryEvidence,
  WilburAction,
  WilburActionStatus,
  WilburObservation,
  WebMemoryIndex,
} from './lifecycle/contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from './lifecycle/versions'
import {
  RESEARCH_CONSENT_VERSION,
  RESEARCH_STAGES,
  RESEARCH_STATUSES,
} from './research/contracts'
import type {
  ResearchConsent,
  ResearchConsentDecision,
  ResearchFetchFailure,
  ResearchRecord,
  ResearchRetrievedFact,
  ResearchSource,
} from './research/contracts'
import type {
  CellCoord,
  GeneratedAnswer,
  ProblemFacet,
  ProblemPart,
} from '../types'

export type DurableGameStatus =
  | 'dividing'
  | 'division_failed'
  | 'mapped'
  | 'playing'
  | 'completed'
  | 'answering'
  | 'answer_failed'
  | 'answered'
  | 'abandoned'
  | 'integrity_error'

export interface GameDivision {
  seed: string | number
  facets: readonly ProblemFacet[]
  parts: readonly ProblemPart[]
  model: string
  prompt?: string
}

/**
 * The complete player-visible game resource. Provider response identifiers,
 * usage ledgers, quota internals, provenance hashes, and Clerk identifiers are
 * intentionally absent.
 */
export interface DurableGame {
  id: string
  sourceGameId: string | null
  revision: number
  status: DurableGameStatus
  problem: string
  researchConsent: ResearchConsent
  division: GameDivision | null
  state: GameView | null
  answer: GeneratedAnswer | null
}

export interface MoveGameCommand {
  expectedRevision: number
  pieceId: string
  to: CellCoord
}

export interface RevisionCommand {
  expectedRevision: number
}

export interface AnswerGameResult {
  game: DurableGame
  answer: GeneratedAnswer
}

export interface RetryLifecycleResult {
  game: DurableGame | null
  lifecycle: LifecycleAggregate
}

export interface CreateWilburActionCommand {
  charlotteActionIndex: number
  actor: string
  action: string
  testedAssumption: string
  expectedObservation: string
  decisionThreshold: string
  reviewHorizon: string
  followUpAt: string | null
}

export interface UpdateWilburActionCommand {
  expectedRevision: number
  status: WilburActionStatus
  followUpAt: string | null
}

export interface DivideProblemOptions extends MutationOptions {
  researchConsentDecision: ResearchConsentDecision
  /** Explicitly selected prior Wilbur observations; never inferred silently. */
  memoryObservationIds?: readonly string[]
}

export interface AppendWilburObservationCommand {
  observedAt: string
  observation: string
  evidenceClassification: string
  expectedEffect: string
  unexpectedEffect: string
  stakeholderResponse: string
  assumptionResult: AssumptionResult
  nextDecision: string
}

export type WebChessApiErrorKind =
  | 'authentication-required'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'http-error'
  | 'invalid-response'
  | 'transport'

export class WebChessApiError extends Error {
  readonly kind: WebChessApiErrorKind
  /** Exact application-authored prompt returned for a failed model attempt. */
  readonly prompt: string | null
  readonly status: number | null
  readonly serverCode: string | null
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    options: {
      kind: WebChessApiErrorKind
      prompt?: string | null
      status?: number | null
      serverCode?: string | null
      retryAfterSeconds?: number | null
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'WebChessApiError'
    this.kind = options.kind
    this.prompt = options.prompt ?? null
    this.status = options.status ?? null
    this.serverCode = options.serverCode ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function isWebChessApiError(error: unknown): error is WebChessApiError {
  return error instanceof WebChessApiError
}

export interface RequestOptions {
  signal?: AbortSignal
}

export interface MutationOptions extends RequestOptions {
  /**
   * Reuse this value only when retrying the same intent after an ambiguous
   * transport failure. Ordinary callers should let the client create it.
   */
  idempotencyKey?: string
}

export interface DivideProblemOptions extends MutationOptions {
  researchConsentDecision: ResearchConsentDecision
}

const GAME_STATUSES: ReadonlySet<string> = new Set<DurableGameStatus>([
  'dividing',
  'division_failed',
  'mapped',
  'playing',
  'completed',
  'answering',
  'answer_failed',
  'answered',
  'abandoned',
  'integrity_error',
])

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidResponse(`${label} must be a non-empty string.`)
  }
  return value
}

function boundedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const text = nonEmptyString(value, label)
  if (text.length < minimum || text.length > maximum) {
    throw invalidResponse(
      `${label} must contain ${minimum} to ${maximum} characters.`,
    )
  }
  return text
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw invalidResponse(`${label} must be a non-negative integer.`)
  }
  return Number(value)
}

function boundedStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw invalidResponse(`${label} must be a bounded string array.`)
  }
  return value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, 1, 2_000))
}

function parseCaseVerificationEnvelope(
  value: unknown,
): WebChessCaseVerificationResult {
  const envelope = recordOf(value, 'Case verification response')
  const result = recordOf(envelope.verification, 'Case verification result')
  const replay = recordOf(result.replay, 'Case replay verification')
  if (
    typeof result.ok !== 'boolean' ||
    typeof replay.checked !== 'boolean' ||
    typeof replay.exactProblemMapping !== 'boolean' ||
    !(
      replay.completedPlies === null ||
      (Number.isInteger(replay.completedPlies) && Number(replay.completedPlies) >= 0)
    ) ||
    !(replay.terminal === null || typeof replay.terminal === 'boolean')
  ) {
    throw invalidResponse('Case verification result shape is invalid.')
  }
  return {
    ok: result.ok,
    errors: boundedStringList(result.errors, 'Case verification errors'),
    warnings: boundedStringList(result.warnings, 'Case verification warnings'),
    verified: boundedStringList(result.verified, 'Case verification checks'),
    notVerified: boundedStringList(
      result.notVerified,
      'Case verification boundaries',
    ),
    replay: {
      checked: replay.checked,
      exactProblemMapping: replay.exactProblemMapping,
      completedPlies: replay.completedPlies === null
        ? null
        : Number(replay.completedPlies),
      terminal: replay.terminal as boolean | null,
    },
  }
}

function uuidString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalidResponse(`${label} is invalid.`)
  }
  return value
}

function invalidResponse(message: string, cause?: unknown): WebChessApiError {
  return new WebChessApiError(message, {
    kind: 'invalid-response',
    cause,
  })
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count))
}

/** Browser-safe SHA-256 for the small, bounded direct-page excerpts. */
function sha256Utf8Hex(value: string): string {
  const input = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(input)
  padded[input.length] = 0x80

  const bitLength = input.length * 8
  const paddedView = new DataView(padded.buffer)
  paddedView.setUint32(
    paddedLength - 8,
    Math.floor(bitLength / 0x1_0000_0000),
    false,
  )
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  const schedule = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = paddedView.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const prior15 = schedule[index - 15]
      const prior2 = schedule[index - 2]
      const sigma0 = rotateRight(prior15, 7) ^
        rotateRight(prior15, 18) ^
        (prior15 >>> 3)
      const sigma1 = rotateRight(prior2, 17) ^
        rotateRight(prior2, 19) ^
        (prior2 >>> 10)
      schedule[index] = (
        schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1
      ) >>> 0
    }

    let a = hash[0]
    let b = hash[1]
    let c = hash[2]
    let d = hash[3]
    let e = hash[4]
    let f = hash[5]
    let g = hash[6]
    let h = hash[7]

    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (
        h + sigma1 + choice + SHA256_ROUND_CONSTANTS[index] + schedule[index]
      ) >>> 0
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sigma0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }

    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')
}

function parseDivision(value: unknown): GameDivision | null {
  if (value === null) return null
  const division = recordOf(value, 'Game division')
  const seed = division.seed
  if (
    !(
      (typeof seed === 'string' && seed.length > 0) ||
      (typeof seed === 'number' && Number.isFinite(seed))
    )
  ) {
    throw invalidResponse('Game division seed is invalid.')
  }
  if (!Array.isArray(division.facets) || !Array.isArray(division.parts)) {
    throw invalidResponse('Game division is missing its facets or board parts.')
  }
  const prompt = division.prompt
  if (prompt !== undefined && typeof prompt !== 'string') {
    throw invalidResponse('Game division prompt is invalid.')
  }

  return {
    seed,
    facets: division.facets as ProblemFacet[],
    parts: division.parts as ProblemPart[],
    model: nonEmptyString(division.model, 'Game division model'),
    ...(prompt === undefined ? {} : { prompt }),
  }
}

function parseGameState(value: unknown): GameView | null {
  if (value === null) return null
  const state = recordOf(value, 'Game state')
  if (
    !state.versions ||
    typeof state.versions !== 'object' ||
    !Array.isArray(state.pieces) ||
    !Array.isArray(state.events) ||
    !Array.isArray(state.captures) ||
    (state.turn !== 'white' && state.turn !== 'black') ||
    !Number.isInteger(state.completedPlies) ||
    !Number.isInteger(state.quietPlies)
  ) {
    throw invalidResponse('Game state is incomplete.')
  }
  if (state.lastMove !== null && typeof state.lastMove !== 'object') {
    throw invalidResponse('Game last move is invalid.')
  }
  if (state.outcome !== null && typeof state.outcome !== 'object') {
    throw invalidResponse('Game outcome is invalid.')
  }
  return value as GameView
}

function parseAnswer(value: unknown): GeneratedAnswer | null {
  if (value === null) return null
  const answer = recordOf(value, 'Game answer')
  return {
    answer: nonEmptyString(answer.answer, 'Game answer text'),
    model: nonEmptyString(answer.model, 'Game answer model'),
    prompt: nonEmptyString(answer.prompt, 'Game answer prompt'),
  }
}

export function parseDurableGame(value: unknown): DurableGame {
  const game = recordOf(value, 'Game')
  const status = nonEmptyString(game.status, 'Game status')
  if (!GAME_STATUSES.has(status)) {
    throw invalidResponse(`Unsupported game status: ${status}.`)
  }
  if (
    game.sourceGameId !== null &&
    (typeof game.sourceGameId !== 'string' || game.sourceGameId.length === 0)
  ) {
    throw invalidResponse('Game source id is invalid.')
  }
  const researchConsent = recordOf(game.researchConsent, 'Game research consent')
  const consentVersion = nonEmptyString(
    researchConsent.version,
    'Game research consent version',
  )
  const consentDecision = nonEmptyString(
    researchConsent.decision,
    'Game research consent decision',
  )
  const consentRecordedAt = researchConsent.recordedAt === null
    ? null
    : timestampString(
        researchConsent.recordedAt,
        'Game research consent time',
      )
  if (
    ![
      'legacy-no-research-consent-v0',
      RESEARCH_CONSENT_VERSION,
    ].includes(consentVersion) ||
    ![
      'allow_search_and_page_fetch',
      'no_external_research',
    ].includes(consentDecision) ||
    (
      consentVersion === 'legacy-no-research-consent-v0' &&
      (
        consentDecision !== 'no_external_research' ||
        consentRecordedAt !== null
      )
    ) ||
    (consentVersion === RESEARCH_CONSENT_VERSION && consentRecordedAt === null)
  ) {
    throw invalidResponse('Game research consent is invalid.')
  }

  return {
    id: nonEmptyString(game.id, 'Game id'),
    sourceGameId: game.sourceGameId,
    revision: nonnegativeInteger(game.revision, 'Game revision'),
    status: status as DurableGameStatus,
    problem: nonEmptyString(game.problem, 'Game problem'),
    researchConsent: {
      version: consentVersion as ResearchConsent['version'],
      decision: consentDecision as ResearchConsentDecision,
      recordedAt: consentRecordedAt,
    },
    division: parseDivision(game.division),
    state: parseGameState(game.state),
    answer: parseAnswer(game.answer),
  }
}

function parseGameEnvelope(value: unknown): DurableGame {
  return parseDurableGame(recordOf(value, 'Response').game)
}

function parseCurrentGameEnvelope(value: unknown): DurableGame | null {
  const game = recordOf(value, 'Response').game
  return game === null ? null : parseDurableGame(game)
}

function parseAnswerEnvelope(value: unknown): AnswerGameResult {
  const response = recordOf(value, 'Response')
  const answer = parseAnswer(response.answer)
  if (!answer) throw invalidResponse('The answer response is incomplete.')
  return {
    game: parseDurableGame(response.game),
    answer,
  }
}

const LIFECYCLE_STATE_SET = new Set<string>(LIFECYCLE_STATES)
const RESEARCH_STAGE_SET = new Set<string>(RESEARCH_STAGES)
const RESEARCH_STATUS_SET = new Set<string>(RESEARCH_STATUSES)

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonEmptyString(value, label)
}

function timestampString(value: unknown, label: string): string {
  const timestamp = nonEmptyString(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw invalidResponse(`${label} is invalid.`)
  }
  return timestamp
}

function nullableTimestampString(value: unknown, label: string): string | null {
  return value === null ? null : timestampString(value, label)
}

const WILBUR_ACTION_STATUS_SET = new Set<string>(WILBUR_ACTION_STATUSES)
const ASSUMPTION_RESULT_SET = new Set<string>(ASSUMPTION_RESULTS)

function parseWilburAction(value: unknown, label = 'Wilbur action'): WilburAction {
  const action = recordOf(value, label)
  uuidString(action.id, `${label} id`)
  uuidString(action.lifecycleRunId, `${label} lifecycle run id`)
  if (
    action.charlotteActionIndex !== null &&
    (
      !Number.isInteger(action.charlotteActionIndex) ||
      Number(action.charlotteActionIndex) < 0 ||
      Number(action.charlotteActionIndex) > 2
    )
  ) {
    throw invalidResponse(`${label} Charlotte action index is invalid.`)
  }
  if (
    action.charlotteBindingVersion !== null &&
    action.charlotteBindingVersion !== CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION
  ) {
    throw invalidResponse(`${label} Charlotte binding version is invalid.`)
  }
  if (
    action.charlotteBindingVersion ===
      CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION &&
    action.charlotteActionIndex === null
  ) {
    throw invalidResponse(`${label} Charlotte binding is incomplete.`)
  }
  boundedString(action.actor, `${label} actor`, 2, 240)
  boundedString(action.action, `${label} action`, 8, 2_000)
  boundedString(
    action.testedAssumption,
    `${label} tested assumption`,
    8,
    1_000,
  )
  boundedString(
    action.expectedObservation,
    `${label} expected observation`,
    8,
    1_000,
  )
  boundedString(
    action.decisionThreshold,
    `${label} decision threshold`,
    8,
    1_000,
  )
  boundedString(action.reviewHorizon, `${label} review horizon`, 2, 240)
  nullableTimestampString(action.followUpAt, `${label} follow-up time`)
  const status = nonEmptyString(action.status, `${label} status`)
  if (!WILBUR_ACTION_STATUS_SET.has(status)) {
    throw invalidResponse(`${label} status is invalid.`)
  }
  nonnegativeInteger(action.revision, `${label} revision`)
  if (action.version !== CURRENT_LIFECYCLE_VERSIONS.wilburRecord) {
    throw invalidResponse(`${label} record version is invalid.`)
  }
  timestampString(action.createdAt, `${label} creation time`)
  timestampString(action.updatedAt, `${label} update time`)
  return action as unknown as WilburAction
}

function parseWilburObservation(
  value: unknown,
  label = 'Wilbur observation',
): WilburObservation {
  const observation = recordOf(value, label)
  uuidString(observation.id, `${label} id`)
  uuidString(observation.actionId, `${label} action id`)
  timestampString(observation.observedAt, `${label} observation time`)
  boundedString(observation.observation, `${label} observation`, 3, 4_000)
  boundedString(
    observation.evidenceClassification,
    `${label} evidence classification`,
    3,
    240,
  )
  boundedString(observation.expectedEffect, `${label} expected effect`, 1, 2_000)
  boundedString(
    observation.unexpectedEffect,
    `${label} unexpected effect`,
    1,
    2_000,
  )
  boundedString(
    observation.stakeholderResponse,
    `${label} stakeholder response`,
    1,
    2_000,
  )
  boundedString(observation.nextDecision, `${label} next decision`, 3, 2_000)
  const assumptionResult = nonEmptyString(
    observation.assumptionResult,
    `${label} assumption result`,
  )
  if (!ASSUMPTION_RESULT_SET.has(assumptionResult)) {
    throw invalidResponse(`${label} assumption result is invalid.`)
  }
  if (observation.version !== CURRENT_LIFECYCLE_VERSIONS.wilburRecord) {
    throw invalidResponse(`${label} record version is invalid.`)
  }
  timestampString(observation.createdAt, `${label} creation time`)
  return observation as unknown as WilburObservation
}

function parseWebMemoryEvidence(
  value: unknown,
  expectedOrdinal: number,
): WebMemoryEvidence {
  const evidence = recordOf(value, 'Lifecycle Web memory evidence')
  uuidString(evidence.observationId, 'Web memory observation id')
  uuidString(evidence.sourceGameId, 'Web memory source game id')
  uuidString(evidence.sourceActionId, 'Web memory source action id')
  boundedString(evidence.sourceProblem, 'Web memory source problem', 12, 240)
  boundedString(evidence.action, 'Web memory action', 8, 2_000)
  boundedString(
    evidence.testedAssumption,
    'Web memory tested assumption',
    8,
    1_000,
  )
  boundedString(
    evidence.expectedObservation,
    'Web memory expected observation',
    8,
    1_000,
  )
  boundedString(evidence.observation, 'Web memory observation', 3, 4_000)
  boundedString(
    evidence.evidenceClassification,
    'Web memory evidence classification',
    3,
    240,
  )
  boundedString(evidence.expectedEffect, 'Web memory expected effect', 1, 2_000)
  boundedString(
    evidence.unexpectedEffect,
    'Web memory unexpected effect',
    1,
    2_000,
  )
  boundedString(
    evidence.stakeholderResponse,
    'Web memory stakeholder response',
    1,
    2_000,
  )
  boundedString(evidence.nextDecision, 'Web memory next decision', 3, 2_000)
  timestampString(evidence.observedAt, 'Web memory observation time')
  const assumptionResult = nonEmptyString(
    evidence.assumptionResult,
    'Web memory assumption result',
  )
  if (!ASSUMPTION_RESULT_SET.has(assumptionResult)) {
    throw invalidResponse('Web memory assumption result is invalid.')
  }
  if (evidence.selectionOrdinal !== expectedOrdinal) {
    throw invalidResponse('Web memory selection order is invalid.')
  }
  if (evidence.consentVersion !== CURRENT_WEB_MEMORY_CONSENT_VERSION) {
    throw invalidResponse('Web memory consent version is invalid.')
  }
  nullableTimestampString(evidence.attachedAt, 'Web memory attachment time')
  return evidence as unknown as WebMemoryEvidence
}

function parseResearchConsent(value: unknown, label: string): ResearchConsent {
  const consent = recordOf(value, label)
  const version = nonEmptyString(consent.version, `${label} version`)
  const decision = nonEmptyString(consent.decision, `${label} decision`)
  const recordedAt = consent.recordedAt === null
    ? null
    : timestampString(consent.recordedAt, `${label} time`)
  if (
    !['legacy-no-research-consent-v0', RESEARCH_CONSENT_VERSION].includes(version) ||
    !['allow_search_and_page_fetch', 'no_external_research'].includes(decision) ||
    (version === 'legacy-no-research-consent-v0' && (
      decision !== 'no_external_research' || recordedAt !== null
    )) ||
    (version === RESEARCH_CONSENT_VERSION && recordedAt === null)
  ) {
    throw invalidResponse(`${label} is invalid.`)
  }
  return {
    version: version as ResearchConsent['version'],
    decision: decision as ResearchConsentDecision,
    recordedAt,
  }
}

function safeEvidenceUrl(value: unknown, label: string): string {
  const candidate = nonEmptyString(value, label)
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw invalidResponse(`${label} is invalid.`)
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw invalidResponse(`${label} is unsafe.`)
  }
  return parsed.toString()
}

function parseResearchRecord(value: unknown): ResearchRecord {
  const research = recordOf(value, 'Lifecycle research')
  const stage = nonEmptyString(research.stage, 'Research stage')
  const status = nonEmptyString(research.status, 'Research status')
  if (!RESEARCH_STAGE_SET.has(stage) || !RESEARCH_STATUS_SET.has(status)) {
    throw invalidResponse('Lifecycle research stage or status is invalid.')
  }
  const id = nonEmptyString(research.id, 'Research id')
  const lifecycleRunId = nonEmptyString(
    research.lifecycleRunId,
    'Research lifecycle run id',
  )
  const gameId = nonEmptyString(research.gameId, 'Research game id')
  for (const [label, identifier] of [
    ['Research id', id],
    ['Research lifecycle run id', lifecycleRunId],
    ['Research game id', gameId],
  ] as const) {
    if (typeof identifier !== 'string' || !UUID_PATTERN.test(identifier)) {
      throw invalidResponse(`${label} is invalid.`)
    }
  }
  if (
    research.requestedBy !== 'research-policy' ||
    research.provider !== 'codex' ||
    research.transport !== 'local'
  ) {
    throw invalidResponse('Lifecycle research attribution is invalid.')
  }
  const materiality = research.materiality
  if (
    materiality !== null &&
    materiality !== 'helpful' &&
    materiality !== 'required'
  ) {
    throw invalidResponse('Lifecycle research materiality is invalid.')
  }
  const policyVersion = nonEmptyString(
    research.policyVersion,
    'Research policy version',
  )
  const consent = parseResearchConsent(research.consent, 'Research consent')
  const reason = nonEmptyString(research.reason, 'Research reason')
  const query = nullableString(research.query, 'Research query')
  const model = nullableString(research.model, 'Research model')
  const bounds = recordOf(research.bounds, 'Research bounds')
  const resultLimit = nonnegativeInteger(
    bounds.resultLimit,
    'Research result limit',
  )
  const sourceLimit = nonnegativeInteger(
    bounds.sourceLimit,
    'Research source limit',
  )
  const timeoutMs = nonnegativeInteger(bounds.timeoutMs, 'Research timeout')
  const synthesisCharacterLimit = nonnegativeInteger(
    bounds.synthesisCharacterLimit,
    'Research synthesis limit',
  )
  if (
    bounds.invocationLimit !== 1 ||
    resultLimit < 1 ||
    sourceLimit < 1 ||
    timeoutMs < 1_000 ||
    synthesisCharacterLimit < 500
  ) {
    throw invalidResponse('Lifecycle research bounds are invalid.')
  }
  const attemptCount = nonnegativeInteger(
    research.attemptCount,
    'Research attempt count',
  )
  if (attemptCount > 1) {
    throw invalidResponse('Lifecycle research attempt count is invalid.')
  }
  for (const [label, array] of [
    ['executed queries', research.executedQueries],
    ['retrieved facts', research.retrievedFacts],
    ['fetch failures', research.fetchFailures],
    ['sources', research.sources],
    ['injection signals', research.injectionSignalsDetected],
  ] as const) {
    if (!Array.isArray(array)) {
      throw invalidResponse(`Lifecycle research ${label} must be an array.`)
    }
  }
  const executedQueryValues = research.executedQueries as unknown[]
  const retrievedFactValues = research.retrievedFacts as unknown[]
  const fetchFailureValues = research.fetchFailures as unknown[]
  const injectionSignalValues = research.injectionSignalsDetected as unknown[]
  if (
    retrievedFactValues.length + fetchFailureValues.length > 3 ||
    research.directPageTextFetched !== (retrievedFactValues.length > 0) ||
    executedQueryValues.some(
      (item: unknown) => typeof item !== 'string' || item.trim().length === 0,
    ) ||
    injectionSignalValues.some(
      (item: unknown) => typeof item !== 'string' || item.trim().length === 0,
    )
  ) {
    throw invalidResponse('Lifecycle research evidence labels are invalid.')
  }
  const executedQueries = executedQueryValues.map((item) =>
    nonEmptyString(item, 'Research executed query'))
  const injectionSignalsDetected = injectionSignalValues.map((item) =>
    nonEmptyString(item, 'Research injection signal'))
  const sourceIds = new Set<string>()
  const sourceUrlsByCitation = new Map<string, string>()
  const sources: ResearchSource[] = []
  for (const sourceValue of research.sources as unknown[]) {
    const source = recordOf(sourceValue, 'Research source')
    const sourceId = typeof source.id === 'string' ? source.id : ''
    const citationId = typeof source.citationId === 'string'
      ? source.citationId
      : ''
    const ordinal = Number(source.ordinal)
    const title = typeof source.title === 'string' ? source.title : ''
    const hostname = typeof source.hostname === 'string' ? source.hostname : ''
    const trust = source.trust
    const discoveredFrom = source.discoveredFrom
    if (
      !UUID_PATTERN.test(sourceId) ||
      citationId.length < 2 ||
      !Number.isSafeInteger(source.ordinal) ||
      ordinal < 1 ||
      title.trim().length === 0 ||
      hostname.trim().length === 0 ||
      !['government_or_education', 'general_web'].includes(
        trust as string,
      ) ||
      !['search_activity', 'synthesis_link'].includes(
        discoveredFrom as string,
      )
    ) {
      throw invalidResponse('Lifecycle research source is invalid.')
    }
    let url: URL
    try {
      url = new URL(nonEmptyString(source.url, 'Research source URL'))
    } catch {
      throw invalidResponse('Lifecycle research source URL is invalid.')
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hostname.toLowerCase() !== hostname.toLowerCase() ||
      url.hostname.toLowerCase() === 'localhost' ||
      url.hostname.toLowerCase().endsWith('.localhost') ||
      url.hostname.toLowerCase().endsWith('.local') ||
      url.hostname.toLowerCase().endsWith('.internal') ||
      /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./u.test(
        url.hostname,
      ) ||
      sourceIds.has(sourceId)
    ) {
      throw invalidResponse('Lifecycle research source is unsafe or repeated.')
    }
    sourceIds.add(sourceId)
    if (sourceUrlsByCitation.has(citationId)) {
      throw invalidResponse('Lifecycle research citation id is repeated.')
    }
    sourceUrlsByCitation.set(citationId, url.toString())
    const createdAt = timestampString(
      source.createdAt,
      'Research source creation time',
    )
    sources.push({
      id: sourceId,
      citationId,
      ordinal,
      title,
      url: url.toString(),
      hostname,
      trust: trust as ResearchSource['trust'],
      discoveredFrom: discoveredFrom as ResearchSource['discoveredFrom'],
      createdAt,
    })
  }
  const fetchedCitations = new Set<string>()
  const validateFetchRoute = (
    evidence: Record<string, unknown>,
    label: string,
  ): {
    citationId: string
    requestedUrl: string
    finalUrl: string | null
    redirectChain: string[]
  } => {
    const citationId = nonEmptyString(evidence.citationId, `${label} citation id`)
    const requestedUrl = safeEvidenceUrl(evidence.requestedUrl, `${label} requested URL`)
    const finalUrl = evidence.finalUrl === null
      ? null
      : safeEvidenceUrl(evidence.finalUrl, `${label} final URL`)
    if (!Array.isArray(evidence.redirectChain) || evidence.redirectChain.length < 1 || evidence.redirectChain.length > 4) {
      throw invalidResponse(`${label} redirect chain is invalid.`)
    }
    const redirectChain = evidence.redirectChain.map((url, index) =>
      safeEvidenceUrl(url, `${label} redirect ${index + 1}`))
    if (
      sourceUrlsByCitation.get(citationId) !== requestedUrl ||
      redirectChain[0] !== requestedUrl ||
      redirectChain.at(-1) !== (finalUrl ?? requestedUrl) ||
      redirectChain.some((url) => new URL(url).hostname !== new URL(requestedUrl).hostname) ||
      fetchedCitations.has(citationId)
    ) {
      throw invalidResponse(`${label} does not match its citation provenance.`)
    }
    fetchedCitations.add(citationId)
    return { citationId, requestedUrl, finalUrl, redirectChain }
  }
  const retrievedFacts: ResearchRetrievedFact[] = []
  for (const factValue of retrievedFactValues) {
    const fact = recordOf(factValue, 'Research direct-page fact')
    const route = validateFetchRoute(fact, 'Research direct-page fact')
    const text = nonEmptyString(fact.text, 'Research direct-page accepted text')
    const rawByteLength = nonnegativeInteger(
      fact.rawByteLength,
      'Research raw byte length',
    )
    const acceptedCharacterLength = nonnegativeInteger(
      fact.acceptedCharacterLength,
      'Research accepted text length',
    )
    const rawContentDigest = typeof fact.rawContentDigest === 'string'
      ? fact.rawContentDigest
      : ''
    const contentDigest = typeof fact.contentDigest === 'string'
      ? fact.contentDigest
      : ''
    const title = nonEmptyString(fact.title, 'Research direct-page title')
    const retrievedAt = timestampString(
      fact.retrievedAt,
      'Research direct-page retrieval time',
    )
    if (
      route.finalUrl === null ||
      fact.provider !== 'webchess-direct-https' ||
      fact.fetchVersion !== 'webchess-direct-page-fetch-v1' ||
      fact.extractor !== 'webchess-readable-text-v1' ||
      fact.digestAlgorithm !== 'sha256-utf8-accepted-text-v1' ||
      fact.rawDigestAlgorithm !== 'sha256-raw-response-bytes-v1' ||
      fact.untrusted !== true ||
      fact.contentKind !== 'direct_page_text' ||
      fact.httpStatus !== 200 ||
      !['application/xhtml+xml', 'text/html', 'text/plain'].includes(String(fact.contentType)) ||
      rawByteLength < 1 ||
      rawByteLength > 1_048_576 ||
      acceptedCharacterLength !== text.length ||
      text.length > 6_000 ||
      typeof fact.truncated !== 'boolean' ||
      !/^[0-9a-f]{64}$/u.test(rawContentDigest) ||
      !/^[0-9a-f]{64}$/u.test(contentDigest) ||
      sha256Utf8Hex(text) !== contentDigest
    ) {
      throw invalidResponse('Research direct-page fact is invalid.')
    }
    retrievedFacts.push({
      citationId: route.citationId,
      requestedUrl: route.requestedUrl,
      finalUrl: route.finalUrl,
      title,
      provider: 'webchess-direct-https',
      fetchVersion: 'webchess-direct-page-fetch-v1',
      retrievedAt,
      httpStatus: 200,
      contentType: fact.contentType as ResearchRetrievedFact['contentType'],
      extractor: 'webchess-readable-text-v1',
      rawByteLength,
      rawContentDigest,
      rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
      acceptedCharacterLength,
      contentDigest,
      digestAlgorithm: 'sha256-utf8-accepted-text-v1',
      redirectChain: route.redirectChain,
      text,
      truncated: fact.truncated,
      untrusted: true,
      contentKind: 'direct_page_text',
    })
  }
  const fetchFailures: ResearchFetchFailure[] = []
  for (const failureValue of fetchFailureValues) {
    const failure = recordOf(failureValue, 'Research direct-page failure')
    const route = validateFetchRoute(failure, 'Research direct-page failure')
    const rawByteLength = nonnegativeInteger(
      failure.rawByteLength,
      'Research failure raw byte length',
    )
    const failureCode = nonEmptyString(
      failure.failureCode,
      'Research direct-page failure code',
    )
    const retrievedAt = timestampString(
      failure.retrievedAt,
      'Research direct-page failure time',
    )
    if (
      !['failed', 'refused', 'timed_out'].includes(String(failure.status)) ||
      failure.fetchVersion !== 'webchess-direct-page-fetch-v1' ||
      failure.extractor !== 'webchess-readable-text-v1' ||
      failure.digestAlgorithm !== 'sha256-utf8-accepted-text-v1' ||
      failure.rawDigestAlgorithm !== 'sha256-raw-response-bytes-v1' ||
      rawByteLength > 1_114_112 ||
      failure.acceptedCharacterLength !== 0 ||
      failure.contentDigest !== null ||
      typeof failure.truncated !== 'boolean' ||
      (failure.httpStatus !== null && (
        !Number.isInteger(failure.httpStatus) || Number(failure.httpStatus) < 100 || Number(failure.httpStatus) > 599
      )) ||
      (failure.rawContentDigest !== null && (
        typeof failure.rawContentDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(failure.rawContentDigest)
      )) ||
      (rawByteLength > 0 && failure.rawContentDigest === null) ||
      !Array.isArray(failure.injectionSignalsDetected) ||
      failure.injectionSignalsDetected.some((signal) =>
        typeof signal !== 'string' || !/^[a-z0-9_]{3,120}$/u.test(signal))
    ) {
      throw invalidResponse('Research direct-page failure is invalid.')
    }
    fetchFailures.push({
      citationId: route.citationId,
      requestedUrl: route.requestedUrl,
      finalUrl: route.finalUrl,
      status: failure.status as ResearchFetchFailure['status'],
      failureCode,
      httpStatus: failure.httpStatus as number | null,
      fetchVersion: 'webchess-direct-page-fetch-v1',
      extractor: 'webchess-readable-text-v1',
      rawByteLength,
      rawContentDigest: failure.rawContentDigest as string | null,
      rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
      acceptedCharacterLength: 0,
      truncated: failure.truncated,
      contentDigest: null,
      digestAlgorithm: 'sha256-utf8-accepted-text-v1',
      redirectChain: route.redirectChain,
      injectionSignalsDetected: [
        ...(failure.injectionSignalsDetected as string[]),
      ],
      retrievedAt,
    })
  }
  const searchSynthesis = nullableString(
    research.searchSynthesis,
    'Research search synthesis',
  )
  const contentDigest = nullableString(
    research.contentDigest,
    'Research content digest',
  )
  if (contentDigest !== null && !/^[0-9a-f]{64}$/u.test(contentDigest)) {
    throw invalidResponse('Lifecycle research content digest is invalid.')
  }
  const failureCode = nullableString(research.failureCode, 'Research failure code')
  const startedAt = research.startedAt === null
    ? null
    : timestampString(research.startedAt, 'Research start time')
  const completedAt = research.completedAt === null
    ? null
    : timestampString(research.completedAt, 'Research completion time')
  const createdAt = timestampString(research.createdAt, 'Research creation time')
  const updatedAt = timestampString(research.updatedAt, 'Research update time')
  const omittedSourceCount = nonnegativeInteger(
    research.omittedSourceCount,
    'Research omitted source count',
  )
  if (
    status === 'not_needed'
      ? query !== null || materiality !== null || attemptCount !== 0
      : query === null || materiality === null || attemptCount !== 1
  ) {
    throw invalidResponse('Lifecycle research decision shape is invalid.')
  }
  if (
    status === 'searching'
      ? startedAt === null || completedAt !== null
      : completedAt === null
  ) {
    throw invalidResponse('Lifecycle research timing is invalid.')
  }
  if (
    status === 'completed' &&
    (model === null || searchSynthesis === null || contentDigest === null)
  ) {
    throw invalidResponse('Completed lifecycle research is incomplete.')
  }
  return {
    id,
    lifecycleRunId,
    gameId,
    stage: stage as ResearchRecord['stage'],
    requestedBy: 'research-policy',
    consent,
    policyVersion,
    materiality: materiality as ResearchRecord['materiality'],
    reason,
    query,
    status: status as ResearchRecord['status'],
    provider: 'codex',
    transport: 'local',
    model,
    bounds: {
      invocationLimit: 1,
      resultLimit,
      sourceLimit,
      timeoutMs,
      synthesisCharacterLimit,
    },
    attemptCount,
    executedQueries,
    searchSynthesis,
    directPageTextFetched: research.directPageTextFetched as boolean,
    retrievedFacts,
    fetchFailures,
    sources,
    omittedSourceCount,
    injectionSignalsDetected,
    contentDigest,
    failureCode,
    startedAt,
    completedAt,
    createdAt,
    updatedAt,
  }
}

function parseLifecycle(value: unknown): LifecycleAggregate {
  const lifecycle = recordOf(value, 'Lifecycle')
  const state = nonEmptyString(lifecycle.state, 'Lifecycle state')
  if (!LIFECYCLE_STATE_SET.has(state)) {
    throw invalidResponse(`Unsupported lifecycle state: ${state}.`)
  }
  for (const [field, item] of [
    ['survivors', lifecycle.survivors],
    ['wilburActions', lifecycle.wilburActions],
    ['wilburObservations', lifecycle.wilburObservations],
    ['activities', lifecycle.activities],
    ['research', lifecycle.research],
    ['webMemoryEvidence', lifecycle.webMemoryEvidence],
  ] as const) {
    if (!Array.isArray(item)) {
      throw invalidResponse(`Lifecycle ${field} must be an array.`)
    }
  }
  for (const field of ['versions'] as const) {
    recordOf(lifecycle[field], `Lifecycle ${field}`)
  }
  if (
    lifecycle.answerPromptDigest !== null &&
    (
      typeof lifecycle.answerPromptDigest !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(lifecycle.answerPromptDigest)
    )
  ) {
    throw invalidResponse('Lifecycle answer prompt digest is invalid.')
  }
  if (
    lifecycle.answerUserPrompt !== null &&
    (
      typeof lifecycle.answerUserPrompt !== 'string' ||
      lifecycle.answerUserPrompt.length < 1 ||
      lifecycle.answerUserPrompt.length > 200_000
    )
  ) {
    throw invalidResponse('Lifecycle player-visible answer prompt is invalid.')
  }
  if (
    lifecycle.answerUserPromptSha256 !== null &&
    (
      typeof lifecycle.answerUserPromptSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(lifecycle.answerUserPromptSha256)
    )
  ) {
    throw invalidResponse('Lifecycle player-visible answer prompt digest is invalid.')
  }
  if (
    (lifecycle.answerUserPrompt === null) !==
    (lifecycle.answerUserPromptSha256 === null)
  ) {
    throw invalidResponse(
      'Lifecycle player-visible answer prompt provenance is incomplete.',
    )
  }
  const portiaProgress = recordOf(
    lifecycle.portiaProgress,
    'Lifecycle Portia progress',
  )
  if (
    portiaProgress.currentCandidateId !== null &&
    (
      typeof portiaProgress.currentCandidateId !== 'string' ||
      portiaProgress.currentCandidateId.length < 3 ||
      portiaProgress.currentCandidateId.length > 220
    )
  ) {
    throw invalidResponse('Lifecycle current Portia candidate is invalid.')
  }
  if (
    !Array.isArray(portiaProgress.completedCandidateIds) ||
    portiaProgress.completedCandidateIds.some(
      (candidateId) =>
        typeof candidateId !== 'string' ||
        candidateId.length < 3 ||
        candidateId.length > 220,
    ) ||
    new Set(portiaProgress.completedCandidateIds).size !==
      portiaProgress.completedCandidateIds.length
  ) {
    throw invalidResponse('Lifecycle completed Portia candidates are invalid.')
  }
  const completedCandidateIds = portiaProgress.completedCandidateIds as unknown[]
  if (
    !Array.isArray(portiaProgress.completedAssessments) ||
    portiaProgress.completedAssessments.length >
      portiaProgress.completedCandidateIds.length ||
    portiaProgress.completedAssessments.some((assessment, index) => {
      if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
        return true
      }
      return (assessment as Record<string, unknown>).candidateId !==
        completedCandidateIds[index]
    })
  ) {
    throw invalidResponse('Lifecycle completed Portia assessments are invalid.')
  }
  for (const field of ['portia', 'gate', 'charlotte'] as const) {
    if (lifecycle[field] !== null) {
      recordOf(lifecycle[field], `Lifecycle ${field}`)
    }
  }
  if (
    lifecycle.answerUserPrompt !== null &&
    (
      lifecycle.gate === null ||
      recordOf(lifecycle.gate, 'Lifecycle gate').passed !== true
    )
  ) {
    throw invalidResponse(
      'Lifecycle player-visible answer prompt was not authorized by the Gate.',
    )
  }
  const lifecycleId = uuidString(lifecycle.id, 'Lifecycle id')
  uuidString(lifecycle.rootRunId, 'Lifecycle root id')
  const lifecycleGameId = uuidString(lifecycle.gameId, 'Lifecycle game id')
  nonnegativeInteger(lifecycle.revision, 'Lifecycle revision')
  if (
    lifecycle.portiaActiveModelRequestId !== null &&
    (
      typeof lifecycle.portiaActiveModelRequestId !== 'string' ||
      !UUID_PATTERN.test(lifecycle.portiaActiveModelRequestId)
    )
  ) {
    throw invalidResponse('Lifecycle active Portia request id is invalid.')
  }
  nonnegativeInteger(
    lifecycle.portiaFailedAttemptCount,
    'Portia failed attempt count',
  )
  nonnegativeInteger(lifecycle.portiaFailureLimit, 'Portia failure limit')
  if (
    (lifecycle.portiaFailureLimit as number) < 1 ||
    (lifecycle.portiaFailureLimit as number) > 10 ||
    (lifecycle.portiaFailedAttemptCount as number) >
      (lifecycle.portiaFailureLimit as number)
  ) {
    throw invalidResponse('Portia failure budget is invalid.')
  }
  if (
    lifecycle.charlotteActiveModelRequestId !== null &&
    (
      typeof lifecycle.charlotteActiveModelRequestId !== 'string' ||
      !UUID_PATTERN.test(lifecycle.charlotteActiveModelRequestId)
    )
  ) {
    throw invalidResponse('Lifecycle active Charlotte request id is invalid.')
  }
  nonnegativeInteger(
    lifecycle.charlotteFailedAttemptCount,
    'Charlotte failed attempt count',
  )
  nonnegativeInteger(lifecycle.charlotteFailureLimit, 'Charlotte failure limit')
  if (
    (lifecycle.charlotteFailureLimit as number) < 1 ||
    (lifecycle.charlotteFailureLimit as number) > 10 ||
    (lifecycle.charlotteFailedAttemptCount as number) >
      (lifecycle.charlotteFailureLimit as number)
  ) {
    throw invalidResponse('Charlotte failure budget is invalid.')
  }
  nonnegativeInteger(lifecycle.sameFieldRetryCount, 'Same-field retry count')
  nonnegativeInteger(lifecycle.fieldRegenerationCount, 'Field regeneration count')
  const actionIds = new Set<string>()
  const boundCharlotteActionIndexes = new Set<number>()
  for (const actionValue of lifecycle.wilburActions as unknown[]) {
    const action = parseWilburAction(actionValue)
    if (
      action.lifecycleRunId !== lifecycleId ||
      actionIds.has(action.id)
    ) {
      throw invalidResponse(
        'Lifecycle Wilbur actions contain a duplicate id or foreign run.',
      )
    }
    actionIds.add(action.id)
    if (
      action.charlotteBindingVersion ===
        CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION
    ) {
      const index = action.charlotteActionIndex!
      if (boundCharlotteActionIndexes.has(index)) {
        throw invalidResponse(
          'Lifecycle Wilbur actions repeat a Charlotte action index.',
        )
      }
      boundCharlotteActionIndexes.add(index)
    }
  }
  const observationIds = new Set<string>()
  for (const observationValue of lifecycle.wilburObservations as unknown[]) {
    const observation = parseWilburObservation(observationValue)
    if (
      observationIds.has(observation.id) ||
      !actionIds.has(observation.actionId)
    ) {
      throw invalidResponse(
        'Lifecycle Wilbur observations contain a duplicate or unknown action.',
      )
    }
    observationIds.add(observation.id)
  }
  const webMemoryValues = lifecycle.webMemoryEvidence as unknown[]
  if (webMemoryValues.length > 8) {
    throw invalidResponse('Lifecycle Web memory exceeds the eight-item limit.')
  }
  const webMemoryObservationIds = new Set<string>()
  const webMemoryEvidence = webMemoryValues.map((evidenceValue, index) => {
    const evidence = parseWebMemoryEvidence(evidenceValue, index)
    if (
      evidence.sourceGameId === lifecycleGameId ||
      evidence.attachedAt === null ||
      webMemoryObservationIds.has(evidence.observationId)
    ) {
      throw invalidResponse(
        'Lifecycle Web memory contains a current-game, detached, or duplicate observation.',
      )
    }
    webMemoryObservationIds.add(evidence.observationId)
    return evidence
  })
  const research = (lifecycle.research as unknown[]).map(parseResearchRecord)
  return {
    ...lifecycle,
    research,
    webMemoryEvidence,
  } as unknown as LifecycleAggregate
}

function parseLifecycleEnvelope(value: unknown): LifecycleAggregate {
  return parseLifecycle(recordOf(value, 'Response').lifecycle)
}

function parseRetryLifecycleEnvelope(value: unknown): RetryLifecycleResult {
  const response = recordOf(value, 'Response')
  return {
    game: response.game === null ? null : parseDurableGame(response.game),
    lifecycle: parseLifecycle(response.lifecycle),
  }
}

function parseProvenanceEnvelope(value: unknown): readonly LifecycleActivity[] {
  const activities = recordOf(value, 'Response').activities
  if (!Array.isArray(activities)) {
    throw invalidResponse('Lifecycle activities must be an array.')
  }
  return activities as unknown as readonly LifecycleActivity[]
}

function parseWilburActionEnvelope(value: unknown): WilburAction {
  return parseWilburAction(recordOf(value, 'Response').action)
}

function parseWilburObservationEnvelope(value: unknown): WilburObservation {
  return parseWilburObservation(recordOf(value, 'Response').observation)
}

function parseWebMemoryEnvelope(value: unknown): WebMemoryIndex {
  const memory = recordOf(recordOf(value, 'Response').memory, 'Web memory')
  if (!Array.isArray(memory.cases) || !Array.isArray(memory.carriedObservationIds)) {
    throw invalidResponse('Web memory must contain cases and carried observation ids.')
  }
  if (
    memory.carriedObservationIds.length > 8 ||
    memory.carriedObservationIds.some(
      (id) => typeof id !== 'string' || !UUID_PATTERN.test(id),
    ) ||
    new Set(memory.carriedObservationIds).size !==
      memory.carriedObservationIds.length
  ) {
    throw invalidResponse('Web memory carried observation ids are invalid.')
  }
  if (memory.cases.length > 24) {
    throw invalidResponse('Web memory exceeds the recent-case limit.')
  }
  const caseIds = new Set<string>()
  const actionIds = new Set<string>()
  const boundCharlotteActionKeys = new Set<string>()
  const observationIds = new Set<string>()
  let currentCaseCount = 0
  for (const caseValue of memory.cases) {
    const memoryCase = recordOf(caseValue, 'Web memory case')
    boundedString(memoryCase.problem, 'Web memory problem', 12, 240)
    timestampString(memoryCase.createdAt, 'Web memory case creation time')
    timestampString(memoryCase.updatedAt, 'Web memory case update time')
    if (
      typeof memoryCase.gameId !== 'string' ||
      !UUID_PATTERN.test(memoryCase.gameId) ||
      typeof memoryCase.isCurrent !== 'boolean' ||
      !Array.isArray(memoryCase.actions)
    ) {
      throw invalidResponse('Web memory case shape is invalid.')
    }
    if (caseIds.has(memoryCase.gameId)) {
      throw invalidResponse('Web memory contains a duplicate case.')
    }
    caseIds.add(memoryCase.gameId)
    if (memoryCase.isCurrent) currentCaseCount += 1
    for (const actionValue of memoryCase.actions) {
      const record = recordOf(actionValue, 'Web memory action record')
      const action = parseWilburAction(record.action, 'Web memory action')
      if (actionIds.has(action.id)) {
        throw invalidResponse('Web memory contains a duplicate action.')
      }
      actionIds.add(action.id)
      if (
        action.charlotteBindingVersion ===
          CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION
      ) {
        const bindingKey = `${action.lifecycleRunId}:${action.charlotteActionIndex}`
        if (boundCharlotteActionKeys.has(bindingKey)) {
          throw invalidResponse(
            'Web memory repeats a canonical Charlotte action binding.',
          )
        }
        boundCharlotteActionKeys.add(bindingKey)
      }
      if (!Array.isArray(record.observations)) {
        throw invalidResponse('Web memory observations must be an array.')
      }
      for (const observationValue of record.observations) {
        const observation = parseWilburObservation(
          observationValue,
          'Web memory observation',
        )
        if (
          observation.actionId !== action.id ||
          observationIds.has(observation.id)
        ) {
          throw invalidResponse(
            'Web memory observations contain a duplicate or mismatched action.',
          )
        }
        observationIds.add(observation.id)
      }
    }
  }
  if (currentCaseCount > 1) {
    throw invalidResponse('Web memory contains more than one current case.')
  }
  return memory as unknown as WebMemoryIndex
}

function apiErrorKind(status: number): WebChessApiErrorKind {
  switch (status) {
    case 401:
      return 'authentication-required'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 409:
      return 'conflict'
    case 429:
      return 'rate-limited'
    default:
      return 'http-error'
  }
}

function defaultErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Sign in to continue.'
    case 403:
      return 'You do not have permission to do that.'
    case 404:
      return 'The requested game was not found.'
    case 409:
      return 'The game changed before this request was accepted. Reload it and try again.'
    case 429:
      return 'Too many requests. Please wait before trying again.'
    default:
      return 'WebChess could not complete this request.'
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
}

function errorDetails(value: unknown): {
  message?: string
  code?: string
  prompt?: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const payload = value as Record<string, unknown>
  const nested =
    payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? (payload.error as Record<string, unknown>)
      : null
  const message =
    (typeof payload.error === 'string' && payload.error) ||
    (typeof payload.message === 'string' && payload.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    undefined
  const code =
    (typeof payload.code === 'string' && payload.code) ||
    (typeof nested?.code === 'string' && nested.code) ||
    undefined
  const prompt =
    (typeof nested?.prompt === 'string' && nested.prompt) ||
    undefined
  return { message, code, prompt }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'),
  )
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    if (!response.ok) return null
    throw invalidResponse('WebChess returned malformed JSON.', error)
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: runtimeHeaders(init.headers),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error, init.signal ?? undefined)) throw error
    throw new WebChessApiError('WebChess could not reach the server.', {
      kind: 'transport',
      cause: error,
    })
  }

  const payload = await readJson(response)
  if (!response.ok) {
    const details = errorDetails(payload)
    throw new WebChessApiError(details.message ?? defaultErrorMessage(response.status), {
      kind: apiErrorKind(response.status),
      prompt: details.prompt ?? null,
      status: response.status,
      serverCode: details.code ?? null,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    })
  }

  return parse(payload)
}

function runtimeHeaders(headers: HeadersInit | undefined): Headers {
  const resolved = new Headers(headers)
  if (
    typeof window !== 'undefined' &&
    (window.location.pathname === '/openclaw' ||
      window.location.pathname.startsWith('/openclaw/'))
  ) {
    resolved.set('X-WebChess-OpenClaw-Runtime', 'webchess-2')
  }
  return resolved
}

function createMutationHeaders(idempotencyKey?: string): HeadersInit {
  const key = idempotencyKey ?? createIdempotencyKey()
  if (!UUID_PATTERN.test(key)) {
    throw new TypeError('The idempotency key must be a canonical UUID.')
  }
  return {
    Accept: 'application/json',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  }
}

function getHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  }
}

function gamePath(gameId: string, action?: string): string {
  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    throw new TypeError('A game id is required.')
  }
  const base = `/api/games/${encodeURIComponent(gameId)}`
  return action ? `${base}/${action}` : base
}

function divisionIntentPath(idempotencyKey: string): string {
  if (
    typeof idempotencyKey !== 'string' ||
    !UUID_PATTERN.test(idempotencyKey)
  ) {
    throw new TypeError('A canonical division idempotency key is required.')
  }
  return `/api/division-intents/${encodeURIComponent(idempotencyKey.toLowerCase())}`
}

function validateRevision(expectedRevision: number): number {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('Expected revision must be a non-negative integer.')
  }
  return expectedRevision
}

export function createIdempotencyKey(): string {
  if (
    typeof globalThis.crypto === 'undefined' ||
    typeof globalThis.crypto.randomUUID !== 'function'
  ) {
    throw new Error('This browser cannot create secure idempotency keys.')
  }
  return globalThis.crypto.randomUUID()
}

export function divideProblem(
  problem: string,
  options: DivideProblemOptions,
): Promise<DurableGame> {
  if (typeof problem !== 'string') throw new TypeError('A problem is required.')
  if (
    ![
      'allow_search_and_page_fetch',
      'no_external_research',
    ].includes(options.researchConsentDecision)
  ) {
    throw new TypeError('Choose whether this game may use external research.')
  }
  const memoryObservationIds = [...new Set(options.memoryObservationIds ?? [])]
  if (
    memoryObservationIds.length > 8 ||
    memoryObservationIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    throw new TypeError('Select no more than eight valid Web memory observations.')
  }
  return requestJson(
    '/api/divide',
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify({
        problem,
        researchConsent: {
          version: RESEARCH_CONSENT_VERSION,
          decision: options.researchConsentDecision,
        },
        ...(memoryObservationIds.length > 0 ? { memoryObservationIds } : {}),
      }),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function getWebMemory(
  options: RequestOptions = {},
): Promise<WebMemoryIndex> {
  return requestJson(
    '/api/web-memory',
    { method: 'GET', headers: getHeaders(), signal: options.signal },
    parseWebMemoryEnvelope,
  )
}

export function getCurrentGame(
  options: RequestOptions = {},
): Promise<DurableGame | null> {
  return requestJson(
    '/api/games/current',
    {
      method: 'GET',
      headers: getHeaders(),
      signal: options.signal,
    },
    parseCurrentGameEnvelope,
  )
}

export function getOwnedGame(
  gameId: string,
  options: RequestOptions = {},
): Promise<DurableGame> {
  return requestJson(
    gamePath(gameId),
    {
      method: 'GET',
      headers: getHeaders(),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function recoverDivisionIntent(
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<DurableGame> {
  return requestJson(
    divisionIntentPath(idempotencyKey),
    {
      method: 'GET',
      headers: getHeaders(),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function startGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  return mutateGame(gameId, 'start', command, options)
}

export function submitMove(
  gameId: string,
  command: MoveGameCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  const expectedRevision = validateRevision(command.expectedRevision)
  if (typeof command.pieceId !== 'string' || command.pieceId.trim().length === 0) {
    throw new TypeError('A piece id is required.')
  }
  if (
    !command.to ||
    !Number.isInteger(command.to.ring) ||
    !Number.isInteger(command.to.sector)
  ) {
    throw new TypeError('A move destination must use integer coordinates.')
  }

  return requestJson(
    gamePath(gameId, 'moves'),
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify({
        pieceId: command.pieceId,
        to: {
          ring: command.to.ring,
          sector: command.to.sector,
        },
        expectedRevision,
      }),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function requestGameAnswer(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<AnswerGameResult> {
  return requestJson(
    gamePath(gameId, 'answer'),
    mutationInit(command, options),
    parseAnswerEnvelope,
  )
}

export function getGameLifecycle(
  gameId: string,
  options: RequestOptions = {},
): Promise<LifecycleAggregate> {
  return requestJson(
    gamePath(gameId, 'lifecycle'),
    { method: 'GET', headers: getHeaders(), signal: options.signal },
    parseLifecycleEnvelope,
  )
}

export function runPortia(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<LifecycleAggregate> {
  return mutateLifecycle(gameId, 'portia', command, options)
}

export function runCharlotte(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<LifecycleAggregate> {
  return mutateLifecycle(gameId, 'charlotte', command, options)
}

export function retryLifecycle(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<RetryLifecycleResult> {
  return requestJson(
    gamePath(gameId, 'retry'),
    mutationInit(command, options),
    parseRetryLifecycleEnvelope,
  )
}

export function getGameProvenance(
  gameId: string,
  options: RequestOptions = {},
): Promise<readonly LifecycleActivity[]> {
  return requestJson(
    gamePath(gameId, 'provenance'),
    { method: 'GET', headers: getHeaders(), signal: options.signal },
    parseProvenanceEnvelope,
  )
}

export async function downloadGameCase(
  gameId: string,
  profile: WebChessCaseProfile = 'research-redacted-v1',
  options: RequestOptions = {},
): Promise<WebChessCaseDownload> {
  if (!isWebChessCaseProfile(profile)) {
    throw new TypeError('A supported case redaction profile is required.')
  }

  let response: Response
  try {
    response = await fetch(gamePath(gameId, 'case-export'), {
      method: 'POST',
      headers: runtimeHeaders({
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ profile }),
      signal: options.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error, options.signal)) throw error
    throw new WebChessApiError('WebChess could not reach the server.', {
      kind: 'transport',
      cause: error,
    })
  }

  if (!response.ok) {
    const payload = await readJson(response)
    const details = errorDetails(payload)
    throw new WebChessApiError(
      details.message ?? defaultErrorMessage(response.status),
      {
        kind: apiErrorKind(response.status),
        status: response.status,
        serverCode: details.code ?? null,
        retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
      },
    )
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const candidate = disposition.match(/filename="([A-Za-z0-9._-]+)"/u)?.[1]
  const fileName = candidate ?? `webchess-case-${gameId}-${profile}.json`
  return {
    blob: await response.blob(),
    fileName,
  }
}

export function verifyLocalCaseBundle(
  bundle: Blob,
  options: RequestOptions = {},
): Promise<WebChessCaseVerificationResult> {
  if (!(bundle instanceof Blob)) {
    throw new TypeError('Choose one JSON case bundle to verify.')
  }
  if (bundle.size < 2) {
    throw new TypeError('The selected case bundle is empty.')
  }
  if (bundle.size > WEBCHESS_CASE_BUNDLE_MAX_BYTES) {
    throw new TypeError(
      `The selected case bundle exceeds ${WEBCHESS_CASE_BUNDLE_MAX_BYTES.toLocaleString('en-US')} bytes.`,
    )
  }
  return requestJson(
    '/api/openclaw/case-verify',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: bundle,
      signal: options.signal,
    },
    parseCaseVerificationEnvelope,
  )
}

export function createWilburAction(
  gameId: string,
  command: CreateWilburActionCommand,
  options: MutationOptions = {},
): Promise<WilburAction> {
  return requestJson(
    gamePath(gameId, 'wilbur/actions'),
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify(command),
      signal: options.signal,
    },
    parseWilburActionEnvelope,
  )
}

export function updateWilburAction(
  gameId: string,
  actionId: string,
  command: UpdateWilburActionCommand,
  options: MutationOptions = {},
): Promise<WilburAction> {
  validateRevision(command.expectedRevision)
  return requestJson(
    `${gamePath(gameId, 'wilbur/actions')}/${encodeURIComponent(actionId)}`,
    {
      method: 'PATCH',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify(command),
      signal: options.signal,
    },
    parseWilburActionEnvelope,
  )
}

export function appendWilburObservation(
  gameId: string,
  actionId: string,
  command: AppendWilburObservationCommand,
  options: MutationOptions = {},
): Promise<WilburObservation> {
  return requestJson(
    `${gamePath(gameId, 'wilbur/actions')}/${encodeURIComponent(actionId)}/observations`,
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify(command),
      signal: options.signal,
    },
    parseWilburObservationEnvelope,
  )
}

export function replayGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  return mutateGame(gameId, 'replay', command, options)
}

export function abandonGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  return mutateGame(gameId, 'abandon', command, options)
}

function mutationInit(
  command: RevisionCommand,
  options: MutationOptions,
): RequestInit {
  const expectedRevision = validateRevision(command.expectedRevision)
  return {
    method: 'POST',
    headers: createMutationHeaders(options.idempotencyKey),
    body: JSON.stringify({ expectedRevision }),
    signal: options.signal,
  }
}

function mutateGame(
  gameId: string,
  action: 'start' | 'replay' | 'abandon',
  command: RevisionCommand,
  options: MutationOptions,
): Promise<DurableGame> {
  return requestJson(
    gamePath(gameId, action),
    mutationInit(command, options),
    parseGameEnvelope,
  )
}

function mutateLifecycle(
  gameId: string,
  action: 'portia' | 'charlotte',
  command: RevisionCommand,
  options: MutationOptions,
): Promise<LifecycleAggregate> {
  return requestJson(
    gamePath(gameId, action),
    mutationInit(command, options),
    parseLifecycleEnvelope,
  )
}

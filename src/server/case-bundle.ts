import {
  CURRENT_GAME_VERSIONS,
} from '../lib/game-contract'
import { replayGameEvents } from '../lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  LIFECYCLE_STATES,
  canTransitionLifecycle,
} from '../lib/lifecycle'
import {
  WEBCHESS_CASE_BUNDLE_FORMAT,
  WEBCHESS_CASE_CANONICALIZATION,
  WEBCHESS_CASE_PROFILES,
  WEBCHESS_CASE_REDACTION_POLICY,
  isWebChessCaseProfile,
} from '../lib/case-bundle-contract'
import type { WebChessCaseProfile } from '../lib/case-bundle-contract'
import type { ProblemPart } from '../types'
import {
  hashCanonicalJson,
  sha256Hex,
} from './db/hash'
import type { CanonicalJson } from './db/hash'
import type { SqlRow, SqlStatement } from './db/sql'
import { normalizePublicHttpsUrl } from './research/direct-page-fetch'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const MIGRATION_ID_PATTERN = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/u
const DIRECT_PAGE_MAX_RAW_BYTES = 1_048_576
const DIRECT_PAGE_FAILURE_MAX_RAW_BYTES = DIRECT_PAGE_MAX_RAW_BYTES + 65_536
const DIRECT_PAGE_MAX_ACCEPTED_CHARACTERS = 6_000

const PORTIA_EVIDENCE_STATES = new Set<string>([
  'portia_complete',
  'gate_passed',
  'gate_failed',
  'retry_ready',
  'retry_running',
  'charlotte_pending',
  'charlotte_running',
  'charlotte_unavailable',
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
  'insufficient_basis',
])

const GATE_EVIDENCE_STATES = new Set<string>([
  'gate_passed',
  'gate_failed',
  'retry_ready',
  'retry_running',
  'charlotte_pending',
  'charlotte_running',
  'charlotte_unavailable',
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
  'insufficient_basis',
])

const GATE_PASSED_STATES = new Set<string>([
  'gate_passed',
  'charlotte_pending',
  'charlotte_running',
  'charlotte_unavailable',
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
])

const CHARLOTTE_EVIDENCE_STATES = new Set<string>([
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
])

const TERMINAL_EVIDENCE_STATES = new Set<string>([
  'chess_terminal',
  'portia_pending',
  'portia_running',
  'portia_unavailable',
  'portia_complete',
  'gate_passed',
  'gate_failed',
  'retry_ready',
  'retry_running',
  'charlotte_pending',
  'charlotte_running',
  'charlotte_unavailable',
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
  'insufficient_basis',
])

const CASE_SECTION_KEYS = [
  'identity',
  'game',
  'lifecycle',
  'providerInvocations',
  'database',
  'redaction',
  'verificationBoundary',
] as const

const PER_PLY_PROVENANCE_NOTE =
  'The current database records client/server event source but has no per-ply policy, engine-request, or fallback columns. Null means unavailable, not none.'
const SEED_BOUNDARY_NOTE =
  'These are exact persisted seed identifiers. The bundle verifier does not claim that historical code consumed every persisted seed.'
const PROVIDER_BOUNDARY_NOTE =
  'Rows describe persisted request ledger evidence. Verification performs no provider call and does not prove provider identity, output truthfulness, or efficacy.'
const DATABASE_LEDGER_BOUNDARY =
  'Exact applied IDs, checksums, and timestamps from the read-only transaction. Local source compatibility is a separate verifier check.'
const DIRECT_PAGE_NETWORK_HISTORY_BOUNDARY =
  'Historical DNS resolution, the pinned connection peer, TLS negotiation, and the retrieval event cannot be established from an offline case bundle.'
const VERIFICATION_BOUNDARY = {
  canVerifyOffline: [
    'format and supported profile',
    'canonical section digests and integrity root for internal self-consistency',
    'bounded schema and internal referential links',
    'supported game rules, cast, engine, and event versions',
    'event-by-event canonical board reconstruction from the initial position',
    'terminal outcome summary when present',
    'local package, commit, and migration compatibility when evidence is available',
  ],
  doesNotVerify: [
    'Arachne or WebChess efficacy, validity, truthfulness, or research conclusions',
    'provider authentication, account ownership, billing, or live provider behavior',
    'private model reasoning or any content omitted by the selected profile',
    'historical seed consumption beyond the persisted identifiers',
    'per-ply policy, engine-request, or fallback provenance absent from the database schema',
    'remote publication or continued availability of the referenced source commit',
    'bundle authorship or authenticity; the SHA-256 manifest is recomputable and is not a signature',
    'whether every retained allowlisted metadata value is non-sensitive in a particular case',
    DIRECT_PAGE_NETWORK_HISTORY_BOUNDARY,
  ],
  importBehavior:
    'Read-only inspection only. Verification does not write a database, start a game, or call a model provider.',
} as const

const GAME_PRIVATE_FIELDS = [
  'id',
  'sourceGameId',
  'revision',
  'status',
  'problem',
  'problemSha256',
  'divisionSeed',
  'divisionFacets',
  'divisionModel',
  'divisionPromptVersion',
  'divisionPromptSha256',
  'divisionDigest',
  'rulesVersion',
  'engineVersion',
  'castVersion',
  'eventVersion',
  'softwareVersion',
  'researchConsentVersion',
  'researchConsentDecision',
  'researchConsentRecordedAt',
  'outcome',
  'answer',
  'createdAt',
  'updatedAt',
  'completedAt',
  'answeredAt',
] as const

const GAME_RESEARCH_FIELDS = [
  'id',
  'sourceGameId',
  'revision',
  'status',
  'problemSha256',
  'divisionSeed',
  'divisionModel',
  'divisionPromptVersion',
  'divisionPromptSha256',
  'divisionDigest',
  'rulesVersion',
  'engineVersion',
  'castVersion',
  'eventVersion',
  'softwareVersion',
  'researchConsentVersion',
  'researchConsentDecision',
  'researchConsentRecordedAt',
  'createdAt',
  'updatedAt',
  'completedAt',
  'answeredAt',
] as const

const GAME_METADATA_FIELDS = [
  'id',
  'sourceGameId',
  'revision',
  'status',
  'problemSha256',
  'divisionPromptVersion',
  'divisionPromptSha256',
  'divisionDigest',
  'rulesVersion',
  'engineVersion',
  'castVersion',
  'eventVersion',
  'softwareVersion',
  'researchConsentVersion',
  'researchConsentDecision',
  'researchConsentRecordedAt',
  'createdAt',
  'updatedAt',
  'completedAt',
  'answeredAt',
] as const

const LIFECYCLE_PRIVATE_FIELDS = [
  'id',
  'gameId',
  'rootRunId',
  'parentRunId',
  'state',
  'revision',
  'fieldGeneration',
  'gameAttempt',
  'sameFieldRetryCount',
  'fieldRegenerationCount',
  'divisionSeed',
  'castSeed',
  'trajectorySeed',
  'retryReason',
  'terminalFingerprint',
  'answerPromptDigest',
  'survivors',
  'portiaCurrentCandidateId',
  'portiaActiveModelRequestId',
  'portiaFailedAttemptCount',
  'portiaFailureLimit',
  'portiaCompletedCandidateIds',
  'portiaAssessmentDrafts',
  'charlotteActiveModelRequestId',
  'charlotteFailedAttemptCount',
  'charlotteFailureLimit',
  'softwareVersion',
  'lifecycleVersion',
  'rulesVersion',
  'engineVersion',
  'castVersion',
  'eventVersion',
  'portiaPromptVersion',
  'portiaContractVersion',
  'gateAlgorithmVersion',
  'retryPolicyVersion',
  'charlottePromptVersion',
  'charlotteContractVersion',
  'wilburRecordVersion',
  'createdAt',
  'updatedAt',
] as const

const LIFECYCLE_REDACTED_FIELDS = [
  'id',
  'gameId',
  'rootRunId',
  'parentRunId',
  'state',
  'revision',
  'fieldGeneration',
  'gameAttempt',
  'sameFieldRetryCount',
  'fieldRegenerationCount',
  'divisionSeed',
  'castSeed',
  'trajectorySeed',
  'terminalFingerprint',
  'answerPromptDigest',
  'portiaCurrentCandidateId',
  'portiaActiveModelRequestId',
  'portiaFailedAttemptCount',
  'portiaFailureLimit',
  'portiaCompletedCandidateIds',
  'charlotteActiveModelRequestId',
  'charlotteFailedAttemptCount',
  'charlotteFailureLimit',
  'softwareVersion',
  'lifecycleVersion',
  'rulesVersion',
  'engineVersion',
  'castVersion',
  'eventVersion',
  'portiaPromptVersion',
  'portiaContractVersion',
  'gateAlgorithmVersion',
  'retryPolicyVersion',
  'charlottePromptVersion',
  'charlotteContractVersion',
  'wilburRecordVersion',
  'createdAt',
  'updatedAt',
] as const

const RESEARCH_PRIVATE_FIELDS = [
  'id',
  'gameId',
  'lifecycleRunId',
  'stage',
  'requestedBy',
  'policyVersion',
  'researchConsentVersion',
  'researchConsentDecision',
  'researchConsentRecordedAt',
  'materiality',
  'reason',
  'query',
  'status',
  'provider',
  'transport',
  'model',
  'invocationLimit',
  'resultLimit',
  'sourceLimit',
  'timeoutMs',
  'synthesisCharacterLimit',
  'attemptCount',
  'executedQueries',
  'searchSynthesis',
  'directPageTextFetched',
  'retrievedFacts',
  'fetchFailures',
  'omittedSourceCount',
  'injectionSignals',
  'contentDigest',
  'failureCode',
  'startedAt',
  'completedAt',
  'createdAt',
  'updatedAt',
] as const

const RESEARCH_METADATA_FIELDS = [
  'id',
  'gameId',
  'lifecycleRunId',
  'stage',
  'requestedBy',
  'policyVersion',
  'researchConsentVersion',
  'researchConsentDecision',
  'researchConsentRecordedAt',
  'materiality',
  'status',
  'provider',
  'transport',
  'model',
  'invocationLimit',
  'resultLimit',
  'sourceLimit',
  'timeoutMs',
  'attemptCount',
  'omittedSourceCount',
  'contentDigest',
  'failureCode',
  'startedAt',
  'completedAt',
  'createdAt',
  'updatedAt',
] as const

const SOURCE_PRIVATE_FIELDS = [
  'id',
  'researchRequestId',
  'ordinal',
  'citationId',
  'title',
  'url',
  'hostname',
  'trust',
  'discoveredFrom',
  'createdAt',
] as const

const SOURCE_METADATA_FIELDS = [
  'id',
  'researchRequestId',
  'ordinal',
  'citationId',
  'hostname',
  'trust',
  'discoveredFrom',
  'createdAt',
] as const

const PORTIA_PRIVATE_FIELDS = [
  'id',
  'lifecycleRunId',
  'modelRequestId',
  'inputDigest',
  'outputDigest',
  'promptVersion',
  'contractVersion',
  'review',
  'createdAt',
] as const

const PORTIA_METADATA_FIELDS = PORTIA_PRIVATE_FIELDS.filter(
  (field) => field !== 'review',
)

const GATE_PRIVATE_FIELDS = [
  'id',
  'lifecycleRunId',
  'algorithmVersion',
  'inputDigest',
  'passed',
  'result',
  'answerUserPrompt',
  'answerUserPromptSha256',
  'createdAt',
] as const

const GATE_METADATA_FIELDS = GATE_PRIVATE_FIELDS.filter(
  (field) => field !== 'result' && field !== 'answerUserPrompt',
)

const CHARLOTTE_PRIVATE_FIELDS = [
  'id',
  'lifecycleRunId',
  'modelRequestId',
  'inputDigest',
  'outputDigest',
  'promptVersion',
  'contractVersion',
  'result',
  'renderedAnswer',
  'createdAt',
] as const

const CHARLOTTE_METADATA_FIELDS = CHARLOTTE_PRIVATE_FIELDS.filter(
  (field) => field !== 'result' && field !== 'renderedAnswer',
)

const WILBUR_ACTION_PRIVATE_FIELDS = [
  'id',
  'lifecycleRunId',
  'charlotteActionIndex',
  'charlotteBindingVersion',
  'requestDigest',
  'actor',
  'action',
  'testedAssumption',
  'expectedObservation',
  'decisionThreshold',
  'reviewHorizon',
  'status',
  'revision',
  'recordVersion',
  'createdAt',
  'updatedAt',
] as const

const WILBUR_ACTION_METADATA_FIELDS = [
  'id',
  'lifecycleRunId',
  'charlotteActionIndex',
  'charlotteBindingVersion',
  'requestDigest',
  'status',
  'revision',
  'recordVersion',
  'createdAt',
  'updatedAt',
] as const

const WILBUR_OBSERVATION_PRIVATE_FIELDS = [
  'id',
  'actionId',
  'requestDigest',
  'observedAt',
  'observation',
  'evidenceClassification',
  'expectedEffect',
  'unexpectedEffect',
  'stakeholderResponse',
  'assumptionResult',
  'nextDecision',
  'recordVersion',
  'createdAt',
] as const

const WILBUR_OBSERVATION_METADATA_FIELDS = [
  'id',
  'actionId',
  'requestDigest',
  'observedAt',
  'assumptionResult',
  'recordVersion',
  'createdAt',
] as const

const ACTIVITY_FIELDS = [
  'id',
  'lifecycleRunId',
  'sequence',
  'stage',
  'activityType',
  'stateFrom',
  'stateTo',
  'inputEntityIds',
  'outputEntityIds',
  'responsibleAgentIds',
  'configurationDigest',
  'status',
  'eventVersion',
  'createdAt',
] as const

const MODEL_PRIVATE_FIELDS = [
  'id',
  'gameId',
  'operation',
  'idempotencyKey',
  'requestSha256',
  'status',
  'attempt',
  'provider',
  'model',
  'promptVersion',
  'softwareVersion',
  'providerResponseId',
  'responseSha256',
  'resultPayload',
  'usageReported',
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
  'providerStartedAt',
  'completedAt',
  'failureCode',
  'providerHttpStatus',
  'createdAt',
  'updatedAt',
] as const

const MODEL_RESEARCH_FIELDS = MODEL_PRIVATE_FIELDS.filter(
  (field) => ![
    'idempotencyKey',
    'providerResponseId',
    'resultPayload',
  ].includes(field),
)

const MODEL_METADATA_FIELDS = [
  'id',
  'gameId',
  'operation',
  'requestSha256',
  'status',
  'attempt',
  'provider',
  'model',
  'promptVersion',
  'softwareVersion',
  'responseSha256',
  'usageReported',
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
  'providerStartedAt',
  'completedAt',
  'failureCode',
  'providerHttpStatus',
  'createdAt',
  'updatedAt',
] as const

const EVENT_PROVENANCE_PRIVATE_FIELDS = [
  'source',
  'idempotencyKey',
  'requestSha256',
  'gameRevision',
  'createdAt',
] as const

const EVENT_PROVENANCE_RESEARCH_FIELDS = [
  'source',
  'requestSha256',
  'gameRevision',
  'createdAt',
] as const

const EVENT_PROVENANCE_METADATA_FIELDS = [
  'source',
  'gameRevision',
  'createdAt',
] as const

type JsonObject = { [key: string]: CanonicalJson }
type FieldList = readonly string[]

interface FieldPolicy {
  readonly gameRecord: FieldList
  readonly lifecycleRun: FieldList
  readonly researchRequests: FieldList
  readonly researchSources: FieldList
  readonly portiaReviews: FieldList
  readonly gateDecisions: FieldList
  readonly charlotteResults: FieldList
  readonly wilburActions: FieldList
  readonly wilburObservations: FieldList
  readonly lifecycleActivities: FieldList
  readonly modelRequests: FieldList
  readonly eventProvenance: FieldList
}

const PROFILE_FIELD_POLICIES: Readonly<Record<WebChessCaseProfile, FieldPolicy>> = {
  'private-full-v1': {
    gameRecord: GAME_PRIVATE_FIELDS,
    lifecycleRun: LIFECYCLE_PRIVATE_FIELDS,
    researchRequests: RESEARCH_PRIVATE_FIELDS,
    researchSources: SOURCE_PRIVATE_FIELDS,
    portiaReviews: PORTIA_PRIVATE_FIELDS,
    gateDecisions: GATE_PRIVATE_FIELDS,
    charlotteResults: CHARLOTTE_PRIVATE_FIELDS,
    wilburActions: WILBUR_ACTION_PRIVATE_FIELDS,
    wilburObservations: WILBUR_OBSERVATION_PRIVATE_FIELDS,
    lifecycleActivities: ACTIVITY_FIELDS,
    modelRequests: MODEL_PRIVATE_FIELDS,
    eventProvenance: EVENT_PROVENANCE_PRIVATE_FIELDS,
  },
  'research-redacted-v1': {
    gameRecord: GAME_RESEARCH_FIELDS,
    lifecycleRun: LIFECYCLE_REDACTED_FIELDS,
    researchRequests: RESEARCH_METADATA_FIELDS,
    researchSources: SOURCE_METADATA_FIELDS,
    portiaReviews: PORTIA_METADATA_FIELDS,
    gateDecisions: GATE_METADATA_FIELDS,
    charlotteResults: CHARLOTTE_METADATA_FIELDS,
    wilburActions: WILBUR_ACTION_METADATA_FIELDS,
    wilburObservations: WILBUR_OBSERVATION_METADATA_FIELDS,
    lifecycleActivities: ACTIVITY_FIELDS,
    modelRequests: MODEL_RESEARCH_FIELDS,
    eventProvenance: EVENT_PROVENANCE_RESEARCH_FIELDS,
  },
  'metadata-only-v1': {
    gameRecord: GAME_METADATA_FIELDS,
    lifecycleRun: LIFECYCLE_REDACTED_FIELDS,
    researchRequests: RESEARCH_METADATA_FIELDS,
    researchSources: SOURCE_METADATA_FIELDS,
    portiaReviews: PORTIA_METADATA_FIELDS,
    gateDecisions: GATE_METADATA_FIELDS,
    charlotteResults: CHARLOTTE_METADATA_FIELDS,
    wilburActions: WILBUR_ACTION_METADATA_FIELDS,
    wilburObservations: WILBUR_OBSERVATION_METADATA_FIELDS,
    lifecycleActivities: ACTIVITY_FIELDS,
    modelRequests: MODEL_METADATA_FIELDS,
    eventProvenance: EVENT_PROVENANCE_METADATA_FIELDS,
  },
}

const RESEARCH_CONSENT_FIELD_NAMES = new Set<string>([
  'researchConsentVersion',
  'researchConsentDecision',
  'researchConsentRecordedAt',
])

function withoutFields(
  fields: FieldList,
  omitted: ReadonlySet<string>,
): readonly string[] {
  return fields.filter((field) => !omitted.has(field))
}

/**
 * Bundles emitted before direct-page provenance was added used the same public
 * format identifier. Retain their exact declared allowlists during import;
 * all newly-created bundles use PROFILE_FIELD_POLICIES above.
 */
const LEGACY_PROFILE_FIELD_POLICIES: Readonly<Record<
  WebChessCaseProfile,
  FieldPolicy
>> = Object.fromEntries(
  WEBCHESS_CASE_PROFILES.map((profile) => {
    const current = PROFILE_FIELD_POLICIES[profile]
    return [profile, {
      ...current,
      gameRecord: withoutFields(
        current.gameRecord,
        RESEARCH_CONSENT_FIELD_NAMES,
      ),
      researchRequests: withoutFields(
        current.researchRequests,
        new Set([
          ...RESEARCH_CONSENT_FIELD_NAMES,
          'fetchFailures',
        ]),
      ),
    }]
  }),
) as unknown as Readonly<Record<WebChessCaseProfile, FieldPolicy>>

export interface CaseBundleSourceRows {
  readonly game: SqlRow
  readonly events: readonly SqlRow[]
  readonly lifecycleRun: SqlRow
  readonly researchRequests: readonly SqlRow[]
  readonly researchSources: readonly SqlRow[]
  readonly portiaReviews: readonly SqlRow[]
  readonly gateDecisions: readonly SqlRow[]
  readonly charlotteResults: readonly SqlRow[]
  readonly wilburActions: readonly SqlRow[]
  readonly wilburObservations: readonly SqlRow[]
  readonly lifecycleActivities: readonly SqlRow[]
  readonly modelRequests: readonly SqlRow[]
  readonly migrations: readonly SqlRow[]
}

export interface CreateCaseBundleInput extends CaseBundleSourceRows {
  readonly profile: WebChessCaseProfile
  readonly exportedAt: string
  readonly packageName: string
  readonly packageVersion: string
  readonly sourceCommit: string | null
  readonly runtimeArtifactSha256?: string | null
}

export interface WebChessCaseBundle {
  readonly format: typeof WEBCHESS_CASE_BUNDLE_FORMAT
  readonly profile: WebChessCaseProfile
  readonly manifest: {
    readonly algorithm: 'sha256'
    readonly canonicalization: typeof WEBCHESS_CASE_CANONICALIZATION
    readonly entries: readonly {
      readonly path: string
      readonly sha256: string
    }[]
    readonly integrityRoot: string
  }
  readonly data: Readonly<Record<(typeof CASE_SECTION_KEYS)[number], CanonicalJson>>
}

export interface LocalCaseVerificationContext {
  readonly packageName: string
  readonly packageVersion: string
  readonly sourceCommit: string | null
  readonly sourceTreeClean?: boolean
  readonly runtimeArtifactSha256?: string | null
  readonly migrations: Readonly<Record<string, string>>
}

export interface CaseVerificationResult {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly verified: readonly string[]
  readonly notVerified: readonly string[]
  readonly replay: {
    readonly checked: boolean
    readonly exactProblemMapping: boolean
    readonly completedPlies: number | null
    readonly terminal: boolean | null
  }
}

function jsonValue(value: unknown, path = '$'): CanonicalJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number.`)
    }
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(item, `${path}.${key}`),
      ]),
    )
  }
  throw new TypeError(`${path} contains unsupported ${typeof value} data.`)
}

function pick(row: SqlRow, fields: FieldList, label: string): JsonObject {
  return Object.fromEntries(fields.map((field) => {
    if (!Object.hasOwn(row, field)) {
      throw new TypeError(`${label} is missing the ${field} field.`)
    }
    return [field, jsonValue(row[field], `${label}.${field}`)]
  }))
}

function pickRows(
  rows: readonly SqlRow[],
  fields: FieldList,
  label: string,
): readonly JsonObject[] {
  return rows.map((row, index) => pick(row, fields, `${label}[${index}]`))
}

function requiredString(row: SqlRow, field: string, label: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label}.${field} must be a non-empty string.`)
  }
  return value
}

function requiredInteger(row: SqlRow, field: string, label: string): number {
  const value = row[field]
  const parsed = typeof value === 'string' && /^\d+$/u.test(value)
    ? Number(value)
    : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new TypeError(`${label}.${field} must be a non-negative integer.`)
  }
  return Number(parsed)
}

function optionalString(row: SqlRow, field: string): string | null {
  const value = row[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function neutralReplayParts(): readonly ProblemPart[] {
  return Array.from({ length: 64 }, (_, index) => ({
    id: index + 1,
    title: `Redacted square ${index + 1}`,
    focus: 'Content omitted by the selected export profile.',
    hexagram: 1,
    hexagramName: 'Redacted',
    theme: 'redacted',
    dimension: 'redacted',
    movement: 'redacted',
    prompt: 'Content omitted by the selected export profile.',
    keyword: 'redacted',
  }))
}

function canonicalEvent(row: SqlRow, eventVersion: number): JsonObject {
  const kind = requiredString(row, 'kind', 'event')
  const ply = requiredInteger(row, 'ply', 'event')
  const side = requiredString(row, 'side', 'event')
  if (kind === 'pass') {
    return {
      version: eventVersion,
      type: 'forced-pass',
      ply,
      side,
      reason: 'no-legal-move',
    }
  }
  if (kind !== 'move') throw new TypeError(`Unsupported game event kind: ${kind}.`)

  const event: JsonObject = {
    version: eventVersion,
    type: 'move',
    ply,
    side,
    pieceId: requiredString(row, 'pieceId', 'event'),
    from: {
      ring: requiredInteger(row, 'fromRing', 'event'),
      sector: requiredInteger(row, 'fromSector', 'event'),
    },
    to: {
      ring: requiredInteger(row, 'toRing', 'event'),
      sector: requiredInteger(row, 'toSector', 'event'),
    },
  }
  const capturedPieceId = optionalString(row, 'capturedPieceId')
  const promotedTo = optionalString(row, 'promotedTo')
  if (capturedPieceId) event.capturedPieceId = capturedPieceId
  if (promotedTo) event.promotedTo = promotedTo
  return event
}

function terminalSummary(outcome: unknown): CanonicalJson {
  if (outcome === null || outcome === undefined) return null
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    throw new TypeError('The stored game outcome is not an object.')
  }
  const record = outcome as Record<string, unknown>
  return {
    winner: jsonValue(record.winner, 'game.outcome.winner'),
    reason: jsonValue(record.reason, 'game.outcome.reason'),
    completedTurn: jsonValue(
      record.completedTurn,
      'game.outcome.completedTurn',
    ),
  }
}

const ALWAYS_OMISSION_DEFINITIONS = [{
    path: '/ownerPrincipal',
    reason: 'Owner identifiers are authorization inputs, not portable case evidence.',
  }, {
    path: '/credentials',
    reason: 'Credentials, cookies, tokens, and request headers are never queried or exported.',
  }, {
    path: '/privateModelReasoning',
    reason: 'Private model reasoning is not stored as case evidence.',
  }, {
    path: '/accountUsageAndRateLedgers',
    reason: 'Account-wide controls and rate ledgers are outside this single-case scope.',
  }] as const

function omissionRows(
  prefix: string,
  fields: readonly string[],
  reason: string,
) {
  return fields.map((field) => ({ path: `${prefix}/${field}`, reason }))
}

const REDACTED_OMISSION_DEFINITIONS = [{
  path: '/data/game/record/problem',
  reason: 'User-authored problem text is omitted by this profile.',
}, {
  path: '/data/game/replay/parts',
  reason: 'Mapped problem text is replaced by deterministic neutral replay parts; its digest is retained.',
}, {
  path: '/data/game/record/divisionFacets',
  reason: 'Generated facet text is omitted by this profile.',
}, {
  path: '/data/game/record/outcome',
  reason: 'The stored outcome payload is omitted; the replay-derived terminal summary remains.',
}, {
  path: '/data/game/record/answer',
  reason: 'Generated answer and full prompt content are omitted by this profile.',
}, {
  path: '/data/lifecycle/run/retryReason',
  reason: 'Free-text retry rationale is omitted; retry counters and ancestry identifiers remain.',
}, {
  path: '/data/lifecycle/run/survivors',
  reason: 'Portia survivor payloads are omitted; lifecycle state, counts, and artifact bindings remain.',
}, {
  path: '/data/lifecycle/run/portiaAssessmentDrafts',
  reason: 'Portia assessment drafts are omitted; completed artifact bindings remain.',
}, ...omissionRows(
  '/data/lifecycle/portiaReviews/*',
  ['review'],
  'Portia narrative content is omitted; its input/output digests and versions remain.',
), ...omissionRows(
  '/data/lifecycle/gateDecisions/*',
  ['result', 'answerUserPrompt'],
  'Gate narrative and approved prompt text are omitted; decision and digests remain.',
), ...omissionRows(
  '/data/lifecycle/charlotteResults/*',
  ['result', 'renderedAnswer'],
  'Charlotte narrative and rendered answer are omitted; digests and versions remain.',
), ...omissionRows(
  '/data/lifecycle/researchRequests/*',
  [
    'reason',
    'query',
    'synthesisCharacterLimit',
    'executedQueries',
    'searchSynthesis',
    'directPageTextFetched',
    'retrievedFacts',
    'injectionSignals',
  ],
  'Research rationale, queries, synthesis, fetched-text indicators, facts, and injection excerpts are omitted.',
), ...omissionRows(
  '/data/lifecycle/researchSources/*',
  ['title', 'url'],
  'Source titles and full URLs are omitted; hostname and trust metadata remain.',
), {
  path: '/data/lifecycle/researchRequests/*/fetchFailures',
  reason: 'Direct-page fetch failure URLs, redirect history, response digests, and injection-signal details are omitted.',
}, ...omissionRows(
  '/data/lifecycle/wilburActions/*',
  [
    'actor',
    'action',
    'testedAssumption',
    'expectedObservation',
    'decisionThreshold',
    'reviewHorizon',
  ],
  'Wilbur action narrative fields are omitted; status, binding, and digests remain.',
), ...omissionRows(
  '/data/lifecycle/wilburObservations/*',
  [
    'observation',
    'evidenceClassification',
    'expectedEffect',
    'unexpectedEffect',
    'stakeholderResponse',
    'nextDecision',
  ],
  'Wilbur observation narrative fields are omitted; classifications, bindings, and digests remain.',
), ...omissionRows(
  '/data/providerInvocations/modelRequests/*',
  ['idempotencyKey', 'providerResponseId', 'resultPayload'],
  'Model-request idempotency keys, provider response identifiers, and result payloads are omitted; models, versions, request/response digests, status, and token metadata remain.',
), {
  path: '/data/game/replay/events/*/provenance/idempotencyKey',
  reason: 'Move idempotency keys are omitted by share-oriented profiles; request digests remain in the research-redacted profile.',
}] as const

const FETCH_FAILURE_OMISSION_PATH =
  '/data/lifecycle/researchRequests/*/fetchFailures'

const LEGACY_REDACTED_OMISSION_DEFINITIONS =
  REDACTED_OMISSION_DEFINITIONS.filter(
    ({ path }) => path !== FETCH_FAILURE_OMISSION_PATH,
  )

const METADATA_OMISSION_DEFINITIONS = [{
    path: '/data/game/record/divisionSeed',
    reason: 'The narrowest profile omits the persisted division seed.',
  }, {
    path: '/data/game/record/divisionModel',
    reason: 'The narrowest profile omits the Division provider-model label.',
  }, {
    path: '/data/game/replay/events/*/provenance/requestSha256',
    reason: 'The narrowest profile omits per-move request digests.',
  }] as const

function omittedPolicyPaths(
  profile: WebChessCaseProfile,
  policies: Readonly<Record<WebChessCaseProfile, FieldPolicy>> =
    PROFILE_FIELD_POLICIES,
): readonly string[] {
  if (profile === 'private-full-v1') return []
  const retained = policies[profile]
  const privateFields = policies['private-full-v1']
  return [
    ...privateFields.gameRecord
      .filter((field) => !retained.gameRecord.includes(field))
      .map((field) => `/data/game/record/${field}`),
    '/data/game/replay/parts',
    ...privateFields.lifecycleRun
      .filter((field) => !retained.lifecycleRun.includes(field))
      .map((field) => `/data/lifecycle/run/${field}`),
    ...privateFields.researchRequests
      .filter((field) => !retained.researchRequests.includes(field))
      .map((field) => `/data/lifecycle/researchRequests/*/${field}`),
    ...privateFields.researchSources
      .filter((field) => !retained.researchSources.includes(field))
      .map((field) => `/data/lifecycle/researchSources/*/${field}`),
    ...privateFields.portiaReviews
      .filter((field) => !retained.portiaReviews.includes(field))
      .map((field) => `/data/lifecycle/portiaReviews/*/${field}`),
    ...privateFields.gateDecisions
      .filter((field) => !retained.gateDecisions.includes(field))
      .map((field) => `/data/lifecycle/gateDecisions/*/${field}`),
    ...privateFields.charlotteResults
      .filter((field) => !retained.charlotteResults.includes(field))
      .map((field) => `/data/lifecycle/charlotteResults/*/${field}`),
    ...privateFields.wilburActions
      .filter((field) => !retained.wilburActions.includes(field))
      .map((field) => `/data/lifecycle/wilburActions/*/${field}`),
    ...privateFields.wilburObservations
      .filter((field) => !retained.wilburObservations.includes(field))
      .map((field) => `/data/lifecycle/wilburObservations/*/${field}`),
    ...privateFields.modelRequests
      .filter((field) => !retained.modelRequests.includes(field))
      .map((field) => `/data/providerInvocations/modelRequests/*/${field}`),
    ...privateFields.eventProvenance
      .filter((field) => !retained.eventProvenance.includes(field))
      .map((field) => `/data/game/replay/events/*/provenance/${field}`),
  ].sort()
}

function omissionDefinitions(
  profile: WebChessCaseProfile,
  legacy = false,
) {
  const redactedDefinitions = legacy
    ? LEGACY_REDACTED_OMISSION_DEFINITIONS
    : REDACTED_OMISSION_DEFINITIONS
  const definitions = profile === 'private-full-v1'
    ? [...ALWAYS_OMISSION_DEFINITIONS]
    : profile === 'research-redacted-v1'
      ? [...ALWAYS_OMISSION_DEFINITIONS, ...redactedDefinitions]
      : [
    ...ALWAYS_OMISSION_DEFINITIONS,
    ...redactedDefinitions,
    ...METADATA_OMISSION_DEFINITIONS,
  ]
  const declaredPolicyPaths = definitions
    .slice(ALWAYS_OMISSION_DEFINITIONS.length)
    .map(({ path }) => path)
    .sort()
  const expectedPolicyPaths = omittedPolicyPaths(
    profile,
    legacy ? LEGACY_PROFILE_FIELD_POLICIES : PROFILE_FIELD_POLICIES,
  )
  if (
    declaredPolicyPaths.length !== expectedPolicyPaths.length ||
    declaredPolicyPaths.some(
      (path, index) => path !== expectedPolicyPaths[index],
    )
  ) {
    throw new TypeError(
      `The ${profile} omission ledger is not exhaustive for its field allowlist.`,
    )
  }
  return definitions
}

function omittedValueCount(value: unknown): number {
  if (value === null) return 0
  return Array.isArray(value) ? value.length : 1
}

function omittedRecordFieldCount(
  record: SqlRow,
  field: string,
  path: string,
): number {
  if (!Object.hasOwn(record, field)) {
    throw new TypeError(`The omission source is missing ${path}.`)
  }
  return omittedValueCount(record[field])
}

function omittedRowFieldCount(
  rows: readonly SqlRow[],
  field: string,
  path: string,
): number {
  return rows.reduce(
    (count, row) => count + omittedRecordFieldCount(row, field, path),
    0,
  )
}

function omissionCount(path: string, source: CaseBundleSourceRows): number | null {
  switch (path) {
    case '/ownerPrincipal': return 1
    case '/credentials':
    case '/privateModelReasoning':
    case '/accountUsageAndRateLedgers': return null
    case '/data/game/replay/parts':
      return Array.isArray(source.game.problemParts) ? source.game.problemParts.length : 0
    default: break
  }

  const gameField = path.match(/^\/data\/game\/record\/([^/]+)$/u)?.[1]
  if (gameField) {
    return omittedRecordFieldCount(source.game, gameField, path)
  }
  const lifecycleRunField = path.match(
    /^\/data\/lifecycle\/run\/([^/]+)$/u,
  )?.[1]
  if (lifecycleRunField) {
    return omittedRecordFieldCount(source.lifecycleRun, lifecycleRunField, path)
  }
  const collectionMatch = path.match(
    /^\/data\/lifecycle\/(researchRequests|researchSources|portiaReviews|gateDecisions|charlotteResults|wilburActions|wilburObservations)\/\*\/([^/]+)$/u,
  )
  if (collectionMatch) {
    const [, collection, field] = collectionMatch
    return omittedRowFieldCount(
      source[collection as keyof Pick<
        CaseBundleSourceRows,
        | 'researchRequests'
        | 'researchSources'
        | 'portiaReviews'
        | 'gateDecisions'
        | 'charlotteResults'
        | 'wilburActions'
        | 'wilburObservations'
      >],
      field!,
      path,
    )
  }
  const modelField = path.match(
    /^\/data\/providerInvocations\/modelRequests\/\*\/([^/]+)$/u,
  )?.[1]
  if (modelField) {
    return omittedRowFieldCount(source.modelRequests, modelField, path)
  }
  const eventField = path.match(
    /^\/data\/game\/replay\/events\/\*\/provenance\/([^/]+)$/u,
  )?.[1]
  if (eventField) return omittedRowFieldCount(source.events, eventField, path)
  throw new TypeError(`Unsupported omission ledger path: ${path}.`)
}

function omissionLedger(
  profile: WebChessCaseProfile,
  source: CaseBundleSourceRows,
): readonly JsonObject[] {
  return omissionDefinitions(profile).map(({ path, reason }) => ({
    path,
    reason,
    omittedCount: omissionCount(path, source),
  }))
}

function fieldPolicyJson(policy: FieldPolicy): JsonObject {
  return Object.fromEntries(
    Object.entries(policy).map(([key, fields]) => [key, [...fields]]),
  )
}

function normalizedCommit(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim().toLowerCase()
  if (!COMMIT_PATTERN.test(normalized)) {
    throw new TypeError('The configured source commit must be a 40-character Git SHA.')
  }
  return normalized
}

function normalizedArtifactSha256(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError('The configured runtime artifact digest must be SHA-256.')
  }
  return normalized
}

function normalizedTimestamp(value: string, label: string): string {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be an ISO timestamp.`)
  }
  return new Date(milliseconds).toISOString()
}

export function createCaseBundle(input: CreateCaseBundleInput): WebChessCaseBundle {
  const profile = input.profile
  const policy = PROFILE_FIELD_POLICIES[profile]
  if (!policy) throw new TypeError(`Unsupported case export profile: ${profile}.`)

  const gameId = requiredString(input.game, 'id', 'game')
  const lifecycleRunId = requiredString(input.lifecycleRun, 'id', 'lifecycleRun')
  if (requiredString(input.lifecycleRun, 'gameId', 'lifecycleRun') !== gameId) {
    throw new TypeError('The lifecycle run does not belong to the exported game.')
  }
  const eventVersion = requiredInteger(input.game, 'eventVersion', 'game')
  const originalParts = jsonValue(input.game.problemParts, 'game.problemParts')
  if (!Array.isArray(originalParts) || originalParts.length !== 64) {
    throw new TypeError('A case bundle requires exactly 64 stored problem parts.')
  }
  const exactProblemMapping = profile === 'private-full-v1'
  const replayParts = exactProblemMapping
    ? originalParts
    : jsonValue(neutralReplayParts(), 'neutralReplayParts')
  const sourceCommit = normalizedCommit(input.sourceCommit)
  const runtimeArtifactSha256 = normalizedArtifactSha256(
    input.runtimeArtifactSha256,
  )

  const gameEvents = input.events.map((row, index) => ({
    event: canonicalEvent(row, eventVersion),
    provenance: pick(
      row,
      policy.eventProvenance,
      `eventProvenance[${index}]`,
    ),
  }))
  const migrations = input.migrations.map((row, index) => pick(
    row,
    ['id', 'checksum', 'appliedAt'],
    `migrations[${index}]`,
  ))

  const data: WebChessCaseBundle['data'] = {
    identity: {
      exportedAt: normalizedTimestamp(input.exportedAt, 'exportedAt'),
      gameId,
      lifecycleRunId,
      rootRunId: jsonValue(input.lifecycleRun.rootRunId, 'lifecycleRun.rootRunId'),
      parentRunId: jsonValue(input.lifecycleRun.parentRunId, 'lifecycleRun.parentRunId'),
      source: {
        repository: 'https://github.com/jr4488/webchess',
        sourceCommit,
        sourceCommitAvailability: sourceCommit === null
          ? 'not-configured-at-runtime'
          : 'configured-immutable-commit',
        package: {
          name: input.packageName,
          version: input.packageVersion,
        },
        runtimeArtifact: {
          format: 'webchess-runtime-payload/1',
          sha256: runtimeArtifactSha256,
          availability: runtimeArtifactSha256 === null
            ? 'not-configured-at-runtime'
            : 'configured-runtime-payload-digest',
        },
      },
    },
    game: {
      record: pick(input.game, policy.gameRecord, 'game'),
      terminalSummary: terminalSummary(input.game.outcome),
      replay: {
        parts: replayParts,
        partsMode: exactProblemMapping
          ? 'exact-stored-problem-mapping'
          : 'deterministic-neutral-redaction-substitute',
        originalPartsSha256: hashCanonicalJson(originalParts),
        events: gameEvents,
        perPlyProvenanceAvailability: {
          source: 'available-as-events[].provenance.source',
          policyVersion: null,
          engineRequestId: null,
          fallbackMode: null,
          note: PER_PLY_PROVENANCE_NOTE,
        },
      },
    },
    lifecycle: {
      run: pick(input.lifecycleRun, policy.lifecycleRun, 'lifecycleRun'),
      researchRequests: pickRows(
        input.researchRequests,
        policy.researchRequests,
        'researchRequests',
      ),
      researchSources: pickRows(
        input.researchSources,
        policy.researchSources,
        'researchSources',
      ),
      portiaReviews: pickRows(
        input.portiaReviews,
        policy.portiaReviews,
        'portiaReviews',
      ),
      gateDecisions: pickRows(
        input.gateDecisions,
        policy.gateDecisions,
        'gateDecisions',
      ),
      charlotteResults: pickRows(
        input.charlotteResults,
        policy.charlotteResults,
        'charlotteResults',
      ),
      wilburActions: pickRows(
        input.wilburActions,
        policy.wilburActions,
        'wilburActions',
      ),
      wilburObservations: pickRows(
        input.wilburObservations,
        policy.wilburObservations,
        'wilburObservations',
      ),
      activities: pickRows(
        input.lifecycleActivities,
        policy.lifecycleActivities,
        'lifecycleActivities',
      ),
      seedBoundary: {
        divisionSeed: jsonValue(input.lifecycleRun.divisionSeed, 'lifecycleRun.divisionSeed'),
        castSeed: jsonValue(input.lifecycleRun.castSeed, 'lifecycleRun.castSeed'),
        trajectorySeed: jsonValue(input.lifecycleRun.trajectorySeed, 'lifecycleRun.trajectorySeed'),
        note: SEED_BOUNDARY_NOTE,
      },
    },
    providerInvocations: {
      modelRequests: pickRows(
        input.modelRequests,
        policy.modelRequests,
        'modelRequests',
      ),
      boundary: {
        note: PROVIDER_BOUNDARY_NOTE,
      },
    },
    database: {
      migrationLedger: migrations,
      ledgerBoundary: DATABASE_LEDGER_BOUNDARY,
    },
    redaction: {
      policy: WEBCHESS_CASE_REDACTION_POLICY,
      profile,
      selection: 'field-allowlist',
      allowlists: fieldPolicyJson(policy),
      omissions: omissionLedger(profile, input),
    },
    verificationBoundary: jsonValue(VERIFICATION_BOUNDARY),
  }

  const entries = CASE_SECTION_KEYS.map((key) => ({
    path: `/data/${key}`,
    sha256: hashCanonicalJson(data[key]),
  }))
  const integrityRoot = hashCanonicalJson({
    format: WEBCHESS_CASE_BUNDLE_FORMAT,
    profile,
    algorithm: 'sha256',
    canonicalization: WEBCHESS_CASE_CANONICALIZATION,
    entries,
  })

  return {
    format: WEBCHESS_CASE_BUNDLE_FORMAT,
    profile,
    manifest: {
      algorithm: 'sha256',
      canonicalization: WEBCHESS_CASE_CANONICALIZATION,
      entries,
      integrityRoot,
    },
    data,
  }
}

function boundedJson(value: unknown): void {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > 250_000) throw new TypeError('The case bundle has too many JSON nodes.')
    if (current.depth > 64) throw new TypeError('The case bundle is nested too deeply.')
    if (typeof current.value === 'string' && current.value.length > 3_000_000) {
      throw new TypeError('The case bundle contains an oversized string.')
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > 20_000) {
        throw new TypeError('The case bundle contains an oversized array.')
      }
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 })
      }
    } else if (current.value && typeof current.value === 'object') {
      const entries = Object.entries(current.value)
      if (entries.length > 256) {
        throw new TypeError('The case bundle contains an oversized object.')
      }
      for (const [key, item] of entries) {
        if (key.length > 256) throw new TypeError('The case bundle contains an oversized key.')
        stack.push({ value: item, depth: current.depth + 1 })
      }
    }
  }
}

function objectAt(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function arrayAt(value: unknown, label: string, maximum = 20_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be an array with at most ${maximum} entries.`)
  }
  return value
}

function stringAt(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
  return value
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unsupported or missing fields.`)
  }
}

function exactRows(
  value: unknown,
  label: string,
  fields: readonly string[],
  maximum: number,
  errors?: string[],
): readonly Record<string, unknown>[] {
  return arrayAt(value, label, maximum).map((row, index) => {
    const record = objectAt(row, `${label}[${index}]`)
    exactKeys(record, fields, `${label}[${index}]`)
    if (errors) {
      checkKnownFieldValueShapes(record, `${label}[${index}]`, errors)
    }
    return record
  })
}

const UUID_VALUE_FIELDS = new Set([
  'id',
  'gameId',
  'sourceGameId',
  'rootRunId',
  'parentRunId',
  'lifecycleRunId',
  'modelRequestId',
  'researchRequestId',
  'actionId',
  'portiaActiveModelRequestId',
  'charlotteActiveModelRequestId',
  'idempotencyKey',
])

const INTEGER_VALUE_FIELDS = new Set([
  'revision',
  'fieldGeneration',
  'gameAttempt',
  'sameFieldRetryCount',
  'fieldRegenerationCount',
  'portiaFailedAttemptCount',
  'portiaFailureLimit',
  'charlotteFailedAttemptCount',
  'charlotteFailureLimit',
  'ordinal',
  'invocationLimit',
  'resultLimit',
  'sourceLimit',
  'timeoutMs',
  'synthesisCharacterLimit',
  'attemptCount',
  'omittedSourceCount',
  'charlotteActionIndex',
  'attempt',
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
  'sequence',
  'eventVersion',
  'gameRevision',
  'omittedCount',
  'providerHttpStatus',
])

const BOOLEAN_VALUE_FIELDS = new Set([
  'passed',
  'directPageTextFetched',
  'usageReported',
])

const STRING_ARRAY_VALUE_FIELDS: ReadonlyMap<string, {
  readonly maximum: number
  readonly minimumChars: number
  readonly maximumChars: number
}> = new Map([
  ['portiaCompletedCandidateIds', { maximum: 32, minimumChars: 3, maximumChars: 220 }],
  ['executedQueries', { maximum: 500, minimumChars: 1, maximumChars: 500 }],
  ['injectionSignals', { maximum: 20, minimumChars: 3, maximumChars: 80 }],
  ['inputEntityIds', { maximum: 128, minimumChars: 1, maximumChars: 220 }],
  ['outputEntityIds', { maximum: 128, minimumChars: 1, maximumChars: 220 }],
  ['responsibleAgentIds', { maximum: 128, minimumChars: 1, maximumChars: 220 }],
] as const)

const STRUCTURED_ARRAY_VALUE_FIELDS = new Set([
  'divisionFacets',
  'survivors',
  'portiaAssessmentDrafts',
  'retrievedFacts',
  'fetchFailures',
])

const OBJECT_VALUE_FIELDS = new Set([
  'outcome',
  'answer',
  'review',
  'result',
  'resultPayload',
])

const NULLABLE_OBJECT_VALUE_FIELDS = new Set([
  'outcome',
  'answer',
  'resultPayload',
])

function validIntegerValue(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^\d+$/u.test(value) &&
      Number.isSafeInteger(Number(value)))
  )
}

function validJsonInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum
}

function checkKnownFieldValueShapes(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  for (const [field, value] of Object.entries(record)) {
    const stringArrayBounds = STRING_ARRAY_VALUE_FIELDS.get(field)
    if (stringArrayBounds) {
      if (!Array.isArray(value)) {
        errors.push(`${label}.${field} must be an array.`)
      } else if (value.length > stringArrayBounds.maximum) {
        errors.push(`${label}.${field} exceeds its maximum item count.`)
      } else if (value.some((item) =>
        typeof item !== 'string' ||
        item.length < stringArrayBounds.minimumChars ||
        item.length > stringArrayBounds.maximumChars
      )) {
        errors.push(`${label}.${field} must contain only bounded non-empty strings.`)
      }
      continue
    }
    if (STRUCTURED_ARRAY_VALUE_FIELDS.has(field)) {
      if (field === 'survivors' && value === null) continue
      if (!Array.isArray(value)) {
        errors.push(`${label}.${field} must be an array${
          field === 'survivors' ? ' or null' : ''
        }.`)
        continue
      }
      const maximum = field === 'divisionFacets'
        ? 64
        : ['retrievedFacts', 'fetchFailures'].includes(field)
          ? 3
          : 32
      if (
        value.length > maximum ||
        (field === 'divisionFacets' && value.length !== 64) ||
        value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
      ) {
        errors.push(`${label}.${field} has an invalid structured-array shape.`)
        continue
      }
      if (field === 'survivors' && value.some((item) => {
        const survivor = item as Record<string, unknown>
        return (
          typeof survivor.candidateId !== 'string' ||
          survivor.candidateId.length < 3 ||
          survivor.candidateId.length > 220 ||
          typeof survivor.sourceDigest !== 'string' ||
          !SHA256_PATTERN.test(survivor.sourceDigest)
        )
      })) {
        errors.push(`${label}.${field} contains an invalid survivor record.`)
      }
      continue
    }
    if (OBJECT_VALUE_FIELDS.has(field)) {
      if (
        (!value || typeof value !== 'object' || Array.isArray(value)) &&
        !(value === null && NULLABLE_OBJECT_VALUE_FIELDS.has(field))
      ) {
        errors.push(`${label}.${field} must be an object${
          NULLABLE_OBJECT_VALUE_FIELDS.has(field) ? ' or null' : ''
        }.`)
      }
      continue
    }
    if (
      UUID_VALUE_FIELDS.has(field) &&
      !(field === 'id' && label.includes('migrationLedger'))
    ) {
      if (value !== null && (typeof value !== 'string' || !UUID_PATTERN.test(value))) {
        errors.push(`${label}.${field} must be a UUID or null.`)
      }
      continue
    }
    if (
      /(?:Sha256|Digest|Fingerprint)$/u.test(field) ||
      field === 'checksum'
    ) {
      if (value !== null && (typeof value !== 'string' || !SHA256_PATTERN.test(value))) {
        errors.push(`${label}.${field} must be a SHA-256 digest or null.`)
      }
      continue
    }
    if (/(?:At)$/u.test(field)) {
      if (
        value !== null &&
        (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
      ) {
        errors.push(`${label}.${field} must be an ISO-compatible timestamp or null.`)
      }
      continue
    }
    if (INTEGER_VALUE_FIELDS.has(field)) {
      if (value !== null && !validIntegerValue(value)) {
        errors.push(`${label}.${field} must be a non-negative integer or null.`)
      }
      continue
    }
    if (/(?:Version)$/u.test(field) || field === 'status') {
      if (field === 'charlotteBindingVersion' && value === null) continue
      if (typeof value !== 'string' || value.length === 0) {
        errors.push(`${label}.${field} must be a non-empty string.`)
      }
      continue
    }
    if (BOOLEAN_VALUE_FIELDS.has(field)) {
      if (typeof value !== 'boolean') {
        errors.push(`${label}.${field} must be a boolean.`)
      }
      continue
    }
    if (value !== null && typeof value === 'object') {
      errors.push(`${label}.${field} has an unsupported structured value.`)
    } else if (value !== null && typeof value !== 'string') {
      errors.push(`${label}.${field} must be a string or null.`)
    }
  }
}

const RETRIEVED_FACT_FIELDS = [
  'citationId',
  'requestedUrl',
  'finalUrl',
  'title',
  'provider',
  'fetchVersion',
  'retrievedAt',
  'httpStatus',
  'contentType',
  'extractor',
  'rawByteLength',
  'rawContentDigest',
  'rawDigestAlgorithm',
  'acceptedCharacterLength',
  'contentDigest',
  'digestAlgorithm',
  'redirectChain',
  'text',
  'truncated',
  'untrusted',
  'contentKind',
] as const

const FETCH_FAILURE_FIELDS = [
  'citationId',
  'requestedUrl',
  'finalUrl',
  'status',
  'failureCode',
  'httpStatus',
  'fetchVersion',
  'extractor',
  'rawByteLength',
  'rawContentDigest',
  'rawDigestAlgorithm',
  'acceptedCharacterLength',
  'truncated',
  'contentDigest',
  'digestAlgorithm',
  'redirectChain',
  'injectionSignalsDetected',
  'retrievedAt',
] as const

function canonicalPublicHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  const normalized = normalizePublicHttpsUrl(value)
  return normalized?.toString() === value ? normalized : null
}

function validPublicHttpsUrl(value: unknown): value is string {
  return canonicalPublicHttpsUrl(value) !== null
}

function validBoundedStringArray(
  value: unknown,
  minimum: number,
  maximum: number,
  pattern?: RegExp,
): value is string[] {
  return Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((item) =>
      typeof item === 'string' && (!pattern || pattern.test(item)))
}

function checkResearchConsentShape(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  const fields = [
    'researchConsentVersion',
    'researchConsentDecision',
    'researchConsentRecordedAt',
  ] as const
  const present = fields.map((field) => Object.hasOwn(record, field))
  if (present.every((value) => !value)) return
  if (present.some((value) => !value)) {
    errors.push(`${label} has an incomplete research-consent provenance tuple.`)
    return
  }
  const version = record.researchConsentVersion
  const decision = record.researchConsentDecision
  const recordedAt = record.researchConsentRecordedAt
  const legacy = version === 'legacy-no-research-consent-v0' &&
    decision === 'no_external_research' && recordedAt === null
  const current = version === 'webchess-research-consent-v1' &&
    ['allow_search_and_page_fetch', 'no_external_research'].includes(
      String(decision),
    ) && typeof recordedAt === 'string' &&
    Number.isFinite(Date.parse(recordedAt))
  if (!legacy && !current) {
    errors.push(`${label} has an invalid research-consent provenance tuple.`)
  }
}

function emptyArrayWhenPresent(
  record: Record<string, unknown>,
  field: string,
): boolean {
  return !Object.hasOwn(record, field) ||
    (Array.isArray(record[field]) && record[field].length === 0)
}

function checkCurrentOptOutShape(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  if (
    record.researchConsentVersion !== 'webchess-research-consent-v1' ||
    record.researchConsentDecision !== 'no_external_research'
  ) return

  const nullWhenPresent = (field: string): boolean =>
    !Object.hasOwn(record, field) || record[field] === null
  const falseWhenPresent = (field: string): boolean =>
    !Object.hasOwn(record, field) || record[field] === false
  if (
    record.status !== 'not_needed' ||
    record.materiality !== null ||
    record.model !== null ||
    record.attemptCount !== 0 ||
    record.omittedSourceCount !== 0 ||
    record.contentDigest !== null ||
    record.failureCode !== null ||
    record.startedAt !== null ||
    typeof record.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.completedAt)) ||
    !nullWhenPresent('query') ||
    !nullWhenPresent('searchSynthesis') ||
    !falseWhenPresent('directPageTextFetched') ||
    !emptyArrayWhenPresent(record, 'executedQueries') ||
    !emptyArrayWhenPresent(record, 'retrievedFacts') ||
    !emptyArrayWhenPresent(record, 'fetchFailures') ||
    !emptyArrayWhenPresent(record, 'injectionSignals')
  ) {
    errors.push(
      `${label} violates the current research opt-out invariants.`,
    )
  }
}

function expectedResearchSourceTrust(
  hostname: string,
): 'government_or_education' | 'general_web' {
  return /(?:\.gov|\.edu)$/u.test(hostname)
    ? 'government_or_education'
    : 'general_web'
}

function checkResearchSourceProvenance(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  const ordinal = record.ordinal
  const hostname = record.hostname
  const hostnameUrl = typeof hostname === 'string'
    ? canonicalPublicHttpsUrl(`https://${hostname}/`)
    : null
  const sourceUrl = Object.hasOwn(record, 'url')
    ? canonicalPublicHttpsUrl(record.url)
    : null
  const titleIsValid = !Object.hasOwn(record, 'title') || (
    typeof record.title === 'string' &&
    record.title.length >= 1 &&
    record.title.length <= 500 &&
    record.title.trim() === record.title
  )
  const urlIsValid = !Object.hasOwn(record, 'url') || (
    sourceUrl !== null && sourceUrl.hostname === hostname
  )
  if (
    !validJsonInteger(ordinal, 1, 8) ||
    record.citationId !== `R${String(ordinal)}` ||
    typeof hostname !== 'string' ||
    hostnameUrl?.hostname !== hostname ||
    record.trust !== (
      typeof hostname === 'string'
        ? expectedResearchSourceTrust(hostname)
        : null
    ) ||
    !['search_activity', 'synthesis_link'].includes(
      String(record.discoveredFrom),
    ) ||
    !titleIsValid ||
    !urlIsValid
  ) {
    errors.push(`${label} violates the canonical research-source provenance contract.`)
  }
}

function checkFetchRoute(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  const chain = record.redirectChain
  const requestedUrl = canonicalPublicHttpsUrl(record.requestedUrl)
  const finalUrl = record.finalUrl === null
    ? null
    : canonicalPublicHttpsUrl(record.finalUrl)
  const canonicalChain = Array.isArray(chain)
    ? chain.map((url) => canonicalPublicHttpsUrl(url))
    : []
  if (
    !requestedUrl ||
    (record.finalUrl !== null && !finalUrl) ||
    !Array.isArray(chain) ||
    chain.length < 1 ||
    chain.length > 4 ||
    canonicalChain.some((url) => url === null) ||
    chain[0] !== record.requestedUrl ||
    chain.at(-1) !== (record.finalUrl ?? record.requestedUrl)
  ) {
    errors.push(`${label} has an invalid direct-page URL or redirect chain.`)
    return
  }
  if (canonicalChain.some((url) => url?.hostname !== requestedUrl.hostname)) {
    errors.push(`${label} contains a cross-host redirect.`)
  }
}

function checkRetrievedFact(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const record = objectAt(value, label)
  exactKeys(record, RETRIEVED_FACT_FIELDS, label)
  checkFetchRoute(record, label, errors)
  if (
    typeof record.citationId !== 'string' ||
    !/^R[1-8]$/u.test(record.citationId) ||
    !validPublicHttpsUrl(record.finalUrl) ||
    typeof record.title !== 'string' ||
    record.title.length < 1 ||
    record.title.length > 500 ||
    record.title.trim() !== record.title ||
    record.provider !== 'webchess-direct-https' ||
    record.fetchVersion !== 'webchess-direct-page-fetch-v1' ||
    record.extractor !== 'webchess-readable-text-v1' ||
    !['application/xhtml+xml', 'text/html', 'text/plain'].includes(
      String(record.contentType),
    ) ||
    record.rawDigestAlgorithm !== 'sha256-raw-response-bytes-v1' ||
    record.digestAlgorithm !== 'sha256-utf8-accepted-text-v1' ||
    record.contentKind !== 'direct_page_text' ||
    record.untrusted !== true ||
    typeof record.truncated !== 'boolean' ||
    typeof record.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.retrievedAt)) ||
    !validJsonInteger(record.httpStatus, 200, 200) ||
    !validJsonInteger(record.rawByteLength, 1, DIRECT_PAGE_MAX_RAW_BYTES) ||
    typeof record.rawContentDigest !== 'string' ||
    !SHA256_PATTERN.test(record.rawContentDigest) ||
    typeof record.text !== 'string' ||
    record.text.length < 1 ||
    record.text.length > DIRECT_PAGE_MAX_ACCEPTED_CHARACTERS ||
    !validJsonInteger(
      record.acceptedCharacterLength,
      1,
      DIRECT_PAGE_MAX_ACCEPTED_CHARACTERS,
    ) ||
    Number(record.acceptedCharacterLength) !== record.text.length ||
    typeof record.contentDigest !== 'string' ||
    record.contentDigest !== sha256Hex(record.text)
  ) {
    errors.push(`${label} has an invalid directly-retrieved fact shape.`)
  }
}

function checkFetchFailure(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const record = objectAt(value, label)
  exactKeys(record, FETCH_FAILURE_FIELDS, label)
  checkFetchRoute(record, label, errors)
  if (
    typeof record.citationId !== 'string' ||
    !/^R[1-8]$/u.test(record.citationId) ||
    !['failed', 'refused', 'timed_out'].includes(String(record.status)) ||
    typeof record.failureCode !== 'string' ||
    !/^[a-z0-9_]{3,80}$/u.test(record.failureCode) ||
    (record.httpStatus !== null && (
      !validJsonInteger(record.httpStatus, 100, 599)
    )) ||
    record.fetchVersion !== 'webchess-direct-page-fetch-v1' ||
    record.extractor !== 'webchess-readable-text-v1' ||
    !validJsonInteger(
      record.rawByteLength,
      0,
      DIRECT_PAGE_FAILURE_MAX_RAW_BYTES,
    ) ||
    (Number(record.rawByteLength) > 0 && (
      typeof record.rawContentDigest !== 'string' ||
      !SHA256_PATTERN.test(record.rawContentDigest)
    )) ||
    (record.rawContentDigest !== null && (
      typeof record.rawContentDigest !== 'string' ||
      !SHA256_PATTERN.test(record.rawContentDigest)
    )) ||
    record.rawDigestAlgorithm !== 'sha256-raw-response-bytes-v1' ||
    record.acceptedCharacterLength !== 0 ||
    typeof record.truncated !== 'boolean' ||
    record.contentDigest !== null ||
    record.digestAlgorithm !== 'sha256-utf8-accepted-text-v1' ||
    !validBoundedStringArray(
      record.injectionSignalsDetected,
      0,
      8,
      /^[a-z0-9_]{3,120}$/u,
    ) ||
    typeof record.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.retrievedAt))
  ) {
    errors.push(`${label} has an invalid direct-page fetch-failure shape.`)
  }
}

function checkResearchEvidenceShape(
  record: Record<string, unknown>,
  label: string,
  errors: string[],
  legacy: boolean,
): void {
  if (!Object.hasOwn(record, 'retrievedFacts') &&
      !Object.hasOwn(record, 'fetchFailures')) return
  const facts = record.retrievedFacts
  const failures = legacy && !Object.hasOwn(record, 'fetchFailures')
    ? []
    : record.fetchFailures
  if (!Array.isArray(facts) || !Array.isArray(failures)) {
    errors.push(`${label} direct-page evidence fields must both be arrays.`)
    return
  }
  if (legacy && facts.length !== 0) {
    errors.push(`${label} legacy retrievedFacts must be empty.`)
  }
  if (facts.length + failures.length > 3) {
    errors.push(`${label} exceeds the combined direct-page evidence limit.`)
  }
  facts.forEach((fact, index) =>
    checkRetrievedFact(fact, `${label}.retrievedFacts[${index}]`, errors))
  failures.forEach((failure, index) =>
    checkFetchFailure(
      failure,
      `${label}.fetchFailures[${index}]`,
      errors,
    ))
  if (record.directPageTextFetched !== (facts.length > 0)) {
    errors.push(`${label}.directPageTextFetched does not match retrievedFacts.`)
  }
  if (
    record.researchConsentDecision === 'no_external_research' &&
    (facts.length > 0 || failures.length > 0)
  ) {
    errors.push(`${label} contains direct-page evidence despite research opt-out.`)
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return hashCanonicalJson(jsonValue(left)) === hashCanonicalJson(jsonValue(right))
}

function eventRevision(value: unknown): number | null {
  if (!validIntegerValue(value)) return null
  const revision = Number(value)
  return revision > 0 ? revision : null
}

function verifyEventProvenance(
  data: Record<string, unknown>,
  profile: WebChessCaseProfile,
  errors: string[],
): void {
  const gameSection = objectAt(data.game, 'data.game')
  const game = objectAt(gameSection.record, 'data.game.record')
  const replay = objectAt(gameSection.replay, 'data.game.replay')
  const rows = arrayAt(replay.events, 'data.game.replay.events', 512)
  const privateKeys = new Set<string>()
  let priorRevision: number | null = null
  let groupClientCount = 0
  let groupFirstSource: unknown = null

  const closeGroup = (revision: number | null): void => {
    if (revision === null) return
    if (groupClientCount !== 1 || groupFirstSource !== 'client') {
      errors.push(
        `Game event revision ${revision} must begin with and contain exactly one client move.`,
      )
    }
  }

  for (const [index, value] of rows.entries()) {
    const row = objectAt(value, `data.game.replay.events[${index}]`)
    const event = objectAt(row.event, `data.game.replay.events[${index}].event`)
    const provenance = objectAt(
      row.provenance,
      `data.game.replay.events[${index}].provenance`,
    )
    const source = provenance.source
    const revision = eventRevision(provenance.gameRevision)
    if (revision === null) {
      errors.push(`data.game.replay.events[${index}].provenance.gameRevision must be a positive integer.`)
      continue
    }
    if (priorRevision === null || revision !== priorRevision) {
      closeGroup(priorRevision)
      if (priorRevision !== null && revision !== priorRevision + 1) {
        errors.push('Game event revision groups must increase contiguously by one.')
      }
      priorRevision = revision
      groupClientCount = 0
      groupFirstSource = source
    }

    const clientMove = source === 'client' && event.type === 'move'
    const serverPass = source === 'server' && event.type === 'forced-pass'
    if (!clientMove && !serverPass) {
      errors.push(`data.game.replay.events[${index}] has an invalid source/type provenance binding.`)
    }
    if (source === 'client') groupClientCount += 1

    if (profile === 'private-full-v1') {
      if (source === 'client') {
        const key = provenance.idempotencyKey
        if (typeof key !== 'string' || !UUID_PATTERN.test(key)) {
          errors.push(`data.game.replay.events[${index}] client provenance requires a UUID idempotency key.`)
        } else if (privateKeys.has(key)) {
          errors.push('Client event idempotency keys must be unique within the bundle.')
        } else {
          privateKeys.add(key)
        }
      } else if (provenance.idempotencyKey !== null) {
        errors.push(`data.game.replay.events[${index}] server provenance must not contain an idempotency key.`)
      }
    }

    if (profile !== 'metadata-only-v1') {
      if (source === 'client' && event.type === 'move') {
        const expectedRequestSha256 = hashCanonicalJson({
          operation: 'game-move/1',
          expectedRevision: revision - 1,
          command: {
            pieceId: jsonValue(event.pieceId),
            to: jsonValue(event.to),
          },
        })
        if (provenance.requestSha256 !== expectedRequestSha256) {
          errors.push(`data.game.replay.events[${index}] client request digest does not bind the canonical move command.`)
        }
      } else if (source === 'server' && provenance.requestSha256 !== null) {
        errors.push(`data.game.replay.events[${index}] server provenance must not contain a request digest.`)
      }
    }
  }
  closeGroup(priorRevision)

  const finalRevision = eventRevision(game.revision)
  if (finalRevision === null) {
    errors.push('data.game.record.revision must be a positive integer for case replay.')
    return
  }
  const status = typeof game.status === 'string' ? game.status : ''
  if (status === 'mapped' && rows.length !== 0) {
    errors.push('A mapped game cannot contain persisted move events.')
  }
  if (priorRevision !== null && priorRevision > finalRevision) {
    errors.push('The final game revision is older than its last event revision.')
  }
  if (
    priorRevision !== null &&
    ['playing', 'completed'].includes(status) &&
    finalRevision !== priorRevision
  ) {
    errors.push(`A ${status} game revision must equal its last event revision.`)
  }
  if (
    priorRevision !== null &&
    ['answering', 'answer_failed', 'answered', 'abandoned'].includes(status) &&
    finalRevision <= priorRevision
  ) {
    errors.push(`A ${status} game revision must follow its last event revision.`)
  }
}

function verifyProfileShape(
  data: Record<string, unknown>,
  profile: WebChessCaseProfile,
  errors: string[],
): boolean {
  const redaction = objectAt(data.redaction, 'data.redaction')
  const currentPolicy = PROFILE_FIELD_POLICIES[profile]
  const legacyPolicy = LEGACY_PROFILE_FIELD_POLICIES[profile]
  const currentAllowlist = sameCanonicalJson(
    redaction.allowlists,
    fieldPolicyJson(currentPolicy),
  )
  const legacyAllowlist = sameCanonicalJson(
    redaction.allowlists,
    fieldPolicyJson(legacyPolicy),
  )
  const legacy = !currentAllowlist && legacyAllowlist
  const policy = legacy ? legacyPolicy : currentPolicy
  if (!currentAllowlist && !legacyAllowlist) {
    errors.push('Declared redaction allowlists do not match the selected profile.')
  }
  const identity = objectAt(data.identity, 'data.identity')
  exactKeys(
    identity,
    [
      'exportedAt',
      'gameId',
      'lifecycleRunId',
      'rootRunId',
      'parentRunId',
      'source',
    ],
    'data.identity',
  )
  if (
    typeof identity.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(identity.exportedAt)) ||
    typeof identity.gameId !== 'string' ||
    !UUID_PATTERN.test(identity.gameId) ||
    typeof identity.lifecycleRunId !== 'string' ||
    !UUID_PATTERN.test(identity.lifecycleRunId) ||
    typeof identity.rootRunId !== 'string' ||
    !UUID_PATTERN.test(identity.rootRunId) ||
    (identity.parentRunId !== null &&
      (typeof identity.parentRunId !== 'string' ||
        !UUID_PATTERN.test(identity.parentRunId)))
  ) {
    errors.push('Case identity timestamps or IDs are invalid.')
  }
  const source = objectAt(identity.source, 'data.identity.source')
  exactKeys(
    source,
    [
      'repository',
      'sourceCommit',
      'sourceCommitAvailability',
      'package',
      'runtimeArtifact',
    ],
    'data.identity.source',
  )
  const sourcePackage = objectAt(source.package, 'data.identity.source.package')
  exactKeys(
    sourcePackage,
    ['name', 'version'],
    'data.identity.source.package',
  )
  if (
    typeof sourcePackage.name !== 'string' ||
    typeof sourcePackage.version !== 'string' ||
    sourcePackage.name.length === 0 ||
    sourcePackage.version.length === 0
  ) {
    errors.push('Source package name and version must be non-empty strings.')
  }
  if (
    source.repository !== 'https://github.com/jr4488/webchess' ||
    (source.sourceCommit !== null &&
      (typeof source.sourceCommit !== 'string' ||
        !COMMIT_PATTERN.test(source.sourceCommit))) ||
    source.sourceCommitAvailability !== (
      source.sourceCommit === null
        ? 'not-configured-at-runtime'
        : 'configured-immutable-commit'
    )
  ) {
    errors.push('Source identity or source-commit availability is invalid.')
  }
  const runtimeArtifact = objectAt(
    source.runtimeArtifact,
    'data.identity.source.runtimeArtifact',
  )
  exactKeys(
    runtimeArtifact,
    ['format', 'sha256', 'availability'],
    'data.identity.source.runtimeArtifact',
  )
  if (
    runtimeArtifact.format !== 'webchess-runtime-payload/1' ||
    (runtimeArtifact.sha256 !== null &&
      (typeof runtimeArtifact.sha256 !== 'string' ||
        !SHA256_PATTERN.test(runtimeArtifact.sha256))) ||
    runtimeArtifact.availability !== (
      runtimeArtifact.sha256 === null
        ? 'not-configured-at-runtime'
        : 'configured-runtime-payload-digest'
    )
  ) {
    errors.push('Runtime artifact identity or availability is invalid.')
  }

  const gameSection = objectAt(data.game, 'data.game')
  exactKeys(
    gameSection,
    ['record', 'terminalSummary', 'replay'],
    'data.game',
  )
  const gameRecord = objectAt(gameSection.record, 'data.game.record')
  exactKeys(
    gameRecord,
    policy.gameRecord,
    'data.game.record',
  )
  checkKnownFieldValueShapes(gameRecord, 'data.game.record', errors)
  checkResearchConsentShape(gameRecord, 'data.game.record', errors)
  if (
    profile === 'private-full-v1' &&
    (
      typeof gameRecord.problem !== 'string' ||
      gameRecord.problemSha256 !== sha256Hex(gameRecord.problem)
    )
  ) {
    errors.push('The private game problem does not match problemSha256.')
  }
  if (gameSection.terminalSummary !== null) {
    exactKeys(
      objectAt(gameSection.terminalSummary, 'data.game.terminalSummary'),
      ['winner', 'reason', 'completedTurn'],
      'data.game.terminalSummary',
    )
  }
  const replay = objectAt(gameSection.replay, 'data.game.replay')
  exactKeys(
    replay,
    [
      'parts',
      'partsMode',
      'originalPartsSha256',
      'events',
      'perPlyProvenanceAvailability',
    ],
    'data.game.replay',
  )
  if (
    typeof replay.originalPartsSha256 !== 'string' ||
    !SHA256_PATTERN.test(replay.originalPartsSha256)
  ) {
    errors.push('The original problem-parts digest is invalid.')
  }
  const parts = arrayAt(replay.parts, 'data.game.replay.parts', 64)
  if (parts.length !== 64) {
    throw new TypeError('Replay must contain exactly 64 problem parts.')
  }
  const exactProblemMapping = profile === 'private-full-v1'
  const expectedPartsMode = exactProblemMapping
    ? 'exact-stored-problem-mapping'
    : 'deterministic-neutral-redaction-substitute'
  if (replay.partsMode !== expectedPartsMode) {
    errors.push('Replay problem-parts mode does not match the selected redaction profile.')
  }
  if (exactProblemMapping) {
    if (hashCanonicalJson(jsonValue(parts)) !== replay.originalPartsSha256) {
      errors.push('Exact replay problem parts do not match their recorded digest.')
    }
  } else if (!sameCanonicalJson(parts, neutralReplayParts())) {
    errors.push('A redacted profile contains non-canonical replay problem parts.')
  }
  const perPlyAvailability = objectAt(
    replay.perPlyProvenanceAvailability,
    'data.game.replay.perPlyProvenanceAvailability',
  )
  exactKeys(
    perPlyAvailability,
    ['source', 'policyVersion', 'engineRequestId', 'fallbackMode', 'note'],
    'data.game.replay.perPlyProvenanceAvailability',
  )
  if (
    perPlyAvailability.source !== 'available-as-events[].provenance.source' ||
    perPlyAvailability.policyVersion !== null ||
    perPlyAvailability.engineRequestId !== null ||
    perPlyAvailability.fallbackMode !== null ||
    perPlyAvailability.note !== PER_PLY_PROVENANCE_NOTE
  ) {
    errors.push('Per-ply provenance availability metadata is invalid.')
  }
  for (const [index, value] of arrayAt(
    replay.events,
    'data.game.replay.events',
    512,
  ).entries()) {
    const row = objectAt(value, `data.game.replay.events[${index}]`)
    exactKeys(row, ['event', 'provenance'], `data.game.replay.events[${index}]`)
    const event = objectAt(
      row.event,
      `data.game.replay.events[${index}].event`,
    )
    if (event.type === 'move') {
      const optional = [
        event.capturedPieceId === undefined ? null : 'capturedPieceId',
        event.promotedTo === undefined ? null : 'promotedTo',
      ].filter((field): field is string => field !== null)
      exactKeys(
        event,
        ['version', 'type', 'ply', 'side', 'pieceId', 'from', 'to', ...optional],
        `data.game.replay.events[${index}].event`,
      )
      exactKeys(
        objectAt(event.from, `data.game.replay.events[${index}].event.from`),
        ['ring', 'sector'],
        `data.game.replay.events[${index}].event.from`,
      )
      exactKeys(
        objectAt(event.to, `data.game.replay.events[${index}].event.to`),
        ['ring', 'sector'],
        `data.game.replay.events[${index}].event.to`,
      )
    } else if (event.type === 'forced-pass') {
      exactKeys(
        event,
        ['version', 'type', 'ply', 'side', 'reason'],
        `data.game.replay.events[${index}].event`,
      )
    } else {
      errors.push(`data.game.replay.events[${index}] has an unsupported event type.`)
    }
    exactKeys(
      objectAt(
        row.provenance,
        `data.game.replay.events[${index}].provenance`,
      ),
      policy.eventProvenance,
      `data.game.replay.events[${index}].provenance`,
    )
    checkKnownFieldValueShapes(
      objectAt(
        row.provenance,
        `data.game.replay.events[${index}].provenance`,
      ),
      `data.game.replay.events[${index}].provenance`,
      errors,
    )
  }

  const lifecycle = objectAt(data.lifecycle, 'data.lifecycle')
  exactKeys(
    lifecycle,
    [
      'run',
      'researchRequests',
      'researchSources',
      'portiaReviews',
      'gateDecisions',
      'charlotteResults',
      'wilburActions',
      'wilburObservations',
      'activities',
      'seedBoundary',
    ],
    'data.lifecycle',
  )
  const lifecycleRun = objectAt(lifecycle.run, 'data.lifecycle.run')
  exactKeys(
    lifecycleRun,
    policy.lifecycleRun,
    'data.lifecycle.run',
  )
  checkKnownFieldValueShapes(lifecycleRun, 'data.lifecycle.run', errors)
  const researchRequests = exactRows(
    lifecycle.researchRequests,
    'data.lifecycle.researchRequests',
    policy.researchRequests,
    512,
    errors,
  )
  for (const [index, request] of researchRequests.entries()) {
    const label = `data.lifecycle.researchRequests[${index}]`
    checkResearchConsentShape(request, label, errors)
    checkCurrentOptOutShape(request, label, errors)
    checkResearchEvidenceShape(request, label, errors, legacy)
    if (
      Object.hasOwn(request, 'researchConsentVersion') &&
      (
        request.researchConsentVersion !== gameRecord.researchConsentVersion ||
        request.researchConsentDecision !== gameRecord.researchConsentDecision ||
        request.researchConsentRecordedAt !== gameRecord.researchConsentRecordedAt
      )
    ) {
      errors.push(`${label} consent provenance does not match the owning game.`)
    }
  }
  exactRows(
    lifecycle.researchSources,
    'data.lifecycle.researchSources',
    policy.researchSources,
    2_048,
    errors,
  )
  exactRows(
    lifecycle.portiaReviews,
    'data.lifecycle.portiaReviews',
    policy.portiaReviews,
    16,
    errors,
  )
  const gateRows = exactRows(
    lifecycle.gateDecisions,
    'data.lifecycle.gateDecisions',
    policy.gateDecisions,
    16,
    errors,
  )
  if (profile === 'private-full-v1') {
    for (const [index, gate] of gateRows.entries()) {
      const prompt = gate.answerUserPrompt
      const digest = gate.answerUserPromptSha256
      if (
        (prompt === null) !== (digest === null) ||
        (typeof prompt === 'string' && digest !== sha256Hex(prompt))
      ) {
        errors.push(`data.lifecycle.gateDecisions[${index}] approved prompt does not match answerUserPromptSha256.`)
      }
    }
  }
  exactRows(
    lifecycle.charlotteResults,
    'data.lifecycle.charlotteResults',
    policy.charlotteResults,
    16,
    errors,
  )
  exactRows(
    lifecycle.wilburActions,
    'data.lifecycle.wilburActions',
    policy.wilburActions,
    500,
    errors,
  )
  exactRows(
    lifecycle.wilburObservations,
    'data.lifecycle.wilburObservations',
    policy.wilburObservations,
    500,
    errors,
  )
  exactRows(
    lifecycle.activities,
    'data.lifecycle.activities',
    policy.lifecycleActivities,
    4_096,
    errors,
  )
  const seedBoundary = objectAt(
    lifecycle.seedBoundary,
    'data.lifecycle.seedBoundary',
  )
  exactKeys(
    seedBoundary,
    ['divisionSeed', 'castSeed', 'trajectorySeed', 'note'],
    'data.lifecycle.seedBoundary',
  )
  if (
    !['divisionSeed', 'castSeed', 'trajectorySeed'].every(
      (field) => typeof seedBoundary[field] === 'string',
    ) || seedBoundary.note !== SEED_BOUNDARY_NOTE
  ) {
    errors.push('Lifecycle seed-boundary fields must be strings.')
  }

  const providerInvocations = objectAt(
    data.providerInvocations,
    'data.providerInvocations',
  )
  exactKeys(
    providerInvocations,
    ['modelRequests', 'boundary'],
    'data.providerInvocations',
  )
  exactRows(
    providerInvocations.modelRequests,
    'data.providerInvocations.modelRequests',
    policy.modelRequests,
    256,
    errors,
  )
  const providerBoundary = objectAt(
    providerInvocations.boundary,
    'data.providerInvocations.boundary',
  )
  exactKeys(
    providerBoundary,
    ['note'],
    'data.providerInvocations.boundary',
  )
  if (providerBoundary.note !== PROVIDER_BOUNDARY_NOTE) {
    errors.push('Provider verification boundary note must be a string.')
  }

  const database = objectAt(data.database, 'data.database')
  exactKeys(
    database,
    ['migrationLedger', 'ledgerBoundary'],
    'data.database',
  )
  if (database.ledgerBoundary !== DATABASE_LEDGER_BOUNDARY) {
    errors.push('Database migration-ledger boundary must be a string.')
  }
  exactRows(
    database.migrationLedger,
    'data.database.migrationLedger',
    ['id', 'checksum', 'appliedAt'],
    256,
    errors,
  )

  exactKeys(
    redaction,
    ['policy', 'profile', 'selection', 'allowlists', 'omissions'],
    'data.redaction',
  )
  const omissionRows = exactRows(
    redaction.omissions,
    'data.redaction.omissions',
    ['path', 'reason', 'omittedCount'],
    64,
    errors,
  )
  const expectedOmissions = omissionDefinitions(profile, legacy)
  if (omissionRows.length !== expectedOmissions.length) {
    errors.push('The omission ledger does not match the selected profile.')
  }
  for (const [index, expected] of expectedOmissions.entries()) {
    const actual = omissionRows[index]
    if (
      !actual ||
      actual.path !== expected.path ||
      actual.reason !== expected.reason ||
      (
        index === 0
          ? actual.omittedCount !== 1
          : index < ALWAYS_OMISSION_DEFINITIONS.length
            ? actual.omittedCount !== null
            : typeof actual.omittedCount !== 'number' ||
              !Number.isSafeInteger(actual.omittedCount) ||
              actual.omittedCount < 0
      )
    ) {
      errors.push(`data.redaction.omissions[${index}] is not the canonical profile omission row.`)
    }
  }

  const verificationBoundary = objectAt(
    data.verificationBoundary,
    'data.verificationBoundary',
  )
  exactKeys(
    verificationBoundary,
    ['canVerifyOffline', 'doesNotVerify', 'importBehavior'],
    'data.verificationBoundary',
  )
  if (!sameCanonicalJson(verificationBoundary, VERIFICATION_BOUNDARY)) {
    errors.push('data.verificationBoundary does not match the canonical format boundary.')
  }
  return legacy
}

function addUniqueId(
  records: readonly unknown[],
  label: string,
  errors: string[],
): Set<string> {
  const ids = new Set<string>()
  for (const [index, value] of records.entries()) {
    const record = objectAt(value, `${label}[${index}]`)
    const id = stringAt(record.id, `${label}[${index}].id`)
    if (!UUID_PATTERN.test(id)) errors.push(`${label}[${index}] has an invalid UUID.`)
    if (ids.has(id)) errors.push(`${label} contains duplicate id ${id}.`)
    ids.add(id)
  }
  return ids
}

function checkLifecycleReferences(
  data: Record<string, unknown>,
  errors: string[],
): void {
  const identity = objectAt(data.identity, 'data.identity')
  const gameSection = objectAt(data.game, 'data.game')
  const game = objectAt(gameSection.record, 'data.game.record')
  const lifecycle = objectAt(data.lifecycle, 'data.lifecycle')
  const run = objectAt(lifecycle.run, 'data.lifecycle.run')
  const gameId = stringAt(identity.gameId, 'data.identity.gameId')
  const lifecycleRunId = stringAt(
    identity.lifecycleRunId,
    'data.identity.lifecycleRunId',
  )
  if (!UUID_PATTERN.test(gameId) || !UUID_PATTERN.test(lifecycleRunId)) {
    errors.push('Identity gameId or lifecycleRunId is not a UUID.')
  }
  if (game.id !== gameId) errors.push('Identity gameId does not match game.record.id.')
  if (run.id !== lifecycleRunId) {
    errors.push('Identity lifecycleRunId does not match lifecycle.run.id.')
  }
  if (run.gameId !== gameId) errors.push('Lifecycle run does not refer to the bundled game.')
  if (run.rootRunId !== identity.rootRunId) {
    errors.push('Identity rootRunId does not match lifecycle.run.rootRunId.')
  }
  if (run.parentRunId !== identity.parentRunId) {
    errors.push('Identity parentRunId does not match lifecycle.run.parentRunId.')
  }
  if (run.parentRunId === null && run.rootRunId !== run.id) {
    errors.push('A root lifecycle run must identify itself as rootRunId.')
  }
  if (
    run.parentRunId !== null &&
    (run.parentRunId === run.id || run.rootRunId === run.id)
  ) {
    errors.push('A retry child run must be distinct from its parent and root run.')
  }

  const modelRequests = arrayAt(
    objectAt(data.providerInvocations, 'data.providerInvocations').modelRequests,
    'modelRequests',
    256,
  )
  const modelIds = addUniqueId(modelRequests, 'modelRequests', errors)
  for (const [index, value] of modelRequests.entries()) {
    if (objectAt(value, `modelRequests[${index}]`).gameId !== gameId) {
      errors.push(`modelRequests[${index}] refers to another game.`)
    }
  }
  for (const sectionName of ['portiaReviews', 'charlotteResults'] as const) {
    const records = arrayAt(lifecycle[sectionName], sectionName, 16)
    addUniqueId(records, sectionName, errors)
    for (const [index, value] of records.entries()) {
      const record = objectAt(value, `${sectionName}[${index}]`)
      if (record.lifecycleRunId !== lifecycleRunId) {
        errors.push(`${sectionName}[${index}] refers to another lifecycle run.`)
      }
      const modelRequestId = stringAt(
        record.modelRequestId,
        `${sectionName}[${index}].modelRequestId`,
      )
      if (!modelIds.has(modelRequestId)) {
        errors.push(`${sectionName}[${index}] refers to a missing model request.`)
      }
    }
  }
  const gateDecisions = arrayAt(lifecycle.gateDecisions, 'gateDecisions', 16)
  addUniqueId(gateDecisions, 'gateDecisions', errors)
  for (const [index, value] of gateDecisions.entries()) {
    if (objectAt(value, `gateDecisions[${index}]`).lifecycleRunId !== lifecycleRunId) {
      errors.push(`gateDecisions[${index}] refers to another lifecycle run.`)
    }
  }

  const researchRequests = arrayAt(
    lifecycle.researchRequests,
    'researchRequests',
    512,
  )
  const researchIds = addUniqueId(researchRequests, 'researchRequests', errors)
  const requestsById = new Map<string, Record<string, unknown>>()
  for (const [index, value] of researchRequests.entries()) {
    const record = objectAt(value, `researchRequests[${index}]`)
    const requestId = stringAt(record.id, `researchRequests[${index}].id`)
    requestsById.set(requestId, record)
    if (record.gameId !== gameId || record.lifecycleRunId !== lifecycleRunId) {
      errors.push(`researchRequests[${index}] has an invalid game or lifecycle link.`)
    }
  }
  const researchSources = arrayAt(
    lifecycle.researchSources,
    'researchSources',
    2_048,
  )
  addUniqueId(researchSources, 'researchSources', errors)
  const sourcesByRequest = new Map<
    string,
    Map<string, Record<string, unknown>>
  >()
  const sourceOrdinalsByRequest = new Map<string, Set<number>>()
  const sourceUrlsByRequest = new Map<string, Set<string>>()
  for (const [index, value] of researchSources.entries()) {
    const label = `researchSources[${index}]`
    const source = objectAt(value, label)
    checkResearchSourceProvenance(source, label, errors)
    const requestId = stringAt(
      source.researchRequestId,
      `${label}.researchRequestId`,
    )
    if (!researchIds.has(requestId)) {
      errors.push(`${label} refers to a missing research request.`)
    }
    const request = requestsById.get(requestId)
    if (
      request?.researchConsentVersion === 'webchess-research-consent-v1' &&
      request.researchConsentDecision === 'no_external_research'
    ) {
      errors.push(`${label} retains source evidence despite current research opt-out.`)
    }
    const citationId = stringAt(
      source.citationId,
      `${label}.citationId`,
    )
    const requestSources = sourcesByRequest.get(requestId) ?? new Map()
    if (requestSources.has(citationId)) {
      errors.push(
        `researchSources contains duplicate citation ${citationId} for request ${requestId}.`,
      )
    }
    requestSources.set(citationId, source)
    sourcesByRequest.set(requestId, requestSources)

    const ordinal = Number(source.ordinal)
    const ordinals = sourceOrdinalsByRequest.get(requestId) ?? new Set<number>()
    if (ordinals.has(ordinal)) {
      errors.push(`researchSources contains duplicate ordinal ${ordinal} for request ${requestId}.`)
    }
    ordinals.add(ordinal)
    sourceOrdinalsByRequest.set(requestId, ordinals)

    if (typeof source.url === 'string') {
      const urls = sourceUrlsByRequest.get(requestId) ?? new Set<string>()
      if (urls.has(source.url)) {
        errors.push(`researchSources contains a duplicate URL for request ${requestId}.`)
      }
      urls.add(source.url)
      sourceUrlsByRequest.set(requestId, urls)
    }
  }
  for (const [requestId, sources] of sourcesByRequest) {
    const request = requestsById.get(requestId)
    const ordinals = sourceOrdinalsByRequest.get(requestId) ?? new Set<number>()
    const expectedOrdinals = Array.from(
      { length: sources.size },
      (_, index) => index + 1,
    )
    if (expectedOrdinals.some((ordinal) => !ordinals.has(ordinal))) {
      errors.push(`researchSources ordinals must be contiguous from 1 for request ${requestId}.`)
    }
    const sourceLimit = Number(request?.sourceLimit)
    if (!Number.isSafeInteger(sourceLimit) || sources.size > sourceLimit) {
      errors.push(`researchSources exceeds the recorded source limit for request ${requestId}.`)
    }
  }
  for (const [requestIndex, value] of researchRequests.entries()) {
    const request = objectAt(value, `researchRequests[${requestIndex}]`)
    const facts = Array.isArray(request.retrievedFacts)
      ? request.retrievedFacts
      : []
    const failures = Array.isArray(request.fetchFailures)
      ? request.fetchFailures
      : []
    if (facts.length === 0 && failures.length === 0) continue
    const requestId = stringAt(
      request.id,
      `researchRequests[${requestIndex}].id`,
    )
    const requestSources = sourcesByRequest.get(requestId)
    const fetchedCitations = new Set<string>()
    for (const [evidenceIndex, evidenceValue] of [
      ...facts,
      ...failures,
    ].entries()) {
      const evidence = objectAt(
        evidenceValue,
        `researchRequests[${requestIndex}].directPageEvidence[${evidenceIndex}]`,
      )
      const citationId = stringAt(
        evidence.citationId,
        `researchRequests[${requestIndex}].directPageEvidence[${evidenceIndex}].citationId`,
      )
      if (fetchedCitations.has(citationId)) {
        errors.push(
          `researchRequests[${requestIndex}] contains duplicate direct-page evidence for ${citationId}.`,
        )
      }
      fetchedCitations.add(citationId)
      const source = requestSources?.get(citationId)
      const requestedUrl = canonicalPublicHttpsUrl(evidence.requestedUrl)
      if (
        !source ||
        source.url !== evidence.requestedUrl ||
        requestedUrl?.hostname !== source.hostname
      ) {
        errors.push(
          `researchRequests[${requestIndex}] direct-page evidence does not match its disclosed source citation and URL.`,
        )
      }
    }
  }

  const actions = arrayAt(lifecycle.wilburActions, 'wilburActions', 500)
  const actionIds = addUniqueId(actions, 'wilburActions', errors)
  for (const [index, value] of actions.entries()) {
    if (objectAt(value, `wilburActions[${index}]`).lifecycleRunId !== lifecycleRunId) {
      errors.push(`wilburActions[${index}] refers to another lifecycle run.`)
    }
  }
  const observations = arrayAt(
    lifecycle.wilburObservations,
    'wilburObservations',
    500,
  )
  addUniqueId(observations, 'wilburObservations', errors)
  for (const [index, value] of observations.entries()) {
    const actionId = stringAt(
      objectAt(value, `wilburObservations[${index}]`).actionId,
      `wilburObservations[${index}].actionId`,
    )
    if (!actionIds.has(actionId)) {
      errors.push(`wilburObservations[${index}] refers to a missing Wilbur action.`)
    }
  }
  const activities = arrayAt(lifecycle.activities, 'activities', 4_096)
  addUniqueId(activities, 'activities', errors)
  if (activities.length === 0) {
    errors.push('Lifecycle activities are missing from the case bundle.')
  }
  let priorStateTo: string | null = null
  for (const [index, value] of activities.entries()) {
    const activity = objectAt(value, `activities[${index}]`)
    if (activity.lifecycleRunId !== lifecycleRunId) {
      errors.push(`activities[${index}] refers to another lifecycle run.`)
    }
    const sequence = Number(activity.sequence)
    if (!Number.isSafeInteger(sequence) || sequence !== index + 1) {
      errors.push('Lifecycle activity sequence must be contiguous from 1.')
      break
    }
    const stateTo = stringAt(activity.stateTo, `activities[${index}].stateTo`)
    const stateFrom = activity.stateFrom
    const retryChildBootstrap =
      index === 0 &&
      stateFrom === null &&
      activity.stage === 'retry' &&
      stateTo === 'chess_ready' &&
      run.parentRunId !== null
    if (
      index === 0 &&
      run.parentRunId === null &&
      (stateFrom !== 'anansi_pending' || stateTo !== 'anansi_running')
    ) {
      errors.push('A root lifecycle activity history has an invalid bootstrap transition.')
    }
    if (!retryChildBootstrap) {
      if (
        typeof stateFrom !== 'string' ||
        !(LIFECYCLE_STATES as readonly string[]).includes(stateFrom) ||
        !(LIFECYCLE_STATES as readonly string[]).includes(stateTo) ||
        !canTransitionLifecycle(
          stateFrom as (typeof LIFECYCLE_STATES)[number],
          stateTo as (typeof LIFECYCLE_STATES)[number],
        )
      ) {
        errors.push(`activities[${index}] contains an invalid lifecycle transition.`)
      }
      if (priorStateTo !== null && stateFrom !== priorStateTo) {
        errors.push(`activities[${index}] breaks lifecycle transition continuity.`)
      }
    }
    if (activity.eventVersion !== CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent) {
      errors.push(`activities[${index}] uses an unsupported lifecycle event version.`)
    }
    priorStateTo = stateTo
  }
  if (priorStateTo !== run.state) {
    errors.push('The final lifecycle activity does not reach lifecycle.run.state.')
  }
}

function checkLifecycleSemantics(
  data: Record<string, unknown>,
  errors: string[],
): void {
  const gameSection = objectAt(data.game, 'data.game')
  const game = objectAt(gameSection.record, 'data.game.record')
  const lifecycle = objectAt(data.lifecycle, 'data.lifecycle')
  const run = objectAt(lifecycle.run, 'data.lifecycle.run')
  const state = stringAt(run.state, 'data.lifecycle.run.state')
  if (!(LIFECYCLE_STATES as readonly string[]).includes(state)) {
    errors.push(`Unsupported lifecycle state: ${state}.`)
  }

  const lifecycleVersionFields = [
    ['softwareVersion', CURRENT_LIFECYCLE_VERSIONS.software],
    ['lifecycleVersion', CURRENT_LIFECYCLE_VERSIONS.lifecycle],
    ['portiaPromptVersion', CURRENT_LIFECYCLE_VERSIONS.portiaPrompt],
    ['portiaContractVersion', CURRENT_LIFECYCLE_VERSIONS.portiaContract],
    ['gateAlgorithmVersion', CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm],
    ['retryPolicyVersion', CURRENT_LIFECYCLE_VERSIONS.retryPolicy],
    ['charlottePromptVersion', CURRENT_LIFECYCLE_VERSIONS.charlottePrompt],
    ['charlotteContractVersion', CURRENT_LIFECYCLE_VERSIONS.charlotteContract],
    ['wilburRecordVersion', CURRENT_LIFECYCLE_VERSIONS.wilburRecord],
  ] as const
  for (const [field, expected] of lifecycleVersionFields) {
    if (run[field] !== expected) {
      errors.push(`Lifecycle ${field} is unsupported by this verifier.`)
    }
  }
  for (const field of [
    'rulesVersion',
    'engineVersion',
    'castVersion',
    'eventVersion',
  ] as const) {
    if (run[field] !== game[field]) {
      errors.push(`Lifecycle ${field} does not match the bundled game.`)
    }
  }

  const modelRequests = arrayAt(
    objectAt(data.providerInvocations, 'data.providerInvocations').modelRequests,
    'modelRequests',
    256,
  ).map((value, index) => objectAt(value, `modelRequests[${index}]`))
  const modelsById = new Map(
    modelRequests.map((request) => [String(request.id), request]),
  )
  const portiaReviews = arrayAt(lifecycle.portiaReviews, 'portiaReviews', 16)
    .map((value, index) => objectAt(value, `portiaReviews[${index}]`))
  const gateDecisions = arrayAt(lifecycle.gateDecisions, 'gateDecisions', 16)
    .map((value, index) => objectAt(value, `gateDecisions[${index}]`))
  const charlotteResults = arrayAt(
    lifecycle.charlotteResults,
    'charlotteResults',
    16,
  ).map((value, index) => objectAt(value, `charlotteResults[${index}]`))

  if (PORTIA_EVIDENCE_STATES.has(state) && portiaReviews.length !== 1) {
    errors.push(`Lifecycle state ${state} requires exactly one Portia review.`)
  }
  if (GATE_EVIDENCE_STATES.has(state) && gateDecisions.length !== 1) {
    errors.push(`Lifecycle state ${state} requires exactly one Gate decision.`)
  }
  if (CHARLOTTE_EVIDENCE_STATES.has(state) && charlotteResults.length !== 1) {
    errors.push(`Lifecycle state ${state} requires exactly one Charlotte result.`)
  }

  for (const [index, review] of portiaReviews.entries()) {
    if (
      review.promptVersion !== run.portiaPromptVersion ||
      review.contractVersion !== run.portiaContractVersion
    ) {
      errors.push(`portiaReviews[${index}] version binding does not match the lifecycle run.`)
    }
    const request = modelsById.get(String(review.modelRequestId))
    if (
      request &&
      (request.operation !== 'portia' ||
        request.status !== 'succeeded' ||
        request.promptVersion !== review.promptVersion ||
        request.requestSha256 !== review.inputDigest ||
        request.responseSha256 !== review.outputDigest)
    ) {
      errors.push(`portiaReviews[${index}] has an invalid model-request binding.`)
    }
  }
  for (const [index, decision] of gateDecisions.entries()) {
    if (decision.algorithmVersion !== run.gateAlgorithmVersion) {
      errors.push(`gateDecisions[${index}] version binding does not match the lifecycle run.`)
    }
  }
  if (gateDecisions.length === 1) {
    const passed = gateDecisions[0]?.passed
    if (GATE_PASSED_STATES.has(state) && passed !== true) {
      errors.push(`Lifecycle state ${state} requires a passing Gate decision.`)
    }
    if (
      ['gate_failed', 'retry_ready', 'retry_running', 'insufficient_basis']
        .includes(state) &&
      passed !== false
    ) {
      errors.push(`Lifecycle state ${state} requires a failing Gate decision.`)
    }
  }
  for (const [index, result] of charlotteResults.entries()) {
    if (
      result.promptVersion !== run.charlottePromptVersion ||
      result.contractVersion !== run.charlotteContractVersion
    ) {
      errors.push(`charlotteResults[${index}] version binding does not match the lifecycle run.`)
    }
    const request = modelsById.get(String(result.modelRequestId))
    if (
      request &&
      (request.operation !== 'charlotte' ||
        request.status !== 'succeeded' ||
        request.promptVersion !== result.promptVersion ||
        request.requestSha256 !== result.inputDigest ||
        request.responseSha256 !== result.outputDigest)
    ) {
      errors.push(`charlotteResults[${index}] has an invalid model-request binding.`)
    }
  }

  for (const [field, operation] of [
    ['portiaActiveModelRequestId', 'portia'],
    ['charlotteActiveModelRequestId', 'charlotte'],
  ] as const) {
    const expectedRunningState = operation === 'portia'
      ? 'portia_running'
      : 'charlotte_running'
    if (state === expectedRunningState && run[field] === null) {
      errors.push(`Lifecycle state ${state} requires ${field}.`)
      continue
    }
    if (state !== expectedRunningState && run[field] !== null) {
      errors.push(`Lifecycle ${field} must be null outside ${expectedRunningState}.`)
      continue
    }
    if (run[field] === null) continue
    const request = modelsById.get(String(run[field]))
    const expectedPrompt = operation === 'portia'
      ? run.portiaPromptVersion
      : run.charlottePromptVersion
    if (
      !request ||
      request.operation !== operation ||
      !['in_progress', 'succeeded'].includes(String(request.status)) ||
      request.promptVersion !== expectedPrompt
    ) {
      errors.push(`Lifecycle ${field} has an invalid model-request binding.`)
    }
  }

  for (const [stage, countField, limitField, unavailableState] of [
    [
      'Portia',
      'portiaFailedAttemptCount',
      'portiaFailureLimit',
      'portia_unavailable',
    ],
    [
      'Charlotte',
      'charlotteFailedAttemptCount',
      'charlotteFailureLimit',
      'charlotte_unavailable',
    ],
  ] as const) {
    const rawCount = run[countField]
    const rawLimit = run[limitField]
    const count = validIntegerValue(rawCount) ? Number(rawCount) : null
    const limit = validIntegerValue(rawLimit) ? Number(rawLimit) : null
    if (
      limit === null ||
      limit < 1 ||
      limit > 10 ||
      count === null ||
      count < 0 ||
      count > limit
    ) {
      errors.push(
        `${stage} failure budget must have a limit from 1 through 10 and a count from 0 through that limit.`,
      )
    } else if (state === unavailableState && count !== limit) {
      errors.push(`${stage} unavailable requires an exactly exhausted failure budget.`)
    }
  }

  if (TERMINAL_EVIDENCE_STATES.has(state) && gameSection.terminalSummary === null) {
    errors.push(`Lifecycle state ${state} requires a terminal game replay.`)
  }
}

function migrationLedger(
  data: Record<string, unknown>,
  errors: string[],
): readonly Record<string, unknown>[] {
  const rows = arrayAt(
    objectAt(data.database, 'data.database').migrationLedger,
    'migrationLedger',
    256,
  ).map((value, index) => objectAt(value, `migrationLedger[${index}]`))
  if (rows.length === 0) {
    errors.push('Migration ledger must contain at least one applied migration.')
  }
  let prior = ''
  for (const [index, row] of rows.entries()) {
    const id = stringAt(row.id, `migrationLedger[${index}].id`)
    const checksum = stringAt(
      row.checksum,
      `migrationLedger[${index}].checksum`,
    )
    if (!MIGRATION_ID_PATTERN.test(id) || !SHA256_PATTERN.test(checksum)) {
      errors.push(`migrationLedger[${index}] has an invalid id or checksum.`)
    }
    if (id <= prior) errors.push('Migration ledger IDs are not strictly increasing.')
    prior = id
  }
  return rows
}

function verifyLocalCompatibility(
  data: Record<string, unknown>,
  migrations: readonly Record<string, unknown>[],
  context: LocalCaseVerificationContext,
  errors: string[],
  warnings: string[],
  verified: string[],
): void {
  const identity = objectAt(data.identity, 'data.identity')
  const source = objectAt(identity.source, 'data.identity.source')
  const bundlePackage = objectAt(source.package, 'data.identity.source.package')
  if (
    bundlePackage.name !== context.packageName ||
    bundlePackage.version !== context.packageVersion
  ) {
    errors.push('The bundle package identity does not match this checkout.')
  } else {
    verified.push('local package identity')
  }

  if (source.sourceCommit === null) {
    warnings.push('The exporter did not have an immutable source commit configured; source-commit equality is unverified.')
  } else if (context.sourceCommit === null) {
    warnings.push('This verifier checkout has no readable Git HEAD; source-commit equality is unverified.')
  } else if (source.sourceCommit !== context.sourceCommit) {
    errors.push('The bundle source commit does not match this checkout.')
  } else if (context.sourceTreeClean === true) {
    verified.push('local immutable source commit in a clean checkout')
  } else {
    warnings.push(
      context.sourceTreeClean === false
        ? 'The bundle commit matches local HEAD, but this checkout is dirty; exact local source equality is unverified.'
        : 'The bundle commit matches local HEAD, but checkout cleanliness was not supplied; exact local source equality is unverified.',
    )
  }

  const runtimeArtifact = objectAt(
    source.runtimeArtifact,
    'data.identity.source.runtimeArtifact',
  )
  if (runtimeArtifact.sha256 === null) {
    warnings.push('The exporter did not have a configured runtime-payload digest; local artifact equality is unverified.')
  } else if (!context.runtimeArtifactSha256) {
    warnings.push('This verifier did not compute a local runtime-payload digest; artifact equality is unverified.')
  } else if (runtimeArtifact.sha256 !== context.runtimeArtifactSha256) {
    errors.push('The bundle runtime-payload digest does not match this checkout.')
  } else {
    verified.push('local runtime-payload digest')
  }

  const migrationErrorCount = errors.length
  const localMigrationIds = Object.keys(context.migrations).sort()
  const bundledMigrationIds = migrations.map((row) => String(row.id))
  if (bundledMigrationIds.length === 0) {
    errors.push('The bundle migration ledger is empty.')
  } else if (bundledMigrationIds.some(
    (id, index) => localMigrationIds[index] !== id,
  )) {
    errors.push('The bundle migration ledger is not an exact prefix of this checkout.')
  }
  for (const row of migrations) {
    const id = String(row.id)
    const checksum = String(row.checksum)
    if (context.migrations[id] !== checksum) {
      errors.push(`Migration ${id} does not match this checkout.`)
    }
  }
  if (migrations.length > 0 && errors.length === migrationErrorCount) {
    verified.push('applied migration checksums against local source')
  }
  const ledgerIds = new Set(migrations.map((row) => String(row.id)))
  const localOnly = Object.keys(context.migrations).filter((id) => !ledgerIds.has(id))
  if (localOnly.length > 0) {
    warnings.push(`This checkout contains ${localOnly.length} migration(s) not recorded in the bundle database ledger.`)
  }
}

export function verifyCaseBundle(
  value: unknown,
  context?: LocalCaseVerificationContext,
): CaseVerificationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const verified: string[] = []
  const notVerified = [
    'Arachne or WebChess efficacy, validity, truthfulness, or research conclusions',
    'provider authentication, account ownership, billing, or live provider behavior',
    'private model reasoning and profile-omitted content',
    'historical seed consumption beyond stored seed identifiers',
    'per-ply policy, engine-request, and fallback provenance absent from the schema',
    'remote publication or availability of the source commit',
    'bundle authorship or authenticity; the recomputable manifest is not a signature',
    'whether every retained allowlisted metadata value is non-sensitive in a particular case',
    'truth of omission counts for content unavailable to the selected profile',
    'retry ancestry before the bundled run without separately exported ancestor records',
    'historical correspondence between failure counts and failed or indeterminate model requests outside this point-in-time bundle',
    'semantic correctness of retained narrative payloads beyond their recorded digest and version bindings',
    DIRECT_PAGE_NETWORK_HISTORY_BOUNDARY,
  ]
  let replay = {
    checked: false,
    exactProblemMapping: false,
    completedPlies: null as number | null,
    terminal: null as boolean | null,
  }

  try {
    boundedJson(value)
    const bundle = objectAt(value, 'bundle')
    exactKeys(bundle, ['format', 'profile', 'manifest', 'data'], 'bundle')
    if (bundle.format !== WEBCHESS_CASE_BUNDLE_FORMAT) {
      throw new TypeError(`Unsupported case bundle format: ${String(bundle.format)}.`)
    }
    if (!isWebChessCaseProfile(bundle.profile)) {
      throw new TypeError(`Unsupported case bundle profile: ${String(bundle.profile)}.`)
    }
    verified.push('supported bundle format and redaction profile')
    if (bundle.profile === 'research-redacted-v1') {
      notVerified.push('per-move idempotency-key uniqueness, because keys are omitted by this profile')
    } else if (bundle.profile === 'metadata-only-v1') {
      notVerified.push('per-move request-digest binding and idempotency-key uniqueness, because both are omitted by this profile')
    }

    const data = objectAt(bundle.data, 'data')
    exactKeys(data, CASE_SECTION_KEYS, 'data')
    const manifest = objectAt(bundle.manifest, 'manifest')
    exactKeys(
      manifest,
      ['algorithm', 'canonicalization', 'entries', 'integrityRoot'],
      'manifest',
    )
    if (
      manifest.algorithm !== 'sha256' ||
      manifest.canonicalization !== WEBCHESS_CASE_CANONICALIZATION
    ) {
      throw new TypeError('The case bundle uses an unsupported integrity algorithm.')
    }
    const manifestErrorCount = errors.length
    const entries = arrayAt(manifest.entries, 'manifest.entries', 16)
    if (entries.length !== CASE_SECTION_KEYS.length) {
      errors.push('Manifest does not contain exactly one digest for every data section.')
    }
    const expectedEntries = CASE_SECTION_KEYS.map((key) => ({
      path: `/data/${key}`,
      sha256: hashCanonicalJson(jsonValue(data[key], `/data/${key}`)),
    }))
    for (const [index, expected] of expectedEntries.entries()) {
      const actual = objectAt(entries[index], `manifest.entries[${index}]`)
      exactKeys(actual, ['path', 'sha256'], `manifest.entries[${index}]`)
      if (actual.path !== expected.path || actual.sha256 !== expected.sha256) {
        errors.push(`Manifest digest mismatch at ${expected.path}.`)
      }
    }
    const expectedRoot = hashCanonicalJson({
      format: WEBCHESS_CASE_BUNDLE_FORMAT,
      profile: bundle.profile,
      algorithm: 'sha256',
      canonicalization: WEBCHESS_CASE_CANONICALIZATION,
      entries: expectedEntries,
    })
    if (manifest.integrityRoot !== expectedRoot) {
      errors.push('Manifest integrity root does not match the canonical section digests.')
    }
    if (errors.length === manifestErrorCount) {
      verified.push('canonical section digests and integrity root')
    }

    const profileErrorCount = errors.length
    const legacyProfile = verifyProfileShape(data, bundle.profile, errors)
    if (legacyProfile) {
      warnings.push(
        'LEGACY PROVENANCE WARNING: this same-format bundle predates current research-consent and direct-page fetch-failure fields.',
      )
      notVerified.push(
        'research-consent provenance and direct-page fetch-failure history omitted by this legacy same-format profile',
      )
    }
    if (errors.length === profileErrorCount) {
      verified.push('profile-specific field allowlists and replay payload shape')
      verified.push('canonical boundary metadata and declared omission ledger')
    }

    const provenanceErrorCount = errors.length
    verifyEventProvenance(data, bundle.profile, errors)
    if (errors.length === provenanceErrorCount) {
      verified.push(
        bundle.profile === 'private-full-v1'
          ? 'event source/type, revision groups, canonical request digests, and unique idempotency keys'
          : bundle.profile === 'research-redacted-v1'
            ? 'event source/type, revision groups, and canonical request digests; idempotency keys omitted'
            : 'event source/type and revision groups; request digests and idempotency keys omitted',
      )
    }

    const referencesErrorCount = errors.length
    checkLifecycleReferences(data, errors)
    if (errors.length === referencesErrorCount) {
      verified.push('internal entity references and lifecycle event sequence')
    }
    const semanticsErrorCount = errors.length
    checkLifecycleSemantics(data, errors)
    if (errors.length === semanticsErrorCount) {
      verified.push('lifecycle state, artifact, model-request, and version bindings')
    }

    const gameSection = objectAt(data.game, 'data.game')
    const game = objectAt(gameSection.record, 'data.game.record')
    if (
      game.rulesVersion !== CURRENT_GAME_VERSIONS.rules ||
      game.castVersion !== CURRENT_GAME_VERSIONS.cast ||
      game.engineVersion !== CURRENT_GAME_VERSIONS.engine ||
      game.eventVersion !== CURRENT_GAME_VERSIONS.event
    ) {
      errors.push('The game uses versions unsupported by this verifier.')
    } else {
      verified.push('game rules, cast, engine, and event version support')
    }

    const replaySection = objectAt(gameSection.replay, 'data.game.replay')
    const eventRows = arrayAt(replaySection.events, 'data.game.replay.events', 512)
    const events = eventRows.map((row, index) =>
      objectAt(row, `data.game.replay.events[${index}]`).event)
    const parts = arrayAt(replaySection.parts, 'data.game.replay.parts', 64)
    if (parts.length !== 64) throw new TypeError('Replay must contain exactly 64 problem parts.')
    const state = replayGameEvents(events, parts as unknown as ProblemPart[])
    const replayErrorCount = errors.length
    replay = {
      checked: true,
      exactProblemMapping: replaySection.partsMode === 'exact-stored-problem-mapping',
      completedPlies: state.completedPlies,
      terminal: state.outcome !== null,
    }
    const gameStatus = stringAt(game.status, 'data.game.record.status')
    if (![
      'mapped',
      'playing',
      'completed',
      'answering',
      'answer_failed',
      'answered',
      'abandoned',
    ].includes(gameStatus)) {
      errors.push(`Unsupported game status: ${gameStatus}.`)
    }
    if (
      state.outcome &&
      ['mapped', 'playing'].includes(gameStatus)
    ) {
      errors.push('A terminal replay has a nonterminal game status.')
    }
    if (
      !state.outcome &&
      ['completed', 'answering', 'answer_failed', 'answered'].includes(gameStatus)
    ) {
      errors.push('A nonterminal replay has a terminal game status.')
    }
    const summary = gameSection.terminalSummary
    if (summary === null && state.outcome !== null) {
      errors.push('A terminal replay is missing its stored terminal summary.')
    } else if (summary !== null) {
      const terminal = objectAt(summary, 'data.game.terminalSummary')
      if (
        !state.outcome ||
        terminal.winner !== state.outcome.winner ||
        terminal.reason !== state.outcome.reason ||
        terminal.completedTurn !== state.outcome.completedTurn
      ) {
        errors.push('Replayed terminal outcome does not match the stored terminal summary.')
      }
    }
    if (
      Object.hasOwn(game, 'outcome') &&
      !sameCanonicalJson(game.outcome, summary)
    ) {
      errors.push('The private game outcome does not match the terminal summary.')
    }
    if (errors.length === replayErrorCount) {
      verified.push(
        state.outcome
          ? 'event-by-event canonical board reconstruction and terminal summary'
          : 'event-by-event canonical board reconstruction; no terminal outcome is present in this point-in-time snapshot',
      )
    }
    if (!replay.exactProblemMapping) {
      warnings.push('Board geometry and event legality were replayed with deterministic neutral problem parts because mapped text was redacted.')
    }

    const migrationShapeErrorCount = errors.length
    const migrations = migrationLedger(data, errors)
    if (errors.length === migrationShapeErrorCount) {
      verified.push('migration ledger shape and ordering')
    }
    if (context) {
      verifyLocalCompatibility(
        data,
        migrations,
        context,
        errors,
        warnings,
        verified,
      )
    } else {
      warnings.push('No local source context was supplied; package, commit, and migration-source compatibility were not checked.')
    }

  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Case verification failed.')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    verified,
    notVerified,
    replay,
  }
}

export function configuredCaseSourceCommit(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const values = [
    environment.WEBCHESS_RELEASE_SHA?.trim(),
    environment.VERCEL_GIT_COMMIT_SHA?.trim(),
  ].filter((value): value is string => Boolean(value))
  if (values.length === 0) return null
  const normalized = values.map((value) => value.toLowerCase())
  if (normalized.some((value) => !COMMIT_PATTERN.test(value))) {
    throw new TypeError('The case exporter source commit is invalid.')
  }
  if (new Set(normalized).size !== 1) {
    throw new TypeError('Configured release commit values do not agree.')
  }
  return normalized[0]
}

export function configuredCaseRuntimeArtifactSha256(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  return normalizedArtifactSha256(
    environment.WEBCHESS_RUNTIME_ARTIFACT_SHA256?.trim() || null,
  )
}

export function caseBundleStatements(
  ownerId: string,
  gameId: string,
): readonly SqlStatement[] {
  const values = [ownerId, gameId] as const
  return [
    {
      text: `
        SELECT id::text, source_game_id::text AS "sourceGameId",
          revision::text, status, problem, problem_sha256 AS "problemSha256",
          division_seed AS "divisionSeed", division_facets AS "divisionFacets",
          problem_parts AS "problemParts", division_model AS "divisionModel",
          division_prompt_version AS "divisionPromptVersion",
          division_prompt_sha256 AS "divisionPromptSha256",
          division_digest AS "divisionDigest", rules_version AS "rulesVersion",
          engine_version AS "engineVersion", cast_version AS "castVersion",
          event_version AS "eventVersion", software_version AS "softwareVersion",
          research_consent_version AS "researchConsentVersion",
          research_consent_decision AS "researchConsentDecision",
          research_consent_recorded_at AS "researchConsentRecordedAt",
          outcome, answer_payload AS answer, created_at AS "createdAt",
          updated_at AS "updatedAt", completed_at AS "completedAt",
          answered_at AS "answeredAt"
        FROM games
        WHERE clerk_user_id = $1::text AND id = $2::uuid
      `,
      values,
    },
    {
      text: `
        SELECT events.game_id::text AS "gameId", events.ply, events.kind,
          events.source, events.side, events.piece_id AS "pieceId",
          events.captured_piece_id AS "capturedPieceId",
          events.promoted_to AS "promotedTo", events.from_ring AS "fromRing",
          events.from_sector AS "fromSector", events.to_ring AS "toRing",
          events.to_sector AS "toSector",
          events.idempotency_key::text AS "idempotencyKey",
          events.request_sha256 AS "requestSha256",
          events.game_revision::text AS "gameRevision",
          events.created_at AS "createdAt"
        FROM game_events AS events
        JOIN games ON games.id = events.game_id
        WHERE games.clerk_user_id = $1::text AND games.id = $2::uuid
        ORDER BY events.ply
      `,
      values,
    },
    {
      text: `
        SELECT id::text, game_id::text AS "gameId", root_run_id::text AS "rootRunId",
          parent_run_id::text AS "parentRunId", state, revision::text,
          field_generation AS "fieldGeneration", game_attempt AS "gameAttempt",
          same_field_retry_count AS "sameFieldRetryCount",
          field_regeneration_count AS "fieldRegenerationCount",
          division_seed AS "divisionSeed", cast_seed AS "castSeed",
          trajectory_seed AS "trajectorySeed", retry_reason AS "retryReason",
          terminal_fingerprint AS "terminalFingerprint",
          answer_prompt_digest AS "answerPromptDigest",
          survivor_set AS survivors,
          portia_current_candidate_id AS "portiaCurrentCandidateId",
          portia_active_model_request_id::text AS "portiaActiveModelRequestId",
          portia_failed_attempt_count AS "portiaFailedAttemptCount",
          portia_failure_limit AS "portiaFailureLimit",
          portia_completed_candidate_ids AS "portiaCompletedCandidateIds",
          portia_assessment_drafts AS "portiaAssessmentDrafts",
          charlotte_active_model_request_id::text AS "charlotteActiveModelRequestId",
          charlotte_failed_attempt_count AS "charlotteFailedAttemptCount",
          charlotte_failure_limit AS "charlotteFailureLimit",
          software_version AS "softwareVersion",
          lifecycle_version AS "lifecycleVersion", rules_version AS "rulesVersion",
          engine_version AS "engineVersion", cast_version AS "castVersion",
          event_version AS "eventVersion", portia_prompt_version AS "portiaPromptVersion",
          portia_contract_version AS "portiaContractVersion",
          gate_algorithm_version AS "gateAlgorithmVersion",
          retry_policy_version AS "retryPolicyVersion",
          charlotte_prompt_version AS "charlottePromptVersion",
          charlotte_contract_version AS "charlotteContractVersion",
          wilbur_record_version AS "wilburRecordVersion",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM lifecycle_runs
        WHERE clerk_user_id = $1::text AND game_id = $2::uuid
      `,
      values,
    },
    {
      text: `
        SELECT id::text, game_id::text AS "gameId",
          lifecycle_run_id::text AS "lifecycleRunId", stage,
          requested_by AS "requestedBy", policy_version AS "policyVersion",
          research_consent_version AS "researchConsentVersion",
          research_consent_decision AS "researchConsentDecision",
          research_consent_recorded_at AS "researchConsentRecordedAt",
          materiality, reason, query, status, provider, transport, model,
          invocation_limit AS "invocationLimit", result_limit AS "resultLimit",
          source_limit AS "sourceLimit", timeout_ms AS "timeoutMs",
          synthesis_character_limit AS "synthesisCharacterLimit",
          attempt_count AS "attemptCount", executed_queries AS "executedQueries",
          search_synthesis AS "searchSynthesis",
          direct_page_text_fetched AS "directPageTextFetched",
          retrieved_facts AS "retrievedFacts",
          fetch_failures AS "fetchFailures",
          omitted_source_count AS "omittedSourceCount",
          injection_signals AS "injectionSignals", content_digest AS "contentDigest",
          failure_code AS "failureCode", started_at AS "startedAt",
          completed_at AS "completedAt", created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM research_requests
        WHERE clerk_user_id = $1::text AND game_id = $2::uuid
        ORDER BY created_at, id
      `,
      values,
    },
    {
      text: `
        SELECT sources.id::text, sources.research_request_id::text AS "researchRequestId",
          sources.ordinal, sources.citation_id AS "citationId", sources.title,
          sources.url, sources.hostname, sources.trust,
          sources.discovered_from AS "discoveredFrom", sources.created_at AS "createdAt"
        FROM research_sources AS sources
        JOIN research_requests AS requests ON requests.id = sources.research_request_id
        WHERE sources.clerk_user_id = $1::text AND requests.game_id = $2::uuid
        ORDER BY sources.research_request_id, sources.ordinal
      `,
      values,
    },
    {
      text: `
        SELECT reviews.id::text, reviews.lifecycle_run_id::text AS "lifecycleRunId",
          reviews.model_request_id::text AS "modelRequestId",
          reviews.input_digest AS "inputDigest", reviews.output_digest AS "outputDigest",
          reviews.prompt_version AS "promptVersion",
          reviews.contract_version AS "contractVersion", reviews.review,
          reviews.created_at AS "createdAt"
        FROM portia_reviews AS reviews
        JOIN lifecycle_runs AS runs ON runs.id = reviews.lifecycle_run_id
        WHERE reviews.clerk_user_id = $1::text AND runs.game_id = $2::uuid
      `,
      values,
    },
    {
      text: `
        SELECT decisions.id::text, decisions.lifecycle_run_id::text AS "lifecycleRunId",
          decisions.algorithm_version AS "algorithmVersion",
          decisions.input_digest AS "inputDigest", decisions.passed, decisions.result,
          decisions.answer_user_prompt AS "answerUserPrompt",
          decisions.answer_user_prompt_sha256 AS "answerUserPromptSha256",
          decisions.created_at AS "createdAt"
        FROM gate_decisions AS decisions
        JOIN lifecycle_runs AS runs ON runs.id = decisions.lifecycle_run_id
        WHERE decisions.clerk_user_id = $1::text AND runs.game_id = $2::uuid
      `,
      values,
    },
    {
      text: `
        SELECT results.id::text, results.lifecycle_run_id::text AS "lifecycleRunId",
          results.model_request_id::text AS "modelRequestId",
          results.input_digest AS "inputDigest", results.output_digest AS "outputDigest",
          results.prompt_version AS "promptVersion",
          results.contract_version AS "contractVersion", results.result,
          results.rendered_answer AS "renderedAnswer", results.created_at AS "createdAt"
        FROM charlotte_results AS results
        JOIN lifecycle_runs AS runs ON runs.id = results.lifecycle_run_id
        WHERE results.clerk_user_id = $1::text AND runs.game_id = $2::uuid
      `,
      values,
    },
    {
      text: `
        SELECT actions.id::text, actions.lifecycle_run_id::text AS "lifecycleRunId",
          actions.charlotte_action_index AS "charlotteActionIndex",
          actions.charlotte_binding_version AS "charlotteBindingVersion",
          actions.request_digest AS "requestDigest", actions.actor, actions.action,
          actions.tested_assumption AS "testedAssumption",
          actions.expected_observation AS "expectedObservation",
          actions.decision_threshold AS "decisionThreshold",
          actions.review_horizon AS "reviewHorizon", actions.status,
          actions.revision::text, actions.record_version AS "recordVersion",
          actions.created_at AS "createdAt", actions.updated_at AS "updatedAt"
        FROM wilbur_actions AS actions
        JOIN lifecycle_runs AS runs ON runs.id = actions.lifecycle_run_id
        WHERE actions.clerk_user_id = $1::text AND runs.game_id = $2::uuid
        ORDER BY actions.created_at, actions.id
      `,
      values,
    },
    {
      text: `
        SELECT observations.id::text, observations.action_id::text AS "actionId",
          observations.request_digest AS "requestDigest",
          observations.observed_at AS "observedAt", observations.observation,
          observations.evidence_classification AS "evidenceClassification",
          observations.expected_effect AS "expectedEffect",
          observations.unexpected_effect AS "unexpectedEffect",
          observations.stakeholder_response AS "stakeholderResponse",
          observations.assumption_result AS "assumptionResult",
          observations.next_decision AS "nextDecision",
          observations.record_version AS "recordVersion",
          observations.created_at AS "createdAt"
        FROM wilbur_observations AS observations
        JOIN wilbur_actions AS actions ON actions.id = observations.action_id
        JOIN lifecycle_runs AS runs ON runs.id = actions.lifecycle_run_id
        WHERE observations.clerk_user_id = $1::text AND runs.game_id = $2::uuid
        ORDER BY observations.observed_at, observations.created_at, observations.id
      `,
      values,
    },
    {
      text: `
        SELECT events.id::text, events.lifecycle_run_id::text AS "lifecycleRunId",
          events.sequence::text, events.stage,
          events.activity_type AS "activityType", events.state_from AS "stateFrom",
          events.state_to AS "stateTo", events.input_entity_ids AS "inputEntityIds",
          events.output_entity_ids AS "outputEntityIds",
          events.responsible_agent_ids AS "responsibleAgentIds",
          events.configuration_digest AS "configurationDigest", events.status,
          events.event_version AS "eventVersion", events.created_at AS "createdAt"
        FROM lifecycle_events AS events
        JOIN lifecycle_runs AS runs ON runs.id = events.lifecycle_run_id
        WHERE events.clerk_user_id = $1::text AND runs.game_id = $2::uuid
        ORDER BY events.sequence
      `,
      values,
    },
    {
      text: `
        SELECT requests.id::text, requests.game_id::text AS "gameId",
          requests.operation, requests.idempotency_key::text AS "idempotencyKey",
          requests.request_sha256 AS "requestSha256", requests.status,
          requests.attempt, requests.provider, requests.model,
          requests.prompt_version AS "promptVersion",
          requests.software_version AS "softwareVersion",
          requests.provider_response_id AS "providerResponseId",
          requests.response_sha256 AS "responseSha256",
          requests.result_payload AS "resultPayload",
          requests.usage_reported AS "usageReported",
          requests.input_tokens::text AS "inputTokens",
          requests.cached_input_tokens::text AS "cachedInputTokens",
          requests.cache_write_input_tokens::text AS "cacheWriteInputTokens",
          requests.output_tokens::text AS "outputTokens",
          requests.reasoning_tokens::text AS "reasoningTokens",
          requests.total_tokens::text AS "totalTokens",
          requests.provider_started_at AS "providerStartedAt",
          requests.completed_at AS "completedAt",
          requests.failure_code AS "failureCode",
          requests.provider_http_status AS "providerHttpStatus",
          requests.created_at AS "createdAt", requests.updated_at AS "updatedAt"
        FROM model_requests AS requests
        WHERE requests.clerk_user_id = $1::text
          AND (
            requests.game_id = $2::uuid
            OR requests.id IN (
              SELECT reviews.model_request_id FROM portia_reviews AS reviews
              JOIN lifecycle_runs AS runs ON runs.id = reviews.lifecycle_run_id
              WHERE runs.game_id = $2::uuid AND runs.clerk_user_id = $1::text
              UNION
              SELECT results.model_request_id FROM charlotte_results AS results
              JOIN lifecycle_runs AS runs ON runs.id = results.lifecycle_run_id
              WHERE runs.game_id = $2::uuid AND runs.clerk_user_id = $1::text
            )
          )
        ORDER BY requests.created_at, requests.id
      `,
      values,
    },
    {
      text: `
        SELECT id, checksum::text, applied_at AS "appliedAt"
        FROM webchess_schema_migrations
        ORDER BY id
      `,
    },
  ]
}

export function caseBundleRows(
  results: readonly { readonly rows: readonly SqlRow[] }[],
): CaseBundleSourceRows {
  const game = results[0]?.rows[0]
  if (!game) throw new Error('CASE_GAME_NOT_FOUND')
  const lifecycleRun = results[2]?.rows[0]
  if (!lifecycleRun) throw new Error('CASE_LIFECYCLE_NOT_FOUND')
  return {
    game,
    events: results[1]?.rows ?? [],
    lifecycleRun,
    researchRequests: results[3]?.rows ?? [],
    researchSources: results[4]?.rows ?? [],
    portiaReviews: results[5]?.rows ?? [],
    gateDecisions: results[6]?.rows ?? [],
    charlotteResults: results[7]?.rows ?? [],
    wilburActions: results[8]?.rows ?? [],
    wilburObservations: results[9]?.rows ?? [],
    lifecycleActivities: results[10]?.rows ?? [],
    modelRequests: results[11]?.rows ?? [],
    migrations: results[12]?.rows ?? [],
  }
}

export const supportedCaseProfiles = WEBCHESS_CASE_PROFILES

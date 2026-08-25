import type {
  CellCoord,
  GameOutcome,
  Piece,
  PieceKind,
  ProblemFacet,
  ProblemPart,
  Side,
} from '../../types'
import {
  composeProblemParts,
  deriveDivisionCastAssignments,
  DIVISION_CAST_APPLICATION_MAX_CHARS,
  DIVISION_CAST_APPLICATION_MIN_CHARS,
  DIVISION_CAST_BINDING_VERSION,
  divisionSeed,
} from '../division'
import type { DivisionCastAssignment } from '../division'
import type { GameEvent, GameVersions } from '../game-contract'
import { replayGameEvents } from '../game-replay'
import { createInitialPieces, PIECE_VALUES } from '../game'
import { sha256Utf8Hex, utf8ByteLength } from '../browser-sha256'

export const DIRECTIONAL_RECORD_VERSION =
  'webchess-directional-record-v1' as const

export const DIRECTIONAL_RECORD_SELECTION_COUNT = 8 as const

export const DIRECTIONAL_PROMPT_PROJECTION_VERSION =
  'webchess-directional-prompt-projection-v1' as const

export const MAX_DIRECTIONAL_RECORD_CANONICAL_BYTES = 4_000_000 as const

/**
 * Versioned terminal-state influence. These are bounded method weights, not
 * empirical probabilities or claims about the outcome's real-world meaning.
 */
export const DIRECTIONAL_OUTCOME_WEIGHTS = Object.freeze({
  reason: Object.freeze({
    'king-captured': 4,
    'no-moves': 3,
    'no-progress': 2,
    'move-limit': 1,
  }),
  winningSide: 3,
  drawnSide: 2,
  losingSide: 1,
})

export const DIRECTIONAL_EPISTEMIC_BOUNDARY = Object.freeze({
  classification: 'directional-input-not-factual-evidence' as const,
  statement:
    'This replay-derived I Ching record is a required directional input: it changes which cast-qualified lenses receive scrutiny and how their trajectory is explained. It is not external factual evidence and cannot override verified facts, consent, safety constraints, or the deterministic Gate.',
})

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson }

export interface DirectionalRecordInput {
  /** Immutable digest of the complete persisted Division package. */
  readonly divisionDigest: string
  /** Seed used by composeProblemParts for all three independent shuffles. */
  readonly divisionSeed: string | number
  /** Lifecycle cast seed retained as provenance; it is not treated as evidence. */
  readonly castSeed: string
  /** Durable game-trajectory seed retained as replay provenance. */
  readonly trajectorySeed: string
  /** Persisted source versions; v1 refuses to relabel an older game as current. */
  readonly versions: Readonly<GameVersions>
  readonly parts: readonly ProblemPart[]
  readonly events: readonly unknown[]
}

export interface DirectionalRecordExpectedSource {
  readonly divisionDigest: string
  readonly divisionSeed: string | number
  readonly castSeed: string
  readonly trajectorySeed: string
  readonly versions: Readonly<GameVersions>
}

export interface DirectionalFieldPart {
  readonly coordinate: CellCoord
  readonly part: ProblemPart
  /** Trusted pre-provider assignment that directed this exact facet ID. */
  readonly castAssignment: DivisionCastAssignment
}

export interface DirectionalLensReference {
  readonly key: string
  readonly coordinate: CellCoord
  readonly partId: number
  readonly hexagram: number
  readonly hexagramName: string
  readonly theme: string
  readonly dimension: string
  readonly movement: string
  readonly title: string
  readonly focus: string
  readonly prompt: string
  readonly keyword: string
  readonly directionalCue: string
  readonly castApplication: string
}

export interface DirectionalPieceReference {
  readonly pieceId: string
  readonly side: Side
  readonly originalKind: PieceKind
  readonly kind: PieceKind
  readonly originalValue: number
  readonly value: number
}

export interface DirectionalMoveFactor {
  readonly type: 'move'
  readonly ply: number
  readonly side: Side
  readonly event: Extract<GameEvent, { type: 'move' }>
  readonly mover: DirectionalPieceReference
  readonly departure: DirectionalLensReference
  readonly arrival: DirectionalLensReference
  readonly captureId: string | null
  readonly promotedTo: 'queen' | null
}

export interface DirectionalPassConstraint {
  readonly piece: DirectionalPieceReference
  readonly lens: DirectionalLensReference
}

export interface DirectionalForcedPassFactor {
  readonly type: 'forced-pass'
  readonly ply: number
  readonly side: Side
  readonly event: Extract<GameEvent, { type: 'forced-pass' }>
  /** Every piece constrained on the side that canonically had no legal move. */
  readonly constrainedPieces: readonly DirectionalPassConstraint[]
}

export type DirectionalEventFactor =
  | DirectionalMoveFactor
  | DirectionalForcedPassFactor

export interface DirectionalCaptureFactor {
  readonly sequence: number
  readonly captureId: string
  readonly ply: number
  readonly attacker: DirectionalPieceReference
  readonly captured: DirectionalPieceReference
  readonly cell: CellCoord
  readonly lens: DirectionalLensReference
  readonly capturedMaterialValue: number
  readonly attackerMaterialValue: number
  readonly resonance: number
}

export interface DirectionalSurvivorFactor {
  readonly piece: DirectionalPieceReference
  readonly finalCoordinate: CellCoord
  readonly finalLens: DirectionalLensReference
  readonly route: readonly {
    readonly ply: number
    readonly from: CellCoord
    readonly fromPartId: number
    readonly to: CellCoord
    readonly toPartId: number
    readonly capturedPieceId: string | null
    readonly promotedTo: 'queen' | null
  }[]
  readonly captureIds: readonly string[]
  readonly moveCount: number
  readonly promoted: boolean
}

export interface DirectionalOutcome {
  readonly winner: Side | null
  readonly reason: GameOutcome['reason']
  readonly completedTurn: number
  readonly terminalCaptureId: string | null
}

export interface DirectionalContributions {
  readonly departureVisits: number
  readonly departureMaterial: number
  readonly arrivalVisits: number
  readonly arrivalMaterial: number
  readonly chronology: number
  readonly captureCount: number
  readonly capturedMaterial: number
  readonly attackerMaterial: number
  readonly captureResonance: number
  readonly captureOrder: number
  readonly forcedPassConstraints: number
  readonly forcedPassMaterial: number
  readonly survivorCount: number
  readonly survivorMaterial: number
  readonly survivorMoveCount: number
  readonly winningSurvivorMaterial: number
  readonly terminalOutcomeWeight: number
  readonly terminalCapture: number
}

export interface DirectionalSignal {
  readonly rank: number
  readonly lens: DirectionalLensReference
  readonly score: number
  readonly contributions: DirectionalContributions
  readonly supportingPlies: readonly number[]
  readonly captureIds: readonly string[]
  readonly survivorPieceIds: readonly string[]
  readonly explanation: string
}

export interface TrajectoryDirectionalRecord {
  readonly version: typeof DIRECTIONAL_RECORD_VERSION
  readonly digest: string
  readonly division: {
    readonly digest: string
    readonly seed: string | number
  }
  readonly cast: {
    readonly version: string
    readonly assignmentVersion: typeof DIVISION_CAST_BINDING_VERSION
    readonly lifecycleSeed: string
    readonly assignmentsDigest: string
    readonly shuffleSeeds: {
      readonly facets: string
      readonly hexagrams: string
      readonly board: string
    }
  }
  readonly field: {
    readonly partsDigest: string
    readonly parts: readonly DirectionalFieldPart[]
  }
  readonly trajectory: {
    readonly seed: string
    readonly eventVersion: number
    readonly rulesVersion: string
    readonly engineVersion: string
    readonly eventStreamDigest: string
    readonly factorDigest: string
    readonly completedPlies: number
    readonly moveCount: number
    readonly forcedPassCount: number
    readonly promotionCount: number
    readonly events: readonly DirectionalEventFactor[]
  }
  readonly captures: readonly DirectionalCaptureFactor[]
  readonly survivors: readonly DirectionalSurvivorFactor[]
  readonly outcome: DirectionalOutcome
  /** All 64 cast-qualified directions, ranked by the versioned score. */
  readonly directions: readonly DirectionalSignal[]
  /** Stable keys for the eight directions that continue into scrutiny. */
  readonly survivingDirectionKeys: readonly string[]
  readonly explanation: readonly string[]
  readonly epistemicBoundary: typeof DIRECTIONAL_EPISTEMIC_BOUNDARY
}

/**
 * Bounded provider-facing projection of the complete durable directional
 * record. The record digest continues to bind the full field and replay while
 * the model receives only the eight directions selected by the versioned
 * calculation, their complete scoring/support factors, and the human-readable
 * explanation needed to apply them.
 */
export interface TrajectoryDirectionalPromptProjection {
  readonly projection_version: typeof DIRECTIONAL_PROMPT_PROJECTION_VERSION
  readonly record_version: typeof DIRECTIONAL_RECORD_VERSION
  readonly record_digest: string
  readonly source_digests: {
    readonly division: string
    readonly cast_assignments: string
    readonly field_parts: string
    readonly event_stream: string
    readonly trajectory_factors: string
  }
  readonly trajectory_summary: {
    readonly completed_plies: number
    readonly move_count: number
    readonly forced_pass_count: number
    readonly promotion_count: number
    readonly outcome: DirectionalOutcome
  }
  readonly surviving_direction_keys: readonly string[]
  readonly surviving_directions: readonly DirectionalSignal[]
  readonly supporting_captures: readonly DirectionalCaptureFactor[]
  readonly supporting_survivors: readonly DirectionalSurvivorFactor[]
  readonly human_explanation: readonly string[]
  readonly epistemic_boundary: typeof DIRECTIONAL_EPISTEMIC_BOUNDARY
}

function copyDirectionalLens(
  lens: DirectionalLensReference,
): DirectionalLensReference {
  return {
    ...lens,
    coordinate: { ...lens.coordinate },
  }
}

function copyDirectionalPiece(
  piece: DirectionalPieceReference,
): DirectionalPieceReference {
  return { ...piece }
}

function copyDirectionalSignal(signal: DirectionalSignal): DirectionalSignal {
  return {
    rank: signal.rank,
    lens: copyDirectionalLens(signal.lens),
    score: signal.score,
    contributions: { ...signal.contributions },
    supportingPlies: [...signal.supportingPlies],
    captureIds: [...signal.captureIds],
    survivorPieceIds: [...signal.survivorPieceIds],
    explanation: signal.explanation,
  }
}

function copyDirectionalCapture(
  capture: DirectionalCaptureFactor,
): DirectionalCaptureFactor {
  return {
    sequence: capture.sequence,
    captureId: capture.captureId,
    ply: capture.ply,
    attacker: copyDirectionalPiece(capture.attacker),
    captured: copyDirectionalPiece(capture.captured),
    cell: { ...capture.cell },
    lens: copyDirectionalLens(capture.lens),
    capturedMaterialValue: capture.capturedMaterialValue,
    attackerMaterialValue: capture.attackerMaterialValue,
    resonance: capture.resonance,
  }
}

function copyDirectionalSurvivor(
  survivor: DirectionalSurvivorFactor,
): DirectionalSurvivorFactor {
  return {
    piece: copyDirectionalPiece(survivor.piece),
    finalCoordinate: { ...survivor.finalCoordinate },
    finalLens: copyDirectionalLens(survivor.finalLens),
    route: survivor.route.map((move) => ({
      ...move,
      from: { ...move.from },
      to: { ...move.to },
    })),
    captureIds: [...survivor.captureIds],
    moveCount: survivor.moveCount,
    promoted: survivor.promoted,
  }
}

/** Build deterministic prompt bytes without copying the full replay record. */
export function buildTrajectoryDirectionalPromptProjection(
  record: TrajectoryDirectionalRecord,
): TrajectoryDirectionalPromptProjection {
  if (
    record.survivingDirectionKeys.length !==
      DIRECTIONAL_RECORD_SELECTION_COUNT ||
    new Set(record.survivingDirectionKeys).size !==
      DIRECTIONAL_RECORD_SELECTION_COUNT
  ) {
    throw new DirectionalRecordVerificationError(
      'Directional prompt projection requires eight unique surviving directions.',
    )
  }

  const directionByKey = new Map(
    record.directions.map((direction) => [direction.lens.key, direction]),
  )
  if (directionByKey.size !== record.directions.length) {
    throw new DirectionalRecordVerificationError(
      'Directional prompt projection requires unique ranked direction keys.',
    )
  }
  const survivingDirections = record.survivingDirectionKeys.map(
    (key, index) => {
      const direction = directionByKey.get(key)
      if (!direction || direction.rank !== index + 1) {
        throw new DirectionalRecordVerificationError(
          'Directional prompt projection does not match the ranked record.',
        )
      }
      return copyDirectionalSignal(direction)
    },
  )
  for (const direction of survivingDirections) {
    if (
      new Set(direction.captureIds).size !== direction.captureIds.length ||
      new Set(direction.survivorPieceIds).size !==
        direction.survivorPieceIds.length
    ) {
      throw new DirectionalRecordVerificationError(
        'Directional prompt projection requires unique signal support IDs.',
      )
    }
  }

  const survivorById = new Map(
    record.survivors.map((survivor) => [survivor.piece.pieceId, survivor]),
  )
  if (survivorById.size !== record.survivors.length) {
    throw new DirectionalRecordVerificationError(
      'Directional prompt projection requires unique survivor referents.',
    )
  }
  const supportingSurvivorIds = new Set(
    survivingDirections.flatMap((direction) => direction.survivorPieceIds),
  )
  const supportingSurvivors = [...supportingSurvivorIds]
    .sort(compareCodeUnits)
    .map((pieceId) => {
      const survivor = survivorById.get(pieceId)
      if (!survivor) {
        throw new DirectionalRecordVerificationError(
          `Directional prompt projection is missing survivor referent ${pieceId}.`,
        )
      }
      return copyDirectionalSurvivor(survivor)
    })

  const captureById = new Map(
    record.captures.map((capture) => [capture.captureId, capture]),
  )
  const captureSequences = new Set(
    record.captures.map((capture) => capture.sequence),
  )
  if (
    captureById.size !== record.captures.length ||
    captureSequences.size !== record.captures.length
  ) {
    throw new DirectionalRecordVerificationError(
      'Directional prompt projection requires unique capture referents.',
    )
  }
  const supportingCaptureIds = new Set([
    ...survivingDirections.flatMap((direction) => direction.captureIds),
    ...supportingSurvivors.flatMap((survivor) => survivor.captureIds),
  ])
  const supportingCaptures = [...supportingCaptureIds]
    .map((captureId) => {
      const capture = captureById.get(captureId)
      if (!capture) {
        throw new DirectionalRecordVerificationError(
          `Directional prompt projection is missing capture referent ${captureId}.`,
        )
      }
      return capture
    })
    .sort((left, right) => left.sequence - right.sequence)
    .map(copyDirectionalCapture)

  return {
    projection_version: DIRECTIONAL_PROMPT_PROJECTION_VERSION,
    record_version: record.version,
    record_digest: record.digest,
    source_digests: {
      division: record.division.digest,
      cast_assignments: record.cast.assignmentsDigest,
      field_parts: record.field.partsDigest,
      event_stream: record.trajectory.eventStreamDigest,
      trajectory_factors: record.trajectory.factorDigest,
    },
    trajectory_summary: {
      completed_plies: record.trajectory.completedPlies,
      move_count: record.trajectory.moveCount,
      forced_pass_count: record.trajectory.forcedPassCount,
      promotion_count: record.trajectory.promotionCount,
      outcome: { ...record.outcome },
    },
    surviving_direction_keys: [...record.survivingDirectionKeys],
    surviving_directions: survivingDirections,
    supporting_captures: supportingCaptures,
    supporting_survivors: supportingSurvivors,
    human_explanation: [...record.explanation],
    epistemic_boundary: { ...record.epistemicBoundary },
  }
}

export class DirectionalRecordVerificationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DirectionalRecordVerificationError'
    if (cause !== undefined) this.cause = cause
  }
}

interface MutablePiece {
  id: string
  side: Side
  originalKind: PieceKind
  kind: PieceKind
  position: CellCoord
}

interface MutableContributions {
  departureVisits: number
  departureMaterial: number
  arrivalVisits: number
  arrivalMaterial: number
  chronology: number
  captureCount: number
  capturedMaterial: number
  attackerMaterial: number
  captureResonance: number
  captureOrder: number
  forcedPassConstraints: number
  forcedPassMaterial: number
  survivorCount: number
  survivorMaterial: number
  survivorMoveCount: number
  winningSurvivorMaterial: number
  terminalOutcomeWeight: number
  terminalCapture: number
  supportingPlies: Set<number>
  captureIds: Set<string>
  survivorPieceIds: Set<string>
}

function serializeCanonical(value: unknown, path = '$'): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Canonical JSON cannot encode ${path}: non-finite number.`)
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item, index) => serializeCanonical(item, `${path}[${index}]`))
      .join(',')}]`
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Canonical JSON cannot encode ${path}: only plain objects are supported.`,
      )
    }
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonical(record[key], `${path}.${key}`)}`,
      )
      .join(',')}}`
  }
  throw new TypeError(
    `Canonical JSON cannot encode ${path}: unsupported ${typeof value} value.`,
  )
}

function asCanonicalJson(value: unknown): CanonicalJson {
  serializeCanonical(value)
  return value as CanonicalJson
}

function plainRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${label} must be a plain object.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort()
  const expected = [...allowed].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has missing or unsupported fields.`)
  }
}

/** Reject cycles, accessors, exotic prototypes, and resource-exhaustion shapes. */
function assertBoundedJsonTree(value: unknown): void {
  const active = new WeakSet<object>()
  let nodeCount = 0

  const visit = (candidate: unknown, depth: number, path: string): void => {
    nodeCount += 1
    if (nodeCount > 200_000) {
      throw new Error('Directional record exceeds the structural node limit.')
    }
    if (depth > 24) {
      throw new Error('Directional record exceeds the structural depth limit.')
    }
    if (
      candidate === null ||
      typeof candidate === 'boolean' ||
      typeof candidate === 'string'
    ) {
      if (typeof candidate === 'string' && candidate.length > 1_000_000) {
        throw new Error(`${path} exceeds the text limit.`)
      }
      return
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new Error(`${path} is not finite.`)
      return
    }
    if (typeof candidate !== 'object') {
      throw new Error(`${path} is not JSON data.`)
    }
    if (active.has(candidate)) {
      throw new Error(`${path} contains a cycle.`)
    }
    active.add(candidate)

    if (Array.isArray(candidate)) {
      if (candidate.length > 512) {
        throw new Error(`${path} exceeds the array limit.`)
      }
      candidate.forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`))
      active.delete(candidate)
      return
    }

    const prototype = Object.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain objects.`)
    }
    const keys = Reflect.ownKeys(candidate)
    if (keys.length > 128 || keys.some((key) => typeof key !== 'string')) {
      throw new Error(`${path} has an unsupported object shape.`)
    }
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error(`${path}.${key} must be an enumerable data field.`)
      }
      visit(descriptor.value, depth + 1, `${path}.${key}`)
    }
    active.delete(candidate)
  }

  visit(value, 0, '$')
  if (utf8ByteLength(serializeCanonical(value)) > MAX_DIRECTIONAL_RECORD_CANONICAL_BYTES) {
    throw new Error('Directional record exceeds the canonical byte limit.')
  }
}

function digest(value: unknown): string {
  return sha256Utf8Hex(serializeCanonical(asCanonicalJson(value)))
}

function cloneCoord(coord: CellCoord): CellCoord {
  return { ring: coord.ring, sector: coord.sector }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function clonePart(part: ProblemPart): ProblemPart {
  const textFields = [
    'title',
    'focus',
    'hexagramName',
    'theme',
    'dimension',
    'movement',
    'prompt',
    'keyword',
  ] as const
  for (const field of textFields) {
    if (typeof part[field] !== 'string' || part[field].trim().length === 0) {
      throw new Error(`Problem part ${String(part.id)} is missing ${field}.`)
    }
  }
  if (!Number.isInteger(part.id) || part.id < 1 || part.id > 64) {
    throw new Error(`Problem part ${String(part.id)} has an invalid id.`)
  }
  if (
    !Number.isInteger(part.hexagram) ||
    part.hexagram < 1 ||
    part.hexagram > 64
  ) {
    throw new Error(`Problem part ${part.id} has an invalid hexagram.`)
  }
  if (typeof part.castApplication !== 'string') {
    throw new Error(
      `Problem part ${part.id} is legacy pre-directional data and cannot produce a current directional record.`,
    )
  }
  const castApplication = part.castApplication.replace(/\s+/gu, ' ').trim()
  if (
    castApplication.length < DIVISION_CAST_APPLICATION_MIN_CHARS ||
    castApplication.length > DIVISION_CAST_APPLICATION_MAX_CHARS
  ) {
    throw new Error(`Problem part ${part.id} has an invalid cast application.`)
  }
  return {
    id: part.id,
    title: part.title.trim(),
    focus: part.focus.trim(),
    hexagram: part.hexagram,
    hexagramName: part.hexagramName.trim(),
    theme: part.theme.trim(),
    dimension: part.dimension.trim(),
    movement: part.movement.trim(),
    prompt: part.prompt.trim(),
    keyword: part.keyword.trim(),
    castApplication,
  }
}

function validateSeed(value: string | number, label: string): void {
  if (
    (typeof value === 'string' && value.trim().length > 0 && value.length <= 512) ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return
  }
  throw new Error(`${label} must be a finite number or 1-512 non-blank characters.`)
}

function normalizedCanonicalParts(
  parts: readonly ProblemPart[],
  seed: string | number,
): ProblemPart[] {
  if (parts.length !== 64) {
    throw new Error(`A directional record requires exactly 64 problem parts; received ${parts.length}.`)
  }
  validateSeed(seed, 'Division seed')
  const normalized = parts.map(clonePart)
  if (new Set(normalized.map((part) => part.id)).size !== 64) {
    throw new Error('Directional record parts must contain each facet id exactly once.')
  }
  if (new Set(normalized.map((part) => part.hexagram)).size !== 64) {
    throw new Error('Directional record parts must contain each I Ching hexagram exactly once.')
  }

  const facets = normalized
    .map(
      (part): ProblemFacet => ({
        id: part.id,
        title: part.title,
        focus: part.focus,
        question: part.prompt,
        keyword: part.keyword,
        castApplication: part.castApplication,
      }),
    )
    .sort((left, right) => left.id - right.id)
  const recomposed = composeProblemParts(facets, seed)
  if (serializeCanonical(normalized) !== serializeCanonical(recomposed)) {
    throw new Error(
      'Problem parts do not match the canonical facet, hexagram, and board shuffles for the Division seed.',
    )
  }
  return normalized
}

function lensAt(
  parts: readonly ProblemPart[],
  assignments: ReadonlyMap<number, DivisionCastAssignment>,
  coord: CellCoord,
): DirectionalLensReference {
  const part = parts[coord.ring * 8 + coord.sector]
  if (!part) {
    throw new Error(`No cast-qualified lens exists at (${coord.ring}, ${coord.sector}).`)
  }
  const assignment = assignments.get(part.id)
  if (!assignment) {
    throw new Error(`The directional cast is missing facet ${part.id}.`)
  }
  if (!part.castApplication) {
    throw new Error(`Problem part ${part.id} has no current cast application.`)
  }
  return {
    key: `part-${part.id}@${coord.ring}:${coord.sector}`,
    coordinate: cloneCoord(coord),
    partId: part.id,
    hexagram: part.hexagram,
    hexagramName: part.hexagramName,
    theme: part.theme,
    dimension: part.dimension,
    movement: part.movement,
    title: part.title,
    focus: part.focus,
    prompt: part.prompt,
    keyword: part.keyword,
    directionalCue: assignment.directionalCue,
    castApplication: part.castApplication,
  }
}

function pieceReference(piece: MutablePiece): DirectionalPieceReference {
  return {
    pieceId: piece.id,
    side: piece.side,
    originalKind: piece.originalKind,
    kind: piece.kind,
    originalValue: PIECE_VALUES[piece.originalKind],
    value: PIECE_VALUES[piece.kind],
  }
}

function initialPieceMap(): Map<string, MutablePiece> {
  return new Map(
    createInitialPieces().map((piece) => [
      piece.id,
      {
        id: piece.id,
        side: piece.side,
        originalKind: piece.kind,
        kind: piece.kind,
        position: cloneCoord(piece.position),
      },
    ]),
  )
}

function cloneMoveEvent(
  event: Extract<GameEvent, { type: 'move' }>,
): Extract<GameEvent, { type: 'move' }> {
  return {
    version: event.version,
    type: 'move',
    ply: event.ply,
    side: event.side,
    pieceId: event.pieceId,
    from: cloneCoord(event.from),
    to: cloneCoord(event.to),
    ...(event.capturedPieceId === undefined
      ? {}
      : { capturedPieceId: event.capturedPieceId }),
    ...(event.promotedTo === undefined ? {} : { promotedTo: event.promotedTo }),
  }
}

function mutableContributions(): MutableContributions {
  return {
    departureVisits: 0,
    departureMaterial: 0,
    arrivalVisits: 0,
    arrivalMaterial: 0,
    chronology: 0,
    captureCount: 0,
    capturedMaterial: 0,
    attackerMaterial: 0,
    captureResonance: 0,
    captureOrder: 0,
    forcedPassConstraints: 0,
    forcedPassMaterial: 0,
    survivorCount: 0,
    survivorMaterial: 0,
    survivorMoveCount: 0,
    winningSurvivorMaterial: 0,
    terminalOutcomeWeight: 0,
    terminalCapture: 0,
    supportingPlies: new Set<number>(),
    captureIds: new Set<string>(),
    survivorPieceIds: new Set<string>(),
  }
}

function contributionMap(
  parts: readonly ProblemPart[],
  assignments: ReadonlyMap<number, DivisionCastAssignment>,
): Map<string, MutableContributions> {
  return new Map(
    parts.map((_, index) => {
      const lens = lensAt(parts, assignments, {
        ring: Math.floor(index / 8),
        sector: index % 8,
      })
      return [lens.key, mutableContributions()]
    }),
  )
}

function contributionFor(
  contributions: ReadonlyMap<string, MutableContributions>,
  lens: DirectionalLensReference,
): MutableContributions {
  const contribution = contributions.get(lens.key)
  if (!contribution) throw new Error(`Missing contribution bucket ${lens.key}.`)
  return contribution
}

export function scoreDirectionalContributions(
  value: DirectionalContributions,
): number {
  // These integers are method weights, not empirical probabilities. Keeping
  // every term integral makes the v1 calculation portable and auditable.
  return (
    value.departureVisits * 7 +
    value.departureMaterial * 13 +
    value.arrivalVisits * 11 +
    value.arrivalMaterial * 19 +
    value.chronology +
    value.captureCount * 47 +
    value.capturedMaterial * 113 +
    value.attackerMaterial * 17 +
    value.captureResonance * 3 +
    value.captureOrder * 23 +
    value.forcedPassConstraints * 29 +
    value.forcedPassMaterial * 31 +
    value.survivorCount * 53 +
    value.survivorMaterial * 127 +
    value.survivorMoveCount * 5 +
    value.winningSurvivorMaterial * 67 +
    value.terminalOutcomeWeight * 37 +
    value.terminalCapture * 997
  )
}

function frozenContributions(value: MutableContributions): DirectionalContributions {
  return {
    departureVisits: value.departureVisits,
    departureMaterial: value.departureMaterial,
    arrivalVisits: value.arrivalVisits,
    arrivalMaterial: value.arrivalMaterial,
    chronology: value.chronology,
    captureCount: value.captureCount,
    capturedMaterial: value.capturedMaterial,
    attackerMaterial: value.attackerMaterial,
    captureResonance: value.captureResonance,
    captureOrder: value.captureOrder,
    forcedPassConstraints: value.forcedPassConstraints,
    forcedPassMaterial: value.forcedPassMaterial,
    survivorCount: value.survivorCount,
    survivorMaterial: value.survivorMaterial,
    survivorMoveCount: value.survivorMoveCount,
    winningSurvivorMaterial: value.winningSurvivorMaterial,
    terminalOutcomeWeight: value.terminalOutcomeWeight,
    terminalCapture: value.terminalCapture,
  }
}

function directionExplanation(
  lens: DirectionalLensReference,
  contributions: DirectionalContributions,
  score: number,
): string {
  return `${lens.dimension} / ${lens.movement}, cast through Hexagram ${lens.hexagram} (${lens.hexagramName}), received score ${score}: ${contributions.arrivalVisits} arrivals, ${contributions.departureVisits} departures, ${contributions.captureCount} captures challenging ${contributions.capturedMaterial} material value, ${contributions.forcedPassConstraints} forced-pass constraints, ${contributions.survivorCount} final survivors worth ${contributions.survivorMaterial}, and ${contributions.terminalOutcomeWeight} terminal-outcome weight. This is replay-derived direction, not factual evidence.`
}

function outcomeRecord(
  outcome: GameOutcome,
  captures: readonly DirectionalCaptureFactor[],
): DirectionalOutcome {
  const terminalCaptureId = outcome.terminalCapture?.id ?? null
  if (
    terminalCaptureId !== null &&
    !captures.some((capture) => capture.captureId === terminalCaptureId)
  ) {
    throw new Error('The terminal capture is missing from the canonical capture sequence.')
  }
  return {
    winner: outcome.winner,
    reason: outcome.reason,
    completedTurn: outcome.completedTurn,
    terminalCaptureId,
  }
}

function buildRecordMaterial(input: DirectionalRecordInput): Omit<TrajectoryDirectionalRecord, 'digest'> {
  if (!/^[0-9a-f]{64}$/u.test(input.divisionDigest)) {
    throw new Error('Division digest must be a lowercase SHA-256 digest.')
  }
  validateSeed(input.divisionSeed, 'Division seed')
  validateSeed(input.castSeed, 'Lifecycle cast seed')
  validateSeed(input.trajectorySeed, 'Trajectory seed')

  const parts = normalizedCanonicalParts(input.parts, input.divisionSeed)
  const castAssignments = deriveDivisionCastAssignments(input.divisionSeed)
  const castAssignmentById = new Map(
    castAssignments.map((assignment) => [assignment.id, assignment]),
  )
  const replay = replayGameEvents(input.events, parts)
  if (serializeCanonical(input.versions) !== serializeCanonical(replay.versions)) {
    throw new Error(
      'Directional record source versions do not match the current replay contract.',
    )
  }
  if (!replay.outcome) {
    throw new Error('A directional record requires a terminal canonical replay.')
  }
  const terminalOutcome = replay.outcome

  const pieces = initialPieceMap()
  const captureByPly = new Map(replay.captures.map((capture) => [capture.turn, capture]))
  const contributions = contributionMap(parts, castAssignmentById)
  const eventFactors: DirectionalEventFactor[] = []
  const captureFactors: DirectionalCaptureFactor[] = []
  const routes = new Map<string, DirectionalSurvivorFactor['route'][number][]>()
  const captureIdsByAttacker = new Map<string, string[]>()
  const eventCount = replay.events.length

  for (const event of replay.events) {
    if (event.type === 'forced-pass') {
      const constrainedPieces = [...pieces.values()]
        .filter((piece) => piece.side === event.side)
        .sort((left, right) => compareCodeUnits(left.id, right.id))
        .map((piece): DirectionalPassConstraint => {
          const lens = lensAt(parts, castAssignmentById, piece.position)
          const bucket = contributionFor(contributions, lens)
          bucket.forcedPassConstraints += 1
          bucket.forcedPassMaterial += PIECE_VALUES[piece.kind]
          bucket.supportingPlies.add(event.ply)
          return { piece: pieceReference(piece), lens }
        })
      eventFactors.push({
        type: 'forced-pass',
        ply: event.ply,
        side: event.side,
        event: { ...event },
        constrainedPieces,
      })
      continue
    }

    const mover = pieces.get(event.pieceId)
    if (!mover) {
      throw new Error(`Canonical event ${event.ply} references missing mover ${event.pieceId}.`)
    }
    const moverBefore = pieceReference(mover)
    const departure = lensAt(parts, castAssignmentById, event.from)
    const arrival = lensAt(parts, castAssignmentById, event.to)
    const departureBucket = contributionFor(contributions, departure)
    const arrivalBucket = contributionFor(contributions, arrival)
    departureBucket.departureVisits += 1
    departureBucket.departureMaterial += moverBefore.value
    departureBucket.chronology += eventCount - event.ply + 1
    departureBucket.supportingPlies.add(event.ply)
    arrivalBucket.arrivalVisits += 1
    arrivalBucket.arrivalMaterial += moverBefore.value
    arrivalBucket.chronology += event.ply
    arrivalBucket.supportingPlies.add(event.ply)

    const capture = captureByPly.get(event.ply)
    if ((capture === undefined) !== (event.capturedPieceId === undefined)) {
      throw new Error(`Canonical capture data does not match move ${event.ply}.`)
    }
    let captureId: string | null = null
    if (capture) {
      const captured = pieces.get(capture.captured.id)
      if (!captured || captured.id !== event.capturedPieceId) {
        throw new Error(`Canonical capture ${capture.id} has inconsistent piece identity.`)
      }
      captureId = capture.id
      const captureSequence = captureFactors.length + 1
      const capturedReference = pieceReference(captured)
      arrivalBucket.captureCount += 1
      arrivalBucket.capturedMaterial += capturedReference.value
      arrivalBucket.attackerMaterial += moverBefore.value
      arrivalBucket.captureResonance += capture.resonance
      arrivalBucket.captureOrder += captureSequence
      arrivalBucket.captureIds.add(capture.id)
      const attackerCaptures = captureIdsByAttacker.get(mover.id) ?? []
      attackerCaptures.push(capture.id)
      captureIdsByAttacker.set(mover.id, attackerCaptures)
      captureFactors.push({
        sequence: captureSequence,
        captureId: capture.id,
        ply: event.ply,
        attacker: moverBefore,
        captured: capturedReference,
        cell: cloneCoord(event.to),
        lens: arrival,
        capturedMaterialValue: capturedReference.value,
        attackerMaterialValue: moverBefore.value,
        resonance: capture.resonance,
      })
      pieces.delete(captured.id)
    }

    const pieceRoute = routes.get(mover.id) ?? []
    pieceRoute.push({
      ply: event.ply,
      from: cloneCoord(event.from),
      fromPartId: departure.partId,
      to: cloneCoord(event.to),
      toPartId: arrival.partId,
      capturedPieceId: event.capturedPieceId ?? null,
      promotedTo: event.promotedTo ?? null,
    })
    routes.set(mover.id, pieceRoute)
    mover.position = cloneCoord(event.to)
    if (event.promotedTo) mover.kind = event.promotedTo
    eventFactors.push({
      type: 'move',
      ply: event.ply,
      side: event.side,
      event: cloneMoveEvent(event),
      mover: moverBefore,
      departure,
      arrival,
      captureId,
      promotedTo: event.promotedTo ?? null,
    })
  }

  const replayPieces = [...replay.pieces]
    .map((piece) => ({ ...piece, position: cloneCoord(piece.position) }))
    .sort((left, right) => compareCodeUnits(left.id, right.id))
  const trackedPieces = [...pieces.values()]
    .map((piece) => ({
      id: piece.id,
      side: piece.side,
      kind: piece.kind,
      position: cloneCoord(piece.position),
      moved: (routes.get(piece.id)?.length ?? 0) > 0,
    } satisfies Piece))
    .sort((left, right) => compareCodeUnits(left.id, right.id))
  if (serializeCanonical(trackedPieces) !== serializeCanonical(replayPieces)) {
    throw new Error('Directional reconstruction does not match the canonical terminal board.')
  }

  const survivors = [...pieces.values()]
    .sort((left, right) => compareCodeUnits(left.id, right.id))
    .map((piece): DirectionalSurvivorFactor => {
      const lens = lensAt(parts, castAssignmentById, piece.position)
      const route = routes.get(piece.id) ?? []
      const bucket = contributionFor(contributions, lens)
      const reference = pieceReference(piece)
      bucket.survivorCount += 1
      bucket.survivorMaterial += reference.value
      bucket.survivorMoveCount += route.length
      bucket.survivorPieceIds.add(piece.id)
      if (terminalOutcome.winner === piece.side) {
        bucket.winningSurvivorMaterial += reference.value
      }
      const outcomeSideWeight = terminalOutcome.winner === null
        ? DIRECTIONAL_OUTCOME_WEIGHTS.drawnSide
        : terminalOutcome.winner === piece.side
          ? DIRECTIONAL_OUTCOME_WEIGHTS.winningSide
          : DIRECTIONAL_OUTCOME_WEIGHTS.losingSide
      bucket.terminalOutcomeWeight +=
        reference.value *
        outcomeSideWeight *
        DIRECTIONAL_OUTCOME_WEIGHTS.reason[terminalOutcome.reason]
      return {
        piece: reference,
        finalCoordinate: cloneCoord(piece.position),
        finalLens: lens,
        route,
        captureIds: captureIdsByAttacker.get(piece.id) ?? [],
        moveCount: route.length,
        promoted: piece.originalKind === 'pawn' && piece.kind === 'queen',
      }
    })

  const terminalCaptureId = terminalOutcome.terminalCapture?.id
  if (terminalCaptureId) {
    const terminalCapture = captureFactors.find(
      (capture) => capture.captureId === terminalCaptureId,
    )
    if (!terminalCapture) {
      throw new Error('The terminal capture is not present in the directional capture sequence.')
    }
    contributionFor(contributions, terminalCapture.lens).terminalCapture += 1
  }

  const directions = parts
    .map((_, index) => {
      const lens = lensAt(parts, castAssignmentById, {
        ring: Math.floor(index / 8),
        sector: index % 8,
      })
      const mutable = contributionFor(contributions, lens)
      const frozen = frozenContributions(mutable)
      const score = scoreDirectionalContributions(frozen)
      return {
        rank: 0,
        lens,
        score,
        contributions: frozen,
        supportingPlies: [...mutable.supportingPlies].sort((left, right) => left - right),
        captureIds: [...mutable.captureIds].sort(),
        survivorPieceIds: [...mutable.survivorPieceIds].sort(),
        explanation: directionExplanation(lens, frozen, score),
      }
    })
    .sort(
      (left, right) =>
        right.score - left.score || compareCodeUnits(left.lens.key, right.lens.key),
    )
    .map((direction, index): DirectionalSignal => ({
      ...direction,
      rank: index + 1,
    }))

  const outcome = outcomeRecord(terminalOutcome, captureFactors)
  const top = directions.slice(0, DIRECTIONAL_RECORD_SELECTION_COUNT)
  const explanation = [
    `The canonical ${replay.completedPlies}-ply trajectory contributed every move departure and arrival, ${captureFactors.length} ordered captures, ${eventFactors.filter((event) => event.type === 'forced-pass').length} forced passes, ${survivors.length} surviving pieces, and the ${outcome.reason} terminal outcome.`,
    `The eight highest-scoring cast-qualified directions are ${top.map((direction) => `${direction.lens.dimension} / ${direction.lens.movement} (Hexagram ${direction.lens.hexagram})`).join('; ')}. Their integer scores are replay calculations, not probabilities or evidence weights.`,
    DIRECTIONAL_EPISTEMIC_BOUNDARY.statement,
  ]

  const fieldParts = parts.map((part, index): DirectionalFieldPart => ({
    coordinate: { ring: Math.floor(index / 8), sector: index % 8 },
    part: { ...part },
    castAssignment: {
      ...(castAssignmentById.get(part.id) ?? (() => {
        throw new Error(`The directional cast is missing facet ${part.id}.`)
      })()),
    },
  }))
  const eventStream = replay.events.map((event) =>
    event.type === 'move' ? cloneMoveEvent(event) : { ...event },
  )

  return {
    version: DIRECTIONAL_RECORD_VERSION,
    division: {
      digest: input.divisionDigest,
      seed: input.divisionSeed,
    },
    cast: {
      version: replay.versions.cast,
      assignmentVersion: DIVISION_CAST_BINDING_VERSION,
      lifecycleSeed: input.castSeed,
      assignmentsDigest: digest(castAssignments),
      shuffleSeeds: {
        facets: divisionSeed(input.divisionSeed, 'facets'),
        hexagrams: divisionSeed(input.divisionSeed, 'hexagrams'),
        board: divisionSeed(input.divisionSeed, 'board'),
      },
    },
    field: {
      partsDigest: digest(fieldParts),
      parts: fieldParts,
    },
    trajectory: {
      seed: input.trajectorySeed,
      eventVersion: replay.versions.event,
      rulesVersion: replay.versions.rules,
      engineVersion: replay.versions.engine,
      eventStreamDigest: digest(eventStream),
      factorDigest: digest(eventFactors),
      completedPlies: replay.completedPlies,
      moveCount: eventFactors.filter((event) => event.type === 'move').length,
      forcedPassCount: eventFactors.filter((event) => event.type === 'forced-pass').length,
      promotionCount: eventFactors.filter(
        (event) => event.type === 'move' && event.promotedTo !== null,
      ).length,
      events: eventFactors,
    },
    captures: captureFactors,
    survivors,
    outcome,
    directions,
    survivingDirectionKeys: top.map((direction) => direction.lens.key),
    explanation,
    epistemicBoundary: DIRECTIONAL_EPISTEMIC_BOUNDARY,
  }
}

/**
 * Replays and verifies the canonical game before calculating the complete,
 * versioned directional record. Lifecycle database identities remain visible
 * for source-row attestation but are deliberately excluded from the portable
 * content digest; timestamps and provider-response metadata are absent.
 */
export function deriveTrajectoryDirectionalRecord(
  input: DirectionalRecordInput,
): TrajectoryDirectionalRecord {
  const material = buildRecordMaterial(input)
  const cast = {
    version: material.cast.version,
    assignmentVersion: material.cast.assignmentVersion,
    assignmentsDigest: material.cast.assignmentsDigest,
    shuffleSeeds: material.cast.shuffleSeeds,
  }
  const trajectory = {
    eventVersion: material.trajectory.eventVersion,
    rulesVersion: material.trajectory.rulesVersion,
    engineVersion: material.trajectory.engineVersion,
    eventStreamDigest: material.trajectory.eventStreamDigest,
    factorDigest: material.trajectory.factorDigest,
    completedPlies: material.trajectory.completedPlies,
    moveCount: material.trajectory.moveCount,
    forcedPassCount: material.trajectory.forcedPassCount,
    promotionCount: material.trajectory.promotionCount,
    events: material.trajectory.events,
  }
  const record: TrajectoryDirectionalRecord = {
    ...material,
    // Lifecycle cast/trajectory seeds can contain database identities. They
    // remain visible provenance checked against the trusted source row, but do
    // not enter the portable content digest.
    digest: digest({ ...material, cast, trajectory }),
  }
  assertBoundedJsonTree(record)
  return record
}

/** Stable canonical bytes for archive/export comparison. */
export function serializeTrajectoryDirectionalRecord(
  record: TrajectoryDirectionalRecord,
): string {
  return serializeCanonical(record)
}

function boundedArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain between ${minimum} and ${maximum} items.`)
  }
  return value
}

function verificationEnvelope(value: unknown): {
  readonly record: TrajectoryDirectionalRecord
  readonly parts: readonly ProblemPart[]
  readonly events: readonly unknown[]
} {
  assertBoundedJsonTree(value)
  const record = plainRecord(value, 'Directional record')
  exactKeys(record, [
    'version',
    'digest',
    'division',
    'cast',
    'field',
    'trajectory',
    'captures',
    'survivors',
    'outcome',
    'directions',
    'survivingDirectionKeys',
    'explanation',
    'epistemicBoundary',
  ], 'Directional record')
  if (record.version !== DIRECTIONAL_RECORD_VERSION) {
    throw new Error('Directional record version is unsupported.')
  }
  if (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(record.digest)) {
    throw new Error('Directional record digest is invalid.')
  }

  const division = plainRecord(record.division, 'Directional record division')
  exactKeys(division, ['digest', 'seed'], 'Directional record division')
  const cast = plainRecord(record.cast, 'Directional record cast')
  exactKeys(cast, [
    'version',
    'assignmentVersion',
    'lifecycleSeed',
    'assignmentsDigest',
    'shuffleSeeds',
  ], 'Directional record cast')
  if (cast.assignmentVersion !== DIVISION_CAST_BINDING_VERSION) {
    throw new Error('Directional record cast-assignment version is unsupported.')
  }
  exactKeys(
    plainRecord(cast.shuffleSeeds, 'Directional record shuffle seeds'),
    ['facets', 'hexagrams', 'board'],
    'Directional record shuffle seeds',
  )

  const field = plainRecord(record.field, 'Directional record field')
  exactKeys(field, ['partsDigest', 'parts'], 'Directional record field')
  const fieldParts = boundedArray(field.parts, 'Directional record field parts', 64, 64)
  const parts = fieldParts.map((candidate, index) => {
    const entry = plainRecord(candidate, `Directional field part ${index + 1}`)
    exactKeys(
      entry,
      ['coordinate', 'part', 'castAssignment'],
      `Directional field part ${index + 1}`,
    )
    plainRecord(entry.coordinate, `Directional field coordinate ${index + 1}`)
    plainRecord(entry.part, `Directional field value ${index + 1}`)
    plainRecord(entry.castAssignment, `Directional cast assignment ${index + 1}`)
    return entry.part as unknown as ProblemPart
  })

  const trajectory = plainRecord(record.trajectory, 'Directional record trajectory')
  exactKeys(trajectory, [
    'seed',
    'eventVersion',
    'rulesVersion',
    'engineVersion',
    'eventStreamDigest',
    'factorDigest',
    'completedPlies',
    'moveCount',
    'forcedPassCount',
    'promotionCount',
    'events',
  ], 'Directional record trajectory')
  const factors = boundedArray(
    trajectory.events,
    'Directional trajectory events',
    1,
    256,
  )
  const events = factors.map((candidate, index) => {
    const factor = plainRecord(candidate, `Directional event ${index + 1}`)
    if (factor.type === 'move') {
      exactKeys(factor, [
        'type',
        'ply',
        'side',
        'event',
        'mover',
        'departure',
        'arrival',
        'captureId',
        'promotedTo',
      ], `Directional event ${index + 1}`)
    } else if (factor.type === 'forced-pass') {
      exactKeys(factor, [
        'type',
        'ply',
        'side',
        'event',
        'constrainedPieces',
      ], `Directional event ${index + 1}`)
    } else {
      throw new Error(`Directional event ${index + 1} has an unsupported type.`)
    }
    plainRecord(factor.event, `Canonical event ${index + 1}`)
    return factor.event
  })

  boundedArray(record.captures, 'Directional captures', 0, 31)
  boundedArray(record.survivors, 'Directional survivors', 1, 32)
  boundedArray(record.directions, 'Directional signals', 64, 64)
  boundedArray(
    record.survivingDirectionKeys,
    'Surviving direction keys',
    DIRECTIONAL_RECORD_SELECTION_COUNT,
    DIRECTIONAL_RECORD_SELECTION_COUNT,
  )
  boundedArray(record.explanation, 'Directional explanation', 3, 3)
  exactKeys(
    plainRecord(record.outcome, 'Directional outcome'),
    ['winner', 'reason', 'completedTurn', 'terminalCaptureId'],
    'Directional outcome',
  )
  exactKeys(
    plainRecord(record.epistemicBoundary, 'Directional epistemic boundary'),
    ['classification', 'statement'],
    'Directional epistemic boundary',
  )

  return {
    record: record as unknown as TrajectoryDirectionalRecord,
    parts,
    events,
  }
}

/**
 * Recomputes a record from its embedded canonical field and event log, then
 * binds source labels to independently trusted game/lifecycle provenance.
 */
export function verifyTrajectoryDirectionalRecord(
  value: unknown,
  expected: DirectionalRecordExpectedSource,
): TrajectoryDirectionalRecord {
  try {
    const envelope = verificationEnvelope(value)
    const { record } = envelope
    const embeddedVersions = {
      event: record.trajectory.eventVersion,
      rules: record.trajectory.rulesVersion,
      cast: record.cast.version,
      engine: record.trajectory.engineVersion,
    }
    if (
      record.division.digest !== expected.divisionDigest ||
      serializeCanonical(record.division.seed) !==
        serializeCanonical(expected.divisionSeed) ||
      record.cast.lifecycleSeed !== expected.castSeed ||
      record.trajectory.seed !== expected.trajectorySeed ||
      serializeCanonical(embeddedVersions) !==
        serializeCanonical(expected.versions)
    ) {
      throw new Error('the record does not match the trusted source provenance')
    }
    const recomputed = deriveTrajectoryDirectionalRecord({
      divisionDigest: record.division.digest,
      divisionSeed: record.division.seed,
      castSeed: record.cast.lifecycleSeed,
      trajectorySeed: record.trajectory.seed,
      versions: expected.versions,
      parts: envelope.parts,
      events: envelope.events,
    })
    if (
      serializeTrajectoryDirectionalRecord(recomputed) !==
      serializeTrajectoryDirectionalRecord(record)
    ) {
      throw new Error('the record was changed or is incomplete')
    }
    return recomputed
  } catch (error) {
    if (error instanceof DirectionalRecordVerificationError) throw error
    const detail = error instanceof Error ? error.message : 'malformed input'
    throw new DirectionalRecordVerificationError(
      `Directional record verification failed: ${detail}.`,
      error,
    )
  }
}

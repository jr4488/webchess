import { describe, expect, it } from 'vitest'

import { getLegalMoves, hasLegalMove } from '../lib/game'
import type { GameEvent, ReplayState } from '../lib/game-contract'
import {
  acceptMoveCommand,
  createReplayState,
} from '../lib/game-replay'
import { makeProblemParts } from '../test/fixtures'
import {
  createCaseBundle,
  verifyCaseBundle,
} from './case-bundle'
import type { CaseBundleSourceRows } from './case-bundle'
import { hashCanonicalJson, sha256Hex } from './db/hash'
import type { CanonicalJson } from './db/hash'
import type { SqlRow } from './db/sql'

const GAME_ID = '71000000-0000-4000-8000-000000000001'
const RUN_ID = '71000000-0000-4000-8000-000000000002'
const ROOT_ID = '71000000-0000-4000-8000-000000000003'
const MODEL_ID = '71000000-0000-4000-8000-000000000004'
const PORTIA_MODEL_ID = '71000000-0000-4000-8000-000000000008'
const CHARLOTTE_MODEL_ID = '71000000-0000-4000-8000-000000000009'
const SOURCE_COMMIT = '1'.repeat(40)
const RUNTIME_ARTIFACT_SHA256 = '7'.repeat(64)
const NOW = '2026-08-24T01:00:00.000Z'
const PRIVATE_SENTINEL = 'PRIVATE_CASE_TEXT_MUST_BE_REDACTED'
const parts = makeProblemParts(PRIVATE_SENTINEL)

let cachedTerminal: ReplayState | null = null

function terminalState(): ReplayState {
  if (cachedTerminal) return cachedTerminal
  let state = createReplayState()
  while (!state.outcome) {
    if (!hasLegalMove(state.pieces, state.turn)) {
      throw new Error('The deterministic case fixture unexpectedly needs a pass.')
    }
    const piece = state.pieces.find(
      (candidate) =>
        candidate.side === state.turn &&
        getLegalMoves(candidate, state.pieces).length > 0,
    )
    if (!piece) throw new Error('The case fixture has no legal piece.')
    const destination = getLegalMoves(piece, state.pieces)[0]
    if (!destination) throw new Error('The case fixture has no legal move.')
    state = acceptMoveCommand(state, {
      expectedPly: state.completedPlies + 1,
      pieceId: piece.id,
      to: destination,
    }, parts).state
  }
  cachedTerminal = state
  return state
}

function eventRow(event: GameEvent, gameRevision: number): SqlRow {
  return {
    gameId: GAME_ID,
    ply: event.ply,
    kind: event.type === 'move' ? 'move' : 'pass',
    source: event.type === 'move' ? 'client' : 'server',
    side: event.side,
    pieceId: event.type === 'move' ? event.pieceId : null,
    capturedPieceId: event.type === 'move'
      ? event.capturedPieceId ?? null
      : null,
    promotedTo: event.type === 'move' ? event.promotedTo ?? null : null,
    fromRing: event.type === 'move' ? event.from.ring : null,
    fromSector: event.type === 'move' ? event.from.sector : null,
    toRing: event.type === 'move' ? event.to.ring : null,
    toSector: event.type === 'move' ? event.to.sector : null,
    idempotencyKey: event.type === 'move'
      ? `72000000-0000-4000-8000-${String(event.ply).padStart(12, '0')}`
      : null,
    requestSha256: event.type === 'move'
      ? hashCanonicalJson({
          operation: 'game-move/1',
          expectedRevision: gameRevision - 1,
          command: {
            pieceId: event.pieceId,
            to: { ring: event.to.ring, sector: event.to.sector },
          },
        })
      : null,
    gameRevision: String(gameRevision),
    createdAt: NOW,
  }
}

function eventRows(events: readonly GameEvent[]): SqlRow[] {
  let gameRevision = 2
  return events.map((event) => {
    if (event.type === 'move') gameRevision += 1
    return eventRow(event, gameRevision)
  })
}

function gameRow(state: ReplayState): SqlRow {
  const problem = `A bounded question containing ${PRIVATE_SENTINEL}.`
  const finalEventRevision = 2 + state.events.filter(
    (event) => event.type === 'move',
  ).length
  return {
    id: GAME_ID,
    sourceGameId: null,
    revision: String(finalEventRevision + 2),
    status: 'answered',
    problem,
    problemSha256: sha256Hex(problem),
    divisionSeed: 'division-seed',
    divisionFacets: Array.from({ length: 64 }, (_, index) => ({
      id: index + 1,
      title: `${PRIVATE_SENTINEL} facet ${index + 1}`,
    })),
    problemParts: parts,
    divisionModel: 'configured-default',
    divisionPromptVersion: 'webchess-division-v1',
    divisionPromptSha256: 'c'.repeat(64),
    divisionDigest: 'd'.repeat(64),
    rulesVersion: state.versions.rules,
    engineVersion: state.versions.engine,
    castVersion: state.versions.cast,
    eventVersion: state.versions.event,
    softwareVersion: 'webchess@2.2.0-rc.1-openclaw',
    outcome: state.outcome,
    answer: {
      answer: `${PRIVATE_SENTINEL} generated answer.`,
      model: 'configured-default',
      prompt: `${PRIVATE_SENTINEL} exact prompt.`,
    },
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
    answeredAt: NOW,
  }
}

function lifecycleRow(state: ReplayState): SqlRow {
  return {
    id: RUN_ID,
    gameId: GAME_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    state: 'charlotte_complete',
    revision: '9',
    fieldGeneration: 1,
    gameAttempt: 1,
    sameFieldRetryCount: 0,
    fieldRegenerationCount: 0,
    divisionSeed: 'division-seed',
    castSeed: 'cast-seed',
    trajectorySeed: 'trajectory-seed',
    retryReason: null,
    terminalFingerprint: 'e'.repeat(64),
    answerPromptDigest: 'f'.repeat(64),
    survivors: [],
    portiaCurrentCandidateId: null,
    portiaActiveModelRequestId: null,
    portiaFailedAttemptCount: 0,
    portiaFailureLimit: 3,
    portiaCompletedCandidateIds: [],
    portiaAssessmentDrafts: [],
    charlotteActiveModelRequestId: null,
    charlotteFailedAttemptCount: 0,
    charlotteFailureLimit: 3,
    softwareVersion: '2.2.0-rc.1',
    lifecycleVersion: 'webchess-lifecycle-v2.4',
    rulesVersion: state.versions.rules,
    engineVersion: state.versions.engine,
    castVersion: state.versions.cast,
    eventVersion: state.versions.event,
    portiaPromptVersion: 'webchess-portia-v4',
    portiaContractVersion: 'webchess-portia-review-v2',
    gateAlgorithmVersion: 'webchess-gate-v4',
    retryPolicyVersion: 'webchess-retry-v2',
    charlottePromptVersion: 'webchess-charlotte-v4',
    charlotteContractVersion: 'webchess-charlotte-result-v1',
    wilburRecordVersion: 'webchess-wilbur-v1',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function modelRow(overrides: SqlRow = {}): SqlRow {
  return {
    id: MODEL_ID,
    gameId: GAME_ID,
    operation: 'answer',
    idempotencyKey: '71000000-0000-4000-8000-000000000006',
    requestSha256: '1'.repeat(64),
    status: 'succeeded',
    attempt: 1,
    provider: 'openclaw',
    model: 'configured-default',
    promptVersion: 'webchess-answer-v4',
    softwareVersion: 'webchess@2.2.0-rc.1-openclaw',
    providerResponseId: 'provider-private-id',
    responseSha256: '2'.repeat(64),
    resultPayload: { prompt: `${PRIVATE_SENTINEL} provider payload.` },
    usageReported: false,
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    providerStartedAt: NOW,
    completedAt: NOW,
    failureCode: null,
    providerHttpStatus: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const COMPLETE_LIFECYCLE_TRANSITIONS = [
  ['anansi_pending', 'anansi_running'],
  ['anansi_running', 'field_ready'],
  ['field_ready', 'chess_ready'],
  ['chess_ready', 'chess_playing'],
  ['chess_playing', 'chess_terminal'],
  ['chess_terminal', 'portia_pending'],
  ['portia_pending', 'portia_running'],
  ['portia_running', 'portia_complete'],
  ['portia_complete', 'gate_passed'],
  ['gate_passed', 'charlotte_pending'],
  ['charlotte_pending', 'charlotte_running'],
  ['charlotte_running', 'charlotte_complete'],
] as const

function activityRows(
  transitions: readonly (readonly [string, string])[] =
    COMPLETE_LIFECYCLE_TRANSITIONS,
): SqlRow[] {
  return transitions.map(([stateFrom, stateTo], index) => ({
    id: `71000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    lifecycleRunId: RUN_ID,
    sequence: String(index + 1),
    stage: stateTo.startsWith('portia')
      ? 'portia'
      : stateTo.startsWith('gate')
        ? 'gate'
        : stateTo.startsWith('charlotte')
          ? 'charlotte'
          : stateTo.startsWith('chess')
            ? 'chess'
            : 'anansi',
    activityType: `fixture_transition_${index + 1}`,
    stateFrom,
    stateTo,
    inputEntityIds: [GAME_ID],
    outputEntityIds: [RUN_ID],
    responsibleAgentIds: ['fixture-agent'],
    configurationDigest: '3'.repeat(64),
    status: 'completed',
    eventVersion: 1,
    createdAt: NOW,
  }))
}

function sourceRows(): CaseBundleSourceRows {
  const state = terminalState()
  return {
    game: gameRow(state),
    events: eventRows(state.events),
    lifecycleRun: lifecycleRow(state),
    researchRequests: [],
    researchSources: [],
    portiaReviews: [{
      id: '71000000-0000-4000-8000-000000000010',
      lifecycleRunId: RUN_ID,
      modelRequestId: PORTIA_MODEL_ID,
      inputDigest: '5'.repeat(64),
      outputDigest: '6'.repeat(64),
      promptVersion: 'webchess-portia-v4',
      contractVersion: 'webchess-portia-review-v2',
      review: { narrative: `${PRIVATE_SENTINEL} Portia review.` },
      createdAt: NOW,
    }],
    gateDecisions: [{
      id: '71000000-0000-4000-8000-000000000011',
      lifecycleRunId: RUN_ID,
      algorithmVersion: 'webchess-gate-v4',
      inputDigest: '7'.repeat(64),
      passed: true,
      result: { narrative: `${PRIVATE_SENTINEL} Gate result.` },
      answerUserPrompt: `${PRIVATE_SENTINEL} approved prompt.`,
      answerUserPromptSha256: sha256Hex(`${PRIVATE_SENTINEL} approved prompt.`),
      createdAt: NOW,
    }],
    charlotteResults: [{
      id: '71000000-0000-4000-8000-000000000012',
      lifecycleRunId: RUN_ID,
      modelRequestId: CHARLOTTE_MODEL_ID,
      inputDigest: '9'.repeat(64),
      outputDigest: '0'.repeat(64),
      promptVersion: 'webchess-charlotte-v4',
      contractVersion: 'webchess-charlotte-result-v1',
      result: { narrative: `${PRIVATE_SENTINEL} Charlotte result.` },
      renderedAnswer: `${PRIVATE_SENTINEL} rendered answer.`,
      createdAt: NOW,
    }],
    wilburActions: [],
    wilburObservations: [],
    lifecycleActivities: activityRows(),
    modelRequests: [
      modelRow(),
      modelRow({
        id: PORTIA_MODEL_ID,
        operation: 'portia',
        promptVersion: 'webchess-portia-v4',
        requestSha256: '5'.repeat(64),
        responseSha256: '6'.repeat(64),
      }),
      modelRow({
        id: CHARLOTTE_MODEL_ID,
        operation: 'charlotte',
        promptVersion: 'webchess-charlotte-v4',
        requestSha256: '9'.repeat(64),
        responseSha256: '0'.repeat(64),
      }),
    ],
    migrations: [{
      id: '0001_durable_webchess',
      checksum: '4'.repeat(64),
      appliedAt: NOW,
    }],
  }
}

function bundle(
  profile: 'private-full-v1' | 'research-redacted-v1' | 'metadata-only-v1',
  overrides: Partial<CaseBundleSourceRows> = {},
) {
  return createCaseBundle({
    ...sourceRows(),
    ...overrides,
    profile,
    exportedAt: NOW,
    packageName: 'webchess',
    packageVersion: '2.2.0-rc.1',
    sourceCommit: SOURCE_COMMIT,
    runtimeArtifactSha256: RUNTIME_ARTIFACT_SHA256,
  })
}

interface MutableBundle {
  format: string
  profile: string
  manifest: {
    algorithm: 'sha256'
    canonicalization: string
    entries: { path: string; sha256: string }[]
    integrityRoot: string
  }
  data: Record<string, CanonicalJson>
}

function rebuildManifest(value: MutableBundle): void {
  value.manifest.entries = value.manifest.entries.map(({ path }) => {
    const key = path.slice('/data/'.length)
    return { path, sha256: hashCanonicalJson(value.data[key]!) }
  })
  value.manifest.integrityRoot = hashCanonicalJson({
    format: value.format,
    profile: value.profile,
    algorithm: value.manifest.algorithm,
    canonicalization: value.manifest.canonicalization,
    entries: value.manifest.entries,
  })
}

describe('webchess-case-bundle/1', () => {
  it.each([
    'private-full-v1',
    'research-redacted-v1',
    'metadata-only-v1',
  ] as const)('round-trips and canonically replays the %s profile', (profile) => {
    const created = bundle(profile)
    const result = verifyCaseBundle(created, {
      packageName: 'webchess',
      packageVersion: '2.2.0-rc.1',
      sourceCommit: SOURCE_COMMIT,
      runtimeArtifactSha256: RUNTIME_ARTIFACT_SHA256,
      migrations: { '0001_durable_webchess': '4'.repeat(64) },
    })

    expect(result.errors).toEqual([])
    expect(result).toMatchObject({
      ok: true,
      replay: {
        checked: true,
        exactProblemMapping: profile === 'private-full-v1',
        terminal: true,
      },
    })
    expect(result.verified).toContain(
      'event-by-event canonical board reconstruction and terminal summary',
    )
    expect(result.notVerified.join(' ')).toMatch(/efficacy/u)
  })

  it('uses explicit allowlists and removes private text from research export', () => {
    const privateBundle = bundle('private-full-v1')
    const redacted = bundle('research-redacted-v1')

    expect(JSON.stringify(privateBundle)).toContain(PRIVATE_SENTINEL)
    expect(JSON.stringify(redacted)).not.toContain(PRIVATE_SENTINEL)
    expect(redacted.data.redaction).toMatchObject({
      policy: 'webchess-case-redaction-policy/1',
      selection: 'field-allowlist',
    })
    expect(JSON.stringify(redacted.data.redaction)).toContain(
      '/data/game/replay/parts',
    )
    for (const omittedPath of [
      '/data/game/record/outcome',
      '/data/lifecycle/run/retryReason',
      '/data/lifecycle/run/survivors',
      '/data/lifecycle/run/portiaAssessmentDrafts',
      '/data/lifecycle/researchRequests/*/(reason|query|synthesisCharacterLimit|executedQueries|searchSynthesis|directPageTextFetched|retrievedFacts|injectionSignals)',
      '/data/lifecycle/wilburActions/*/(actor|action|testedAssumption|expectedObservation|decisionThreshold|reviewHorizon)',
      '/data/lifecycle/wilburObservations/*/(observation|evidenceClassification|expectedEffect|unexpectedEffect|stakeholderResponse|nextDecision)',
      '/data/providerInvocations/modelRequests/*/(idempotencyKey|providerResponseId|resultPayload)',
    ]) {
      expect(JSON.stringify(redacted.data.redaction)).toContain(omittedPath)
    }
  })

  it.each([
    {
      name: 'a zero failure limit',
      lifecycleRun: {
        ...lifecycleRow(terminalState()),
        portiaFailedAttemptCount: 0,
        portiaFailureLimit: 0,
      },
    },
    {
      name: 'a count above its limit',
      lifecycleRun: {
        ...lifecycleRow(terminalState()),
        charlotteFailedAttemptCount: 4,
        charlotteFailureLimit: 3,
      },
    },
    {
      name: 'a limit above the supported maximum',
      lifecycleRun: {
        ...lifecycleRow(terminalState()),
        portiaFailedAttemptCount: 0,
        portiaFailureLimit: 11,
      },
    },
  ])('rejects $name', ({ lifecycleRun }) => {
    const created = bundle('metadata-only-v1', { lifecycleRun })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(
      /failure budget must have a limit from 1 through 10/u,
    )
  })

  it('requires an unavailable lifecycle state to exactly exhaust its budget', () => {
    const rows = sourceRows()
    const created = bundle('metadata-only-v1', {
      lifecycleRun: {
        ...rows.lifecycleRun,
        state: 'charlotte_unavailable',
        charlotteFailedAttemptCount: 2,
        charlotteFailureLimit: 3,
      },
      lifecycleActivities: activityRows([
        ...COMPLETE_LIFECYCLE_TRANSITIONS.slice(0, -1),
        ['charlotte_running', 'charlotte_unavailable'],
      ]),
      charlotteResults: [],
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Charlotte unavailable requires an exactly exhausted failure budget.',
    )
  })

  it('detects content tampering before replay', () => {
    const created = structuredClone(bundle('research-redacted-v1')) as unknown as {
      data: { identity: { gameId: string } }
    }
    created.data.identity.gameId = '71000000-0000-4000-8000-000000000099'

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/manifest digest mismatch|integrity root/u)
  })

  it('rejects a rehashed redacted bundle that adds a private field', () => {
    const created = structuredClone(bundle('research-redacted-v1')) as unknown as MutableBundle
    const game = created.data.game as Record<string, CanonicalJson>
    const record = game.record as Record<string, CanonicalJson>
    record.problem = PRIVATE_SENTINEL
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/unsupported or missing fields/u)
  })

  it('rejects a rehashed redacted bundle with an invalid allowed digest value', () => {
    const created = structuredClone(bundle('research-redacted-v1')) as unknown as MutableBundle
    const game = created.data.game as Record<string, CanonicalJson>
    const record = game.record as Record<string, CanonicalJson>
    record.problemSha256 = { private: PRIVATE_SENTINEL }
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'data.game.record.problemSha256 must be a SHA-256 digest or null.',
    )
    expect(result.verified).not.toContain(
      'profile-specific field allowlists and replay payload shape',
    )
  })

  it('rejects structured private content smuggled through an allowed redacted array', () => {
    const created = structuredClone(bundle('research-redacted-v1')) as unknown as MutableBundle
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const run = lifecycle.run as Record<string, CanonicalJson>
    run.portiaCompletedCandidateIds = [{ private: PRIVATE_SENTINEL }]
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'data.lifecycle.run.portiaCompletedCandidateIds must contain only bounded non-empty strings.',
    )
  })

  it('rejects rehashed changes to canonical boundary and omission text', () => {
    const created = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const seedBoundary = lifecycle.seedBoundary as Record<string, CanonicalJson>
    seedBoundary.note = PRIVATE_SENTINEL
    const redaction = created.data.redaction as Record<string, CanonicalJson>
    const omissions = redaction.omissions as Record<string, CanonicalJson>[]
    omissions[0]!.reason = PRIVATE_SENTINEL
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      'Lifecycle seed-boundary fields must be strings.',
      'data.redaction.omissions[0] is not the canonical profile omission row.',
    ]))
  })

  it('binds private cleartext problem and Gate prompt to their recorded digests', () => {
    const problemChanged = structuredClone(bundle('private-full-v1')) as unknown as MutableBundle
    const problemGame = problemChanged.data.game as Record<string, CanonicalJson>
    const problemRecord = problemGame.record as Record<string, CanonicalJson>
    problemRecord.problem = `${PRIVATE_SENTINEL} altered problem`
    rebuildManifest(problemChanged)

    const gateChanged = structuredClone(bundle('private-full-v1')) as unknown as MutableBundle
    const lifecycle = gateChanged.data.lifecycle as Record<string, CanonicalJson>
    const gates = lifecycle.gateDecisions as Record<string, CanonicalJson>[]
    gates[0]!.answerUserPrompt = `${PRIVATE_SENTINEL} altered Gate prompt`
    rebuildManifest(gateChanged)

    expect(verifyCaseBundle(problemChanged).errors).toContain(
      'The private game problem does not match problemSha256.',
    )
    expect(verifyCaseBundle(gateChanged).errors).toContain(
      'data.lifecycle.gateDecisions[0] approved prompt does not match answerUserPromptSha256.',
    )
  })

  it('rejects rehashed event provenance source, digest, revision, and idempotency claims', () => {
    const badSource = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const sourceGame = badSource.data.game as Record<string, CanonicalJson>
    const sourceReplay = sourceGame.replay as Record<string, CanonicalJson>
    const sourceEvents = sourceReplay.events as Record<string, CanonicalJson>[]
    const sourceProvenance = sourceEvents[0]!.provenance as Record<string, CanonicalJson>
    sourceProvenance.source = 'provider'
    rebuildManifest(badSource)

    const badDigest = structuredClone(bundle('research-redacted-v1')) as unknown as MutableBundle
    const digestGame = badDigest.data.game as Record<string, CanonicalJson>
    const digestReplay = digestGame.replay as Record<string, CanonicalJson>
    const digestEvents = digestReplay.events as Record<string, CanonicalJson>[]
    const digestProvenance = digestEvents[0]!.provenance as Record<string, CanonicalJson>
    digestProvenance.requestSha256 = 'f'.repeat(64)
    rebuildManifest(badDigest)

    const badRevision = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const revisionGame = badRevision.data.game as Record<string, CanonicalJson>
    const revisionReplay = revisionGame.replay as Record<string, CanonicalJson>
    const revisionEvents = revisionReplay.events as Record<string, CanonicalJson>[]
    const secondRevision = revisionEvents.find((row, index) => {
      if (index === 0) return false
      const provenance = row.provenance as Record<string, CanonicalJson>
      return provenance.source === 'client'
    })?.provenance as Record<string, CanonicalJson>
    secondRevision.gameRevision = Number(secondRevision.gameRevision) + 1
    rebuildManifest(badRevision)

    const duplicateKey = structuredClone(bundle('private-full-v1')) as unknown as MutableBundle
    const keyGame = duplicateKey.data.game as Record<string, CanonicalJson>
    const keyReplay = keyGame.replay as Record<string, CanonicalJson>
    const keyEvents = keyReplay.events as Record<string, CanonicalJson>[]
    const clientRows = keyEvents.filter((row) =>
      (row.provenance as Record<string, CanonicalJson>).source === 'client')
    const firstKey = clientRows[0]!.provenance as Record<string, CanonicalJson>
    const secondKey = clientRows[1]!.provenance as Record<string, CanonicalJson>
    secondKey.idempotencyKey = firstKey.idempotencyKey!
    rebuildManifest(duplicateKey)

    expect(verifyCaseBundle(badSource).errors.join(' ')).toMatch(/source\/type provenance binding/u)
    const digestResult = verifyCaseBundle(badDigest)
    expect(digestResult.errors.join(' ')).toMatch(/request digest does not bind/u)
    expect(digestResult.verified.join(' ')).not.toMatch(/canonical request digests/u)
    expect(verifyCaseBundle(badRevision).errors).toContain(
      'Game event revision groups must increase contiguously by one.',
    )
    expect(verifyCaseBundle(duplicateKey).errors).toContain(
      'Client event idempotency keys must be unique within the bundle.',
    )
  })

  it('rejects impossible root ancestry and answered-game event revision binding', () => {
    const badRoot = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const identity = badRoot.data.identity as Record<string, CanonicalJson>
    identity.rootRunId = ROOT_ID
    const rootLifecycle = badRoot.data.lifecycle as Record<string, CanonicalJson>
    const rootRun = rootLifecycle.run as Record<string, CanonicalJson>
    rootRun.rootRunId = ROOT_ID
    rebuildManifest(badRoot)

    const badFinalRevision = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const finalGame = badFinalRevision.data.game as Record<string, CanonicalJson>
    const finalRecord = finalGame.record as Record<string, CanonicalJson>
    const finalReplay = finalGame.replay as Record<string, CanonicalJson>
    const finalEvents = finalReplay.events as Record<string, CanonicalJson>[]
    const lastProvenance = finalEvents.at(-1)!.provenance as Record<string, CanonicalJson>
    finalRecord.revision = lastProvenance.gameRevision!
    rebuildManifest(badFinalRevision)

    expect(verifyCaseBundle(badRoot).errors).toContain(
      'A root lifecycle run must identify itself as rootRunId.',
    )
    expect(verifyCaseBundle(badFinalRevision).errors).toContain(
      'A answered game revision must follow its last event revision.',
    )
  })

  it('rejects a rehashed terminal replay without a terminal summary', () => {
    const created = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const game = created.data.game as Record<string, CanonicalJson>
    game.terminalSummary = null
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'A terminal replay is missing its stored terminal summary.',
    )
  })

  it('rejects a self-consistent bundle whose move log is not canonical', () => {
    const rows = sourceRows()
    const first = { ...rows.events[0], toRing: 7, toSector: 7 }
    const created = bundle('metadata-only-v1', {
      events: [first, ...rows.events.slice(1)],
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Event 1|Illegal move|origin/u)
  })

  it('rejects missing provider links without contacting a provider', () => {
    const created = bundle('research-redacted-v1', {
      portiaReviews: [{
        id: '71000000-0000-4000-8000-000000000007',
        lifecycleRunId: RUN_ID,
        modelRequestId: '71000000-0000-4000-8000-000000000099',
        inputDigest: '5'.repeat(64),
        outputDigest: '6'.repeat(64),
        promptVersion: 'webchess-portia-v4',
        contractVersion: 'webchess-portia-review-v2',
        review: { private: PRIVATE_SENTINEL },
        createdAt: NOW,
      }],
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'portiaReviews[0] refers to a missing model request.',
    )
    expect(result.notVerified.join(' ')).toMatch(/live provider behavior/u)
  })

  it('rejects an impossible completed lifecycle with missing artifacts', () => {
    const created = bundle('metadata-only-v1', {
      portiaReviews: [],
      gateDecisions: [],
      charlotteResults: [],
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      'Lifecycle state charlotte_complete requires exactly one Portia review.',
      'Lifecycle state charlotte_complete requires exactly one Gate decision.',
      'Lifecycle state charlotte_complete requires exactly one Charlotte result.',
    ]))
  })

  it('rejects lifecycle versions that disagree with the game', () => {
    const rows = sourceRows()
    const created = bundle('metadata-only-v1', {
      lifecycleRun: {
        ...rows.lifecycleRun,
        rulesVersion: 'webchess-rules-incompatible',
      },
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Lifecycle rulesVersion does not match the bundled game.',
    )
  })

  it('preserves an upgraded Wilbur action with a null legacy Charlotte binding', () => {
    const rows = sourceRows()
    const created = bundle('research-redacted-v1', {
      lifecycleRun: { ...rows.lifecycleRun, state: 'wilbur_planning' },
      lifecycleActivities: activityRows([
        ...COMPLETE_LIFECYCLE_TRANSITIONS,
        ['charlotte_complete', 'wilbur_planning'],
      ]),
      wilburActions: [{
        id: '71000000-0000-4000-8000-000000000013',
        lifecycleRunId: RUN_ID,
        charlotteActionIndex: null,
        charlotteBindingVersion: null,
        requestDigest: 'a'.repeat(64),
        actor: `${PRIVATE_SENTINEL} actor`,
        action: `${PRIVATE_SENTINEL} action`,
        testedAssumption: `${PRIVATE_SENTINEL} assumption`,
        expectedObservation: `${PRIVATE_SENTINEL} observation`,
        decisionThreshold: `${PRIVATE_SENTINEL} threshold`,
        reviewHorizon: `${PRIVATE_SENTINEL} horizon`,
        status: 'planned',
        revision: '0',
        recordVersion: 'webchess-wilbur-v1',
        createdAt: NOW,
        updatedAt: NOW,
      }],
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(JSON.stringify(created)).not.toContain(PRIVATE_SENTINEL)
  })

  it('accepts the documented null-state bootstrap for a retry child run', () => {
    const initial = createReplayState()
    const created = bundle('metadata-only-v1', {
      game: {
        ...gameRow(initial),
        revision: '1',
        status: 'mapped',
        outcome: null,
        answer: null,
        completedAt: null,
        answeredAt: null,
      },
      events: [],
      lifecycleRun: {
        ...lifecycleRow(initial),
        rootRunId: ROOT_ID,
        parentRunId: '71000000-0000-4000-8000-000000000014',
        state: 'chess_ready',
        terminalFingerprint: null,
        answerPromptDigest: null,
        survivors: null,
      },
      portiaReviews: [],
      gateDecisions: [],
      charlotteResults: [],
      lifecycleActivities: [{
        id: '71000000-0000-4000-8000-000000000015',
        lifecycleRunId: RUN_ID,
        sequence: '1',
        stage: 'retry',
        activityType: 'same_field_retry_created',
        stateFrom: null,
        stateTo: 'chess_ready',
        inputEntityIds: ['71000000-0000-4000-8000-000000000014'],
        outputEntityIds: [RUN_ID],
        responsibleAgentIds: ['retry-policy'],
        configurationDigest: '3'.repeat(64),
        status: 'completed',
        eventVersion: 1,
        createdAt: NOW,
      }],
      modelRequests: [],
    })

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(true)
    expect(result.replay).toMatchObject({
      checked: true,
      completedPlies: 0,
      terminal: false,
    })
  })

  it('separates bundle integrity from local source compatibility', () => {
    const created = bundle('metadata-only-v1')
    const result = verifyCaseBundle(created, {
      packageName: 'webchess',
      packageVersion: '2.2.0-rc.1',
      sourceCommit: '9'.repeat(40),
      migrations: { '0001_durable_webchess': '8'.repeat(64) },
    })

    expect(result.errors).toContain(
      'The bundle source commit does not match this checkout.',
    )
    expect(result.errors).toContain(
      'Migration 0001_durable_webchess does not match this checkout.',
    )
  })

  it('rejects empty and gapped migration ledgers against local source', () => {
    const empty = bundle('metadata-only-v1', { migrations: [] })
    const gapped = bundle('metadata-only-v1', {
      migrations: [{
        id: '0001_durable_webchess',
        checksum: '4'.repeat(64),
        appliedAt: NOW,
      }, {
        id: '0003_lifecycle_gap',
        checksum: '6'.repeat(64),
        appliedAt: NOW,
      }],
    })
    const context = {
      packageName: 'webchess',
      packageVersion: '2.2.0-rc.1',
      sourceCommit: SOURCE_COMMIT,
      sourceTreeClean: true,
      migrations: {
        '0001_durable_webchess': '4'.repeat(64),
        '0002_webchess_2_lifecycle': '5'.repeat(64),
        '0003_lifecycle_gap': '6'.repeat(64),
      },
    }

    expect(verifyCaseBundle(empty, context).errors).toContain(
      'The bundle migration ledger is empty.',
    )
    expect(verifyCaseBundle(gapped, context).errors).toContain(
      'The bundle migration ledger is not an exact prefix of this checkout.',
    )
  })
})

import { describe, expect, it } from 'vitest'

import { getLegalMoves, hasLegalMove } from '../lib/game'
import type { GameEvent, ReplayState } from '../lib/game-contract'
import {
  acceptMoveCommand,
  createReplayState,
  replayGameEvents,
} from '../lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  CURRENT_METHOD_VERSION_TUPLE,
  deriveTrajectoryDirectionalRecord,
} from '../lib/lifecycle'
import {
  composeProblemParts,
  deriveDivisionCastAssignments,
} from '../lib/division'
import { makeProblemFacets, makeProblemParts } from '../test/fixtures'
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
const DIRECTIONAL_DIVISION_SEED = 'case-bundle-directional-seed'
const DIRECTIONAL_CAST_SEED = 'case-bundle-cast-seed'
const DIRECTIONAL_TRAJECTORY_SEED = 'case-bundle-trajectory-seed'
const directionalAssignments = new Map(
  deriveDivisionCastAssignments(DIRECTIONAL_DIVISION_SEED).map(
    (assignment) => [assignment.id, assignment],
  ),
)
const directionalFacets = makeProblemFacets(PRIVATE_SENTINEL).map((facet) => ({
  ...facet,
  castApplication: `Apply the cast direction by asking how ${
    directionalAssignments.get(facet.id)?.directionalCue ?? 'this lens'
  } changes the scrutiny path.`,
}))
const directionalParts = composeProblemParts(
  directionalFacets,
  DIRECTIONAL_DIVISION_SEED,
)

let cachedTerminal: ReplayState | null = null
let cachedKingCaptureTerminal: ReplayState | null = null

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

function kingCaptureTerminalState(): ReplayState {
  if (cachedKingCaptureTerminal) return cachedKingCaptureTerminal
  let state = createReplayState()
  const commands = [
    ['white-knight-1', 5, 2],
    ['black-pawn-1', 3, 0],
    ['white-knight-1', 3, 3],
    ['black-pawn-2', 3, 1],
    ['white-knight-1', 2, 5],
    ['black-pawn-3', 3, 2],
    ['white-knight-1', 0, 4],
  ] as const
  for (const [pieceId, ring, sector] of commands) {
    state = acceptMoveCommand(state, {
      expectedPly: state.completedPlies + 1,
      pieceId,
      to: { ring, sector },
    }, parts).state
  }
  if (state.outcome?.reason !== 'king-captured' || !state.outcome.terminalCapture) {
    throw new Error('The king-capture case fixture did not preserve its terminal capture.')
  }
  cachedKingCaptureTerminal = state
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
    researchConsentVersion: 'webchess-research-consent-v1',
    researchConsentDecision: 'allow_search_and_page_fetch',
    researchConsentRecordedAt: NOW,
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

function directionalSourceRows(): CaseBundleSourceRows {
  const legacy = sourceRows()
  const state = replayGameEvents(terminalState().events, directionalParts)
  const game = {
    ...gameRow(state),
    divisionSeed: DIRECTIONAL_DIVISION_SEED,
    divisionFacets: directionalFacets,
    problemParts: directionalParts,
    divisionPromptVersion: CURRENT_METHOD_VERSION_TUPLE.divisionPrompt,
  }
  const lifecycleBase = {
    ...lifecycleRow(state),
    divisionSeed: DIRECTIONAL_DIVISION_SEED,
    castSeed: DIRECTIONAL_CAST_SEED,
    trajectorySeed: DIRECTIONAL_TRAJECTORY_SEED,
    softwareVersion: CURRENT_LIFECYCLE_VERSIONS.software,
    lifecycleVersion: CURRENT_LIFECYCLE_VERSIONS.lifecycle,
    portiaPromptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
    portiaContractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    gateAlgorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
    retryPolicyVersion: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
    charlottePromptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
    charlotteContractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    wilburRecordVersion: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
  }
  const record = deriveTrajectoryDirectionalRecord({
    divisionDigest: 'd'.repeat(64),
    divisionSeed: DIRECTIONAL_DIVISION_SEED,
    castSeed: DIRECTIONAL_CAST_SEED,
    trajectorySeed: DIRECTIONAL_TRAJECTORY_SEED,
    versions: state.versions,
    parts: directionalParts,
    events: state.events,
  })
  const lifecycleRun = {
    ...lifecycleBase,
    trajectoryDirectionalRecordVersion: record.version,
    trajectoryDirectionalRecordDigest: record.digest,
    trajectoryDirectionalRecord: record,
  }
  return {
    ...legacy,
    game,
    events: eventRows(state.events),
    lifecycleRun,
    portiaReviews: legacy.portiaReviews.map((review) => ({
      ...review,
      promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    })),
    gateDecisions: legacy.gateDecisions.map((decision) => ({
      ...decision,
      algorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
    })),
    charlotteResults: legacy.charlotteResults.map((result) => ({
      ...result,
      promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    })),
    modelRequests: legacy.modelRequests.map((request) => ({
      ...request,
      promptVersion: request.operation === 'portia'
        ? CURRENT_LIFECYCLE_VERSIONS.portiaPrompt
        : request.operation === 'charlotte'
          ? CURRENT_LIFECYCLE_VERSIONS.charlottePrompt
          : request.promptVersion,
    })),
  }
}

function researchFailureRows(): Pick<
  CaseBundleSourceRows,
  'researchRequests' | 'researchSources'
> {
  const researchRequestId = '71000000-0000-4000-8000-000000000060'
  const requestedUrl = 'https://example.edu/private-case-evidence'
  return {
    researchRequests: [{
      id: researchRequestId,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      stage: 'portia',
      requestedBy: 'research-policy',
      policyVersion: 'webchess-research-policy-v1',
      researchConsentVersion: 'webchess-research-consent-v1',
      researchConsentDecision: 'allow_search_and_page_fetch',
      researchConsentRecordedAt: NOW,
      materiality: 'required',
      reason: `${PRIVATE_SENTINEL} research reason`,
      query: `${PRIVATE_SENTINEL} research query`,
      status: 'completed',
      provider: 'codex',
      transport: 'local',
      model: 'gpt-5.6-sol',
      invocationLimit: 1,
      resultLimit: 5,
      sourceLimit: 8,
      timeoutMs: 90_000,
      synthesisCharacterLimit: 12_000,
      attemptCount: 1,
      executedQueries: [`${PRIVATE_SENTINEL} research query`],
      searchSynthesis: `${PRIVATE_SENTINEL} search synthesis`,
      directPageTextFetched: false,
      retrievedFacts: [],
      fetchFailures: [{
        citationId: 'R1',
        requestedUrl,
        finalUrl: requestedUrl,
        status: 'failed',
        failureCode: 'page_fetch_http_status',
        httpStatus: 503,
        fetchVersion: 'webchess-direct-page-fetch-v1',
        extractor: 'webchess-readable-text-v1',
        rawByteLength: 0,
        rawContentDigest: null,
        rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
        acceptedCharacterLength: 0,
        truncated: false,
        contentDigest: null,
        digestAlgorithm: 'sha256-utf8-accepted-text-v1',
        redirectChain: [requestedUrl],
        injectionSignalsDetected: [],
        retrievedAt: NOW,
      }],
      omittedSourceCount: 0,
      injectionSignals: [],
      contentDigest: '8'.repeat(64),
      failureCode: null,
      startedAt: NOW,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    researchSources: [{
      id: '71000000-0000-4000-8000-000000000061',
      researchRequestId,
      ordinal: 1,
      citationId: 'R1',
      title: `${PRIVATE_SENTINEL} source title`,
      url: requestedUrl,
      hostname: 'example.edu',
      trust: 'government_or_education',
      discoveredFrom: 'search_activity',
      createdAt: NOW,
    }],
  }
}

function researchFactRows(): Pick<
  CaseBundleSourceRows,
  'researchRequests' | 'researchSources'
> {
  const rows = researchFailureRows()
  const request = rows.researchRequests[0]!
  const requestedUrl = 'https://example.edu/private-case-evidence'
  const text = 'Bounded directly retrieved evidence.'
  return {
    ...rows,
    researchRequests: [{
      ...request,
      directPageTextFetched: true,
      retrievedFacts: [{
        citationId: 'R1',
        requestedUrl,
        finalUrl: requestedUrl,
        title: 'Direct evidence',
        provider: 'webchess-direct-https',
        fetchVersion: 'webchess-direct-page-fetch-v1',
        retrievedAt: NOW,
        httpStatus: 200,
        contentType: 'text/html',
        extractor: 'webchess-readable-text-v1',
        rawByteLength: text.length,
        rawContentDigest: sha256Hex(text),
        rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
        acceptedCharacterLength: text.length,
        contentDigest: sha256Hex(text),
        digestAlgorithm: 'sha256-utf8-accepted-text-v1',
        redirectChain: [requestedUrl],
        text,
        truncated: false,
        untrusted: true,
        contentKind: 'direct_page_text',
      }],
      fetchFailures: [],
    }],
  }
}

function researchOptOutRows(): Pick<
  CaseBundleSourceRows,
  'game' | 'researchRequests' | 'researchSources'
> {
  const rows = sourceRows()
  const research = researchFailureRows()
  const request = research.researchRequests[0]!
  return {
    game: {
      ...rows.game,
      researchConsentDecision: 'no_external_research',
    },
    researchRequests: [{
      ...request,
      researchConsentDecision: 'no_external_research',
      materiality: null,
      query: null,
      status: 'not_needed',
      model: null,
      attemptCount: 0,
      executedQueries: [],
      searchSynthesis: null,
      directPageTextFetched: false,
      retrievedFacts: [],
      fetchFailures: [],
      omittedSourceCount: 0,
      injectionSignals: [],
      contentDigest: null,
      failureCode: null,
      startedAt: null,
      completedAt: NOW,
    }],
    researchSources: [],
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

function directionalBundle(
  profile: 'private-full-v1' | 'research-redacted-v1' | 'metadata-only-v1',
) {
  return createCaseBundle({
    ...directionalSourceRows(),
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

  it('exports and independently rederives the exact private trajectory directional record', () => {
    const created = directionalBundle('private-full-v1')
    const result = verifyCaseBundle(created)
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const evidence = lifecycle.trajectoryDirectionalRecord as Record<
      string,
      CanonicalJson
    >

    expect(result.errors).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(created), 'utf8')).toBeLessThanOrEqual(
      3_000_000,
    )
    expect(evidence).toMatchObject({
      format: 'webchess-case-trajectory-direction/1',
      status: 'bound',
      recordAvailability: 'exact_record_included',
      recordOmission: null,
      version: 'webchess-directional-record-v1',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fieldPartsDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      eventStreamDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      epistemicBoundary: expect.objectContaining({
        classification: 'directional-input-not-factual-evidence',
      }),
    })
    expect(evidence.record).toMatchObject({
      digest: evidence.digest,
      field: { partsDigest: evidence.fieldPartsDigest },
      trajectory: { eventStreamDigest: evidence.eventStreamDigest },
    })
    expect(result.verified).toContain(
      'exact trajectory directional record rederived from immutable Division parts and canonical game events',
    )
  })

  it.each([
    'research-redacted-v1',
    'metadata-only-v1',
  ] as const)('exports an explicit non-recomputable directional omission for %s', (profile) => {
    const created = directionalBundle(profile)
    const result = verifyCaseBundle(created)
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>

    expect(result.errors).toEqual([])
    expect(lifecycle.trajectoryDirectionalRecord).toMatchObject({
      status: 'bound',
      recordAvailability: 'profile_omitted',
      recordOmission: 'profile_omitted_exact_record',
      version: 'webchess-directional-record-v1',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fieldPartsDigest: null,
      eventStreamDigest: null,
      record: null,
      epistemicBoundary: expect.objectContaining({
        classification: 'directional-input-not-factual-evidence',
      }),
    })
    expect(result.notVerified.join(' ')).toMatch(
      /directional record recomputation.*omitted/u,
    )
    expect(JSON.stringify(created)).not.toContain(
      directionalParts[0]?.castApplication ?? PRIVATE_SENTINEL,
    )
  })

  it('rejects rehashed directional digest, parts, event, seed, and version tampering', () => {
    const mutations: readonly (readonly [
      string,
      (evidence: Record<string, CanonicalJson>) => void,
    ])[] = [
      ['digest', (evidence) => {
        evidence.digest = 'a'.repeat(64)
      }],
      ['parts digest', (evidence) => {
        evidence.fieldPartsDigest = 'a'.repeat(64)
      }],
      ['event-stream digest', (evidence) => {
        evidence.eventStreamDigest = 'a'.repeat(64)
      }],
      ['seed', (evidence) => {
        const record = evidence.record as Record<string, CanonicalJson>
        const cast = record.cast as Record<string, CanonicalJson>
        cast.lifecycleSeed = 'alternate-cast-seed'
      }],
      ['version', (evidence) => {
        evidence.version = 'webchess-directional-record-v0'
      }],
    ]

    for (const [label, mutate] of mutations) {
      const created = structuredClone(
        directionalBundle('private-full-v1'),
      ) as unknown as MutableBundle
      const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
      const evidence = lifecycle.trajectoryDirectionalRecord as Record<
        string,
        CanonicalJson
      >
      mutate(evidence)
      rebuildManifest(created)

      expect(
        verifyCaseBundle(created).errors.join(' '),
        label,
      ).toMatch(/trajectory directional record/iu)
    }
  })

  it('rejects a self-consistent alternate legal directional record for another trajectory', () => {
    const created = structuredClone(
      directionalBundle('private-full-v1'),
    ) as unknown as MutableBundle
    const alternateState = replayGameEvents(
      kingCaptureTerminalState().events,
      directionalParts,
    )
    const alternate = deriveTrajectoryDirectionalRecord({
      divisionDigest: 'd'.repeat(64),
      divisionSeed: DIRECTIONAL_DIVISION_SEED,
      castSeed: DIRECTIONAL_CAST_SEED,
      trajectorySeed: DIRECTIONAL_TRAJECTORY_SEED,
      versions: alternateState.versions,
      parts: directionalParts,
      events: alternateState.events,
    })
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const evidence = lifecycle.trajectoryDirectionalRecord as Record<
      string,
      CanonicalJson
    >
    evidence.version = alternate.version
    evidence.digest = alternate.digest
    evidence.fieldPartsDigest = alternate.field.partsDigest
    evidence.eventStreamDigest = alternate.trajectory.eventStreamDigest
    evidence.record = alternate as unknown as CanonicalJson
    rebuildManifest(created)

    expect(verifyCaseBundle(created).errors).toContain(
      'Trajectory directional record does not match the bundled Division parts and canonical game events.',
    )
  })

  it('labels v2.4 cases without fabrication and accepts their pre-envelope schema', () => {
    const created = structuredClone(
      bundle('private-full-v1'),
    ) as unknown as MutableBundle
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>

    expect(lifecycle.trajectoryDirectionalRecord).toMatchObject({
      status: 'legacy_pre_directional_generation',
      recordAvailability: 'not_generated',
      recordOmission: 'legacy_pre_directional_generation',
      version: null,
      digest: null,
      record: null,
    })
    expect(verifyCaseBundle(created).errors).toEqual([])

    delete lifecycle.trajectoryDirectionalRecord
    rebuildManifest(created)
    const oldSchema = verifyCaseBundle(created)
    expect(oldSchema.errors).toEqual([])
    expect(oldSchema.warnings.join(' ')).toMatch(/LEGACY DIRECTIONAL WARNING/u)
    expect(oldSchema.notVerified.join(' ')).toMatch(
      /no directional record was generated or exported/u,
    )
  })

  it('rejects cross-labelling a bound current record as lifecycle v2.4', () => {
    const created = structuredClone(
      directionalBundle('private-full-v1'),
    ) as unknown as MutableBundle
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const run = lifecycle.run as Record<string, CanonicalJson>
    run.lifecycleVersion = 'webchess-lifecycle-v2.4'
    rebuildManifest(created)

    expect(verifyCaseBundle(created).errors.join(' ')).toMatch(
      /Bound trajectory directional record provenance is invalid|Lifecycle .* unsupported/u,
    )
  })

  it.each([
    'private-full-v1',
    'research-redacted-v1',
    'metadata-only-v1',
  ] as const)('continues to verify a pre-provenance %s bundle', (profile) => {
    const created = structuredClone(bundle(
      profile,
      profile === 'private-full-v1' ? researchFailureRows() : {},
    )) as unknown as MutableBundle
    const game = created.data.game as Record<string, CanonicalJson>
    const gameRecord = game.record as Record<string, CanonicalJson>
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const researchRequests = lifecycle.researchRequests as Record<
      string,
      CanonicalJson
    >[]
    const redaction = created.data.redaction as Record<string, CanonicalJson>
    const allowlists = redaction.allowlists as Record<string, CanonicalJson>
    const provenanceFields = new Set([
      'researchConsentVersion',
      'researchConsentDecision',
      'researchConsentRecordedAt',
    ])
    for (const field of provenanceFields) delete gameRecord[field]
    allowlists.gameRecord = (allowlists.gameRecord as string[])
      .filter((field) => !provenanceFields.has(field))
    allowlists.researchRequests = (allowlists.researchRequests as string[])
      .filter((field) => !provenanceFields.has(field) && field !== 'fetchFailures')
    for (const request of researchRequests) {
      for (const field of provenanceFields) delete request[field]
      delete request.fetchFailures
    }
    redaction.omissions = (
      redaction.omissions as Record<string, CanonicalJson>[]
    ).filter(
      (row) => row.path !==
        '/data/lifecycle/researchRequests/*/fetchFailures',
    )
    rebuildManifest(created)

    const legacyResult = verifyCaseBundle(created)
    expect(legacyResult.errors).toEqual([])
    expect(legacyResult.warnings.join(' ')).toMatch(
      /LEGACY PROVENANCE WARNING/u,
    )
    expect(legacyResult.notVerified.join(' ')).toMatch(
      /research-consent provenance.*fetch-failure history/u,
    )
    if (profile === 'private-full-v1') {
      const legacyRequest = researchRequests[0]!
      const factRequest = researchFactRows().researchRequests[0]!
      legacyRequest.directPageTextFetched = true
      legacyRequest.retrievedFacts = structuredClone(
        factRequest.retrievedFacts,
      ) as CanonicalJson
      rebuildManifest(created)
      expect(verifyCaseBundle(created).errors).toContain(
        'data.lifecycle.researchRequests[0] legacy retrievedFacts must be empty.',
      )
    }
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
      '/data/lifecycle/researchRequests/*/reason',
      '/data/lifecycle/wilburActions/*/action',
      '/data/lifecycle/wilburObservations/*/observation',
      '/data/providerInvocations/modelRequests/*/idempotencyKey',
      '/data/providerInvocations/modelRequests/*/providerResponseId',
      '/data/providerInvocations/modelRequests/*/resultPayload',
    ]) {
      expect(JSON.stringify(redacted.data.redaction)).toContain(omittedPath)
    }
  })

  it('retains consent and fetch-failure provenance only where the profile allows it', () => {
    const research = researchFailureRows()
    const privateBundle = bundle('private-full-v1', research)
    const redacted = bundle('research-redacted-v1', research)

    expect(verifyCaseBundle(privateBundle).errors).toEqual([])
    expect(verifyCaseBundle(redacted).errors).toEqual([])
    expect(privateBundle.data.lifecycle).toMatchObject({
      researchRequests: [{
        researchConsentVersion: 'webchess-research-consent-v1',
        researchConsentDecision: 'allow_search_and_page_fetch',
        researchConsentRecordedAt: NOW,
        fetchFailures: [{
          citationId: 'R1',
          failureCode: 'page_fetch_http_status',
        }],
      }],
    })
    expect(redacted.data.lifecycle).toMatchObject({
      researchRequests: [{
        researchConsentVersion: 'webchess-research-consent-v1',
        researchConsentDecision: 'allow_search_and_page_fetch',
        researchConsentRecordedAt: NOW,
      }],
    })
    expect(JSON.stringify(redacted)).not.toContain('private-case-evidence')
    const redaction = redacted.data.redaction as Record<string, CanonicalJson>
    expect(redaction.omissions).toContainEqual(expect.objectContaining({
      path: '/data/lifecycle/researchRequests/*/fetchFailures',
      omittedCount: 1,
    }))
  })

  it('states which direct-page network history cannot be established offline', () => {
    const created = bundle('private-full-v1', researchFailureRows())
    const result = verifyCaseBundle(created)

    expect(result.errors).toEqual([])
    expect(result.notVerified.join(' ')).toMatch(
      /Historical DNS resolution.*pinned connection peer.*TLS negotiation.*retrieval event/u,
    )
    expect(created.data.verificationBoundary).toMatchObject({
      doesNotVerify: expect.arrayContaining([
        expect.stringMatching(/Historical DNS resolution/u),
      ]),
    })
  })

  it.each([
    ['an IP literal', 'https://127.0.0.1/private-case-evidence', '127.0.0.1', 'general_web'],
    ['a local hostname', 'https://metadata.internal/private-case-evidence', 'metadata.internal', 'general_web'],
    ['a custom port', 'https://example.edu:444/private-case-evidence', 'example.edu', 'government_or_education'],
    ['a noncanonical tracking query', 'https://example.edu/private-case-evidence?utm_source=test', 'example.edu', 'government_or_education'],
  ] as const)(
    'rejects a rehashed direct-page route using %s',
    (_name, url, hostname, trust) => {
      const created = structuredClone(
        bundle('private-full-v1', researchFailureRows()),
      ) as unknown as MutableBundle
      const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
      const request = (
        lifecycle.researchRequests as Record<string, CanonicalJson>[]
      )[0]!
      const failure = (
        request.fetchFailures as Record<string, CanonicalJson>[]
      )[0]!
      const source = (
        lifecycle.researchSources as Record<string, CanonicalJson>[]
      )[0]!
      failure.requestedUrl = url
      failure.finalUrl = url
      failure.redirectChain = [url]
      source.url = url
      source.hostname = hostname
      source.trust = trust
      rebuildManifest(created)

      const result = verifyCaseBundle(created)
      expect(result.errors).toContain(
        'data.lifecycle.researchRequests[0].fetchFailures[0] has an invalid direct-page URL or redirect chain.',
      )
      expect(result.errors).toContain(
        'researchSources[0] violates the canonical research-source provenance contract.',
      )
    },
  )

  it('rejects rehashed source hostname, trust, and ordinal provenance', () => {
    const mutateSource = (
      mutate: (
        source: Record<string, CanonicalJson>,
        failure: Record<string, CanonicalJson>,
      ) => void,
    ) => {
      const created = structuredClone(
        bundle('private-full-v1', researchFailureRows()),
      ) as unknown as MutableBundle
      const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
      const request = (
        lifecycle.researchRequests as Record<string, CanonicalJson>[]
      )[0]!
      const failure = (
        request.fetchFailures as Record<string, CanonicalJson>[]
      )[0]!
      const source = (
        lifecycle.researchSources as Record<string, CanonicalJson>[]
      )[0]!
      mutate(source, failure)
      rebuildManifest(created)
      return verifyCaseBundle(created)
    }

    const hostname = mutateSource((source) => {
      source.hostname = 'other.edu'
    })
    const trust = mutateSource((source) => {
      source.trust = 'general_web'
    })
    const ordinal = mutateSource((source, failure) => {
      source.ordinal = 2
      source.citationId = 'R2'
      failure.citationId = 'R2'
    })

    expect(hostname.errors).toContain(
      'researchSources[0] violates the canonical research-source provenance contract.',
    )
    expect(hostname.errors).toContain(
      'researchRequests[0] direct-page evidence does not match its disclosed source citation and URL.',
    )
    expect(trust.errors).toContain(
      'researchSources[0] violates the canonical research-source provenance contract.',
    )
    expect(ordinal.errors).toContain(
      `researchSources ordinals must be contiguous from 1 for request ${String(researchFailureRows().researchRequests[0]!.id)}.`,
    )
  })

  it('rejects a rehashed current opt-out with completed research evidence', () => {
    const created = structuredClone(
      bundle('private-full-v1', researchOptOutRows()),
    ) as unknown as MutableBundle
    expect(verifyCaseBundle(created).errors).toEqual([])

    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const request = (
      lifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const research = researchFailureRows()
    request.status = 'completed'
    request.materiality = 'required'
    request.query = 'A query that must not survive current opt-out.'
    request.model = 'gpt-5.6-sol'
    request.attemptCount = 1
    request.executedQueries = ['A query that must not survive current opt-out.']
    request.searchSynthesis = 'Synthesis that must not survive current opt-out.'
    request.fetchFailures = structuredClone(
      research.researchRequests[0]!.fetchFailures,
    ) as CanonicalJson
    request.contentDigest = '8'.repeat(64)
    request.startedAt = NOW
    lifecycle.researchSources = structuredClone(
      research.researchSources,
    ) as CanonicalJson
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.errors).toContain(
      'data.lifecycle.researchRequests[0] violates the current research opt-out invariants.',
    )
    expect(result.errors).toContain(
      'data.lifecycle.researchRequests[0] contains direct-page evidence despite research opt-out.',
    )
    expect(result.errors).toContain(
      'researchSources[0] retains source evidence despite current research opt-out.',
    )
  })

  it('rejects rehashed direct-page evidence detached from its source route', () => {
    const mismatchedSource = structuredClone(
      bundle('private-full-v1', researchFailureRows()),
    ) as unknown as MutableBundle
    const mismatchLifecycle = mismatchedSource.data.lifecycle as Record<
      string,
      CanonicalJson
    >
    const mismatchRequest = (
      mismatchLifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const mismatchFailure = (
      mismatchRequest.fetchFailures as Record<string, CanonicalJson>[]
    )[0]!
    mismatchFailure.requestedUrl = 'https://example.edu/different-evidence'
    mismatchFailure.finalUrl = 'https://example.edu/different-evidence'
    mismatchFailure.redirectChain = ['https://example.edu/different-evidence']
    rebuildManifest(mismatchedSource)

    const duplicateCitation = structuredClone(
      bundle('private-full-v1', researchFailureRows()),
    ) as unknown as MutableBundle
    const duplicateLifecycle = duplicateCitation.data.lifecycle as Record<
      string,
      CanonicalJson
    >
    const duplicateRequest = (
      duplicateLifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const duplicateFailures = duplicateRequest.fetchFailures as Record<
      string,
      CanonicalJson
    >[]
    duplicateFailures.push(structuredClone(duplicateFailures[0]!))
    rebuildManifest(duplicateCitation)

    const crossHost = structuredClone(
      bundle('private-full-v1', researchFailureRows()),
    ) as unknown as MutableBundle
    const crossHostLifecycle = crossHost.data.lifecycle as Record<
      string,
      CanonicalJson
    >
    const crossHostRequest = (
      crossHostLifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const crossHostFailure = (
      crossHostRequest.fetchFailures as Record<string, CanonicalJson>[]
    )[0]!
    crossHostFailure.finalUrl = 'https://other.org/evidence'
    crossHostFailure.redirectChain = [
      'https://example.edu/private-case-evidence',
      'https://other.org/evidence',
    ]
    rebuildManifest(crossHost)

    const invalidFact = structuredClone(
      bundle('private-full-v1', researchFactRows()),
    ) as unknown as MutableBundle
    const factLifecycle = invalidFact.data.lifecycle as Record<string, CanonicalJson>
    const factRequest = (
      factLifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const fact = (
      factRequest.retrievedFacts as Record<string, CanonicalJson>[]
    )[0]!
    fact.httpStatus = 201
    rebuildManifest(invalidFact)

    const nullFinalFact = structuredClone(
      bundle('private-full-v1', researchFactRows()),
    ) as unknown as MutableBundle
    const nullFinalLifecycle = nullFinalFact.data.lifecycle as Record<
      string,
      CanonicalJson
    >
    const nullFinalRequest = (
      nullFinalLifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const factWithoutFinalUrl = (
      nullFinalRequest.retrievedFacts as Record<string, CanonicalJson>[]
    )[0]!
    factWithoutFinalUrl.finalUrl = null
    rebuildManifest(nullFinalFact)

    expect(verifyCaseBundle(mismatchedSource).errors).toContain(
      'researchRequests[0] direct-page evidence does not match its disclosed source citation and URL.',
    )
    expect(verifyCaseBundle(duplicateCitation).errors).toContain(
      'researchRequests[0] contains duplicate direct-page evidence for R1.',
    )
    expect(verifyCaseBundle(crossHost).errors).toContain(
      'data.lifecycle.researchRequests[0].fetchFailures[0] contains a cross-host redirect.',
    )
    expect(verifyCaseBundle(invalidFact).errors).toContain(
      'data.lifecycle.researchRequests[0].retrievedFacts[0] has an invalid directly-retrieved fact shape.',
    )
    expect(verifyCaseBundle(nullFinalFact).errors).toContain(
      'data.lifecycle.researchRequests[0].retrievedFacts[0] has an invalid directly-retrieved fact shape.',
    )
  })

  it('records field-level counts for omitted lifecycle, outcome, and provider identifiers', () => {
    const rows = sourceRows()
    const redacted = bundle('research-redacted-v1', {
      lifecycleRun: {
        ...rows.lifecycleRun,
        retryReason: `${PRIVATE_SENTINEL} retry reason`,
        survivors: [{ private: PRIVATE_SENTINEL }, { private: PRIVATE_SENTINEL }],
        portiaAssessmentDrafts: [{ private: PRIVATE_SENTINEL }],
      },
    })
    const redaction = redacted.data.redaction as Record<string, CanonicalJson>
    const omissions = redaction.omissions as Record<string, CanonicalJson>[]
    const byPath = new Map(omissions.map((row) => [row.path, row.omittedCount]))

    expect(omissions).toHaveLength(44)
    expect(Object.fromEntries(byPath)).toMatchObject({
      '/data/game/record/outcome': 1,
      '/data/lifecycle/run/retryReason': 1,
      '/data/lifecycle/run/survivors': 2,
      '/data/lifecycle/run/portiaAssessmentDrafts': 1,
      '/data/providerInvocations/modelRequests/*/idempotencyKey': 3,
      '/data/providerInvocations/modelRequests/*/providerResponseId': 3,
      '/data/providerInvocations/modelRequests/*/resultPayload': 3,
    })
    expect([...byPath.keys()].some((path) => String(path).includes('('))).toBe(false)
    expect(JSON.stringify(redacted)).not.toContain(PRIVATE_SENTINEL)
  })

  it('refuses to report zero when an omitted source field was not queried', () => {
    const rows = sourceRows()
    const game = { ...rows.game }
    delete game.outcome

    expect(() => bundle('research-redacted-v1', { game })).toThrow(
      'The omission source is missing /data/game/record/outcome.',
    )
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

  it.each([
    ['portiaFailedAttemptCount', null],
    ['portiaFailedAttemptCount', -1],
    ['portiaFailureLimit', null],
    ['portiaFailureLimit', 0],
    ['charlotteFailedAttemptCount', 4],
    ['charlotteFailureLimit', 11],
  ])('rejects a rehashed invalid %s budget value', (field, value) => {
    const created = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const run = lifecycle.run as Record<string, CanonicalJson>
    run[field] = value
    if (field === 'charlotteFailedAttemptCount') {
      run.charlotteFailureLimit = 3
    }
    rebuildManifest(created)

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

  it('also requires Portia unavailable to exactly exhaust its budget after rehashing', () => {
    const created = structuredClone(bundle('metadata-only-v1')) as unknown as MutableBundle
    const lifecycle = created.data.lifecycle as Record<string, CanonicalJson>
    const run = lifecycle.run as Record<string, CanonicalJson>
    run.state = 'portia_unavailable'
    run.portiaFailedAttemptCount = 2
    run.portiaFailureLimit = 3
    rebuildManifest(created)

    const result = verifyCaseBundle(created)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Portia unavailable requires an exactly exhausted failure budget.',
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

  it('verifies a private king-capture outcome and rejects terminal-capture tampering', () => {
    const state = kingCaptureTerminalState()
    const created = bundle('private-full-v1', {
      game: gameRow(state),
      events: eventRows(state.events),
      lifecycleRun: lifecycleRow(state),
    })

    expect(verifyCaseBundle(created).errors).toEqual([])

    const tampered = structuredClone(created) as unknown as MutableBundle
    const game = tampered.data.game as Record<string, CanonicalJson>
    const record = game.record as Record<string, CanonicalJson>
    const outcome = record.outcome as Record<string, CanonicalJson>
    const terminalCapture = outcome.terminalCapture as Record<string, CanonicalJson>
    terminalCapture.turn = 8
    rebuildManifest(tampered)

    expect(verifyCaseBundle(tampered).errors).toContain(
      'The private game outcome does not match the replayed terminal outcome.',
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

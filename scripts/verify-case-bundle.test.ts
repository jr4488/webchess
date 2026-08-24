import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { getLegalMoves } from '../src/lib/game'
import {
  acceptMoveCommand,
  createReplayState,
} from '../src/lib/game-replay'
import { makeProblemParts } from '../src/test/fixtures'
import {
  createCaseBundle,
} from '../src/server/case-bundle'

const execFileAsync = promisify(execFile)
const GAME_ID = '73000000-0000-4000-8000-000000000001'
const RUN_ID = '73000000-0000-4000-8000-000000000002'
const NOW = '2026-08-24T01:00:00.000Z'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function checksum(sql: string): string {
  return createHash('sha256')
    .update(`${sql.replace(/\r\n?/gu, '\n').trim()}\n`)
    .digest('hex')
}

async function migrations() {
  const names = (await readdir('db/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
  return Promise.all(names.map(async (name) => ({
    id: name.slice(0, -4),
    checksum: checksum(await readFile(path.join('db/migrations', name), 'utf8')),
    appliedAt: NOW,
  })))
}

async function fixtureBundle() {
  const parts = makeProblemParts('case-cli')
  const initial = createReplayState()
  const piece = initial.pieces.find((candidate) =>
    candidate.side === initial.turn && getLegalMoves(candidate, initial.pieces).length > 0)
  if (!piece) throw new Error('CLI fixture has no legal piece.')
  const to = getLegalMoves(piece, initial.pieces)[0]
  if (!to) throw new Error('CLI fixture has no legal destination.')
  const accepted = acceptMoveCommand(initial, {
    expectedPly: 1,
    pieceId: piece.id,
    to,
  }, parts)
  const event = accepted.state.events[0]
  if (!event || event.type !== 'move') throw new Error('CLI fixture move is missing.')
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()

  return createCaseBundle({
    profile: 'metadata-only-v1',
    exportedAt: NOW,
    packageName: 'webchess',
    packageVersion: '2.2.0-rc.1',
    sourceCommit,
    game: {
      id: GAME_ID,
      sourceGameId: null,
      revision: '3',
      status: 'playing',
      problem: 'Which bounded case should this CLI verify without a provider?',
      problemSha256: 'a'.repeat(64),
      divisionSeed: 'division-seed',
      divisionFacets: [],
      problemParts: parts,
      divisionModel: 'configured-default',
      divisionPromptVersion: 'division-v1',
      divisionPromptSha256: 'b'.repeat(64),
      divisionDigest: 'c'.repeat(64),
      rulesVersion: accepted.state.versions.rules,
      engineVersion: accepted.state.versions.engine,
      castVersion: accepted.state.versions.cast,
      eventVersion: accepted.state.versions.event,
      softwareVersion: 'webchess@2.2.0-rc.1-openclaw',
      outcome: null,
      answer: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      answeredAt: null,
    },
    events: [{
      gameId: GAME_ID,
      ply: 1,
      kind: 'move',
      source: 'client',
      side: event.side,
      pieceId: event.pieceId,
      capturedPieceId: event.capturedPieceId ?? null,
      promotedTo: event.promotedTo ?? null,
      fromRing: event.from.ring,
      fromSector: event.from.sector,
      toRing: event.to.ring,
      toSector: event.to.sector,
      idempotencyKey: '73000000-0000-4000-8000-000000000003',
      requestSha256: 'd'.repeat(64),
      gameRevision: '3',
      createdAt: NOW,
    }],
    lifecycleRun: {
      id: RUN_ID,
      gameId: GAME_ID,
      rootRunId: RUN_ID,
      parentRunId: null,
      state: 'chess_playing',
      revision: '1',
      fieldGeneration: 1,
      gameAttempt: 1,
      sameFieldRetryCount: 0,
      fieldRegenerationCount: 0,
      divisionSeed: 'division-seed',
      castSeed: 'cast-seed',
      trajectorySeed: 'trajectory-seed',
      retryReason: null,
      terminalFingerprint: null,
      answerPromptDigest: null,
      survivors: null,
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
      rulesVersion: accepted.state.versions.rules,
      engineVersion: accepted.state.versions.engine,
      castVersion: accepted.state.versions.cast,
      eventVersion: accepted.state.versions.event,
      portiaPromptVersion: 'webchess-portia-v4',
      portiaContractVersion: 'webchess-portia-review-v2',
      gateAlgorithmVersion: 'webchess-gate-v4',
      retryPolicyVersion: 'webchess-retry-v2',
      charlottePromptVersion: 'webchess-charlotte-v4',
      charlotteContractVersion: 'webchess-charlotte-result-v1',
      wilburRecordVersion: 'webchess-wilbur-v1',
      createdAt: NOW,
      updatedAt: NOW,
    },
    researchRequests: [],
    researchSources: [],
    portiaReviews: [],
    gateDecisions: [],
    charlotteResults: [],
    wilburActions: [],
    wilburObservations: [],
    lifecycleActivities: [
      ['anansi_pending', 'anansi_running'],
      ['anansi_running', 'field_ready'],
      ['field_ready', 'chess_ready'],
      ['chess_ready', 'chess_playing'],
    ].map(([stateFrom, stateTo], index) => ({
      id: `73000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
      lifecycleRunId: RUN_ID,
      sequence: String(index + 1),
      stage: stateTo.startsWith('anansi') || stateTo === 'field_ready'
        ? 'anansi'
        : 'chess',
      activityType: `fixture_transition_${index + 1}`,
      stateFrom,
      stateTo,
      inputEntityIds: [GAME_ID],
      outputEntityIds: [RUN_ID],
      responsibleAgentIds: ['fixture-agent'],
      configurationDigest: 'e'.repeat(64),
      status: 'completed',
      eventVersion: 1,
      createdAt: NOW,
    })),
    modelRequests: [],
    migrations: await migrations(),
  })
}

describe('case:verify CLI', () => {
  it('verifies a bundle offline and exits nonzero after tampering', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'webchess-case-cli-'))
    temporaryDirectories.push(directory)
    const bundlePath = path.join(directory, 'case.json')
    const created = await fixtureBundle()
    await writeFile(bundlePath, `${JSON.stringify(created, null, 2)}\n`)

    const success = await execFileAsync(
      process.execPath,
      ['scripts/verify-case-bundle.mjs', bundlePath],
      { cwd: process.cwd(), maxBuffer: 2_000_000 },
    )
    expect(JSON.parse(success.stdout)).toMatchObject({
      ok: true,
      profile: 'metadata-only-v1',
      replay: { checked: true, completedPlies: 1 },
    })

    const tampered = structuredClone(created) as unknown as {
      data: { identity: { gameId: string } }
    }
    tampered.data.identity.gameId = '73000000-0000-4000-8000-000000000099'
    await writeFile(bundlePath, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(execFileAsync(
      process.execPath,
      ['scripts/verify-case-bundle.mjs', bundlePath],
      { cwd: process.cwd(), maxBuffer: 2_000_000 },
    )).rejects.toMatchObject({ code: 1 })
  })
})

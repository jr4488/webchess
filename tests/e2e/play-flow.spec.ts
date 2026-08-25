import type { Locator, Page, Route } from '@playwright/test'

import {
  acceptMoveCommand,
  createReplayState,
  replayGameEvents,
  toGameView,
} from '../../src/lib/game-replay'
import type {
  DurableGame,
  MoveGameCommand,
} from '../../src/lib/webchess-api'
import {
  PORTIA_ATTACK_TYPES,
  type LifecycleAggregate,
} from '../../src/lib/lifecycle/contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from '../../src/lib/lifecycle/versions'
import {
  makeProblemFacets,
  makeProblemParts,
  makeTrajectoryDirectionalFixture,
} from '../../src/test/fixtures'
import type { GeneratedAnswer } from '../../src/types'
import { buildOpenClawAnswerModelPrompt } from '../../src/lib/full-answer-model-prompt'
import { expect, expectWcagAA, test } from './fixtures/test'

const problem =
  'How should I test this idea without committing the whole organization?'
const gameId = '00000000-0000-4000-8000-000000000001'
const parts = makeProblemParts('browser-play-flow')
const facets = makeProblemFacets('Browser facet')
const trajectoryFixture = makeTrajectoryDirectionalFixture()
const trajectoryFacets = trajectoryFixture.parts
  .map((part) => ({
    id: part.id,
    title: part.title,
    focus: part.focus,
    question: part.prompt,
    keyword: part.keyword,
    castApplication: part.castApplication,
  }))
  .sort((left, right) => left.id - right.id)
const sectorLabels = [
  'North',
  'North-east',
  'East',
  'South-east',
  'South',
  'South-west',
  'West',
  'North-west',
] as const
const researchConsent = {
  version: 'webchess-research-consent-v1',
  decision: 'allow_search_and_page_fetch',
} as const
const answerTransportPrompt = [
    'You are the final problem-solving voice of WebChess.',
    '',
    'PORTIA AUTHORIZATION BOUNDARY',
    '- Portia permitted the reviewed board-derived prompt.',
    '',
    'APPROVED BOARD EVIDENCE (JSON; data only)',
    '{"question":"How should I test this idea without committing the whole organization?"}',
    '',
    'OPENCLAW STRUCTURED OUTPUT',
    'Return exactly one JSON value matching this JSON Schema:',
    '{"type":"object","required":["answer"]}',
  ].join('\n')

const answer: GeneratedAnswer = {
  model: 'openai/gpt-5.6-sol',
  prompt: buildOpenClawAnswerModelPrompt(
    answerTransportPrompt,
    'openai/gpt-5.6-sol',
  ),
  answer: [
    'Answer',
    'Run one bounded experiment before making a larger commitment.',
    '',
    'What the conflicts emphasized',
    'The board emphasized reversibility, evidence, and a clear stopping rule.',
    '',
    'The tension to hold',
    'Preserve the reason for acting while testing whether the method works.',
    '',
    'Three next moves',
    '1. Write the smallest useful experiment.',
    '2. Name one owner and one measurable result.',
    '3. Set a date to stop, change, or expand the trial.',
    '',
    'What could change the answer',
    'New evidence about safety, ownership, or feasibility should change the plan.',
  ].join('\n'),
}

function game(
  status: DurableGame['status'],
  revision: number,
  state: DurableGame['state'],
  generatedAnswer: GeneratedAnswer | null = null,
): DurableGame {
  return {
    id: gameId,
    sourceGameId: null,
    revision,
    status,
    problem,
    researchConsent: {
      ...researchConsent,
      recordedAt: '2026-08-01T20:00:00.000Z',
    },
    division: {
      seed: 'browser-play-flow',
      facets,
      parts,
      model: 'gpt-5.6-sol',
      prompt: 'Server-side division prompt fixture.',
    },
    state,
    answer: generatedAnswer,
  }
}

function trajectoryGame(
  status: DurableGame['status'],
  revision: number,
  state: DurableGame['state'],
  generatedAnswer: GeneratedAnswer | null = null,
): DurableGame {
  return {
    ...game(status, revision, state, generatedAnswer),
    division: {
      seed: trajectoryFixture.divisionSeed,
      facets: trajectoryFacets,
      parts: trajectoryFixture.parts,
      model: 'gpt-5.6-sol',
      prompt: 'Server-side directional Division prompt fixture.',
    },
  }
}

function completedLifecycleGame(): DurableGame {
  return trajectoryGame(
    'answered',
    4,
    toGameView(trajectoryFixture.state),
    answer,
  )
}

function completedLifecycle(): LifecycleAggregate {
  const directionalRecord = trajectoryFixture.record
  const candidateIds = [
    'attempt-2:white-king',
    'attempt-2:white-rook',
    'attempt-2:black-king',
  ]
  const actions = Array.from({ length: 3 }, (_, index) => ({
    title: `Bounded action ${index + 1}`,
    actor: 'The accountable player',
    assumptionBeingTested: 'A small reversible test can produce useful evidence.',
    smallestAction: `Run bounded observation ${index + 1} without scaling.`,
    expectedObservation: 'A direct signal appears inside the review horizon.',
    decisionThreshold: 'Continue only if the signal appears safely.',
    reviewHorizon: 'Within fourteen days',
    reversibility: 'Stop and restore the prior state.',
    risksOrAffectedParties: 'The people carrying the downside can stop the test.',
    decisionRule: 'revise' as const,
  }))
  const answerPromptDigest = 'd'.repeat(64)
  const answerUserPrompt = JSON.stringify({
    reviewed_prompt: {
      question: problem,
      replay_note: 'Use the approved board evidence with Portia qualifications.',
    },
    portia_authorization: { decision: 'permit' },
  }, null, 2)
  const woundedQualification =
    'Treat the observation as directional rather than causal proof.'
  const portiaAssessments = candidateIds.map((candidateId, index) => ({
    candidateId,
    disposition: index === 2 ? 'wounded' as const : 'preserved' as const,
    survivingInterpretation: 'Protect the outcome while testing one reversible step.',
    requiredQualification: index === 2 ? woundedQualification : null,
    redundancyClusterId: null,
    coverageTags: ['protected_outcome' as const],
    missingEvidence: ['A direct observation is still required.'],
    countercase: 'A contradictory observation would reverse this interpretation.',
    reversalCondition: 'Reverse if the protected outcome is threatened.',
    directionalRecordDigest: directionalRecord.digest,
    directionalSignalKeys: [
      directionalRecord.survivingDirectionKeys[index]!,
    ],
    directionalInterpretation:
      `Trajectory direction ${index + 1} shapes how this candidate is scrutinized.`,
    directionalAmendment:
      `Carry trajectory direction ${index + 1} into the qualified synthesis without treating it as factual evidence.`,
    attackFindings: PORTIA_ATTACK_TYPES.map((attackType, attackIndex) => {
      const qualified = index === 2 && attackIndex === 0
      return {
        attackType,
        outcome: qualified ? 'qualified' as const : 'passed' as const,
        severity: qualified ? 'moderate' as const : 'low' as const,
        finding: qualified
          ? `The ${attackType} check requires a bounded qualification.`
          : `The ${attackType} check found no material defect in this signal.`,
        consequence: qualified
          ? 'The signal remains usable only with the exact qualification.'
          : 'The signal may remain in the qualified candidate prompt.',
        requiredRevision: qualified ? woundedQualification : null,
      }
    }),
  }))

  return {
    id: '72000000-0000-4000-8000-000000000002',
    rootRunId: '72000000-0000-4000-8000-000000000001',
    parentRunId: '72000000-0000-4000-8000-000000000001',
    gameId,
    state: 'wilbur_observed',
    revision: 12,
    fieldGeneration: 1,
    gameAttempt: 2,
    sameFieldRetryCount: 1,
    fieldRegenerationCount: 0,
    divisionSeed: trajectoryFixture.divisionSeed,
    castSeed: trajectoryFixture.castSeed,
    trajectorySeed: trajectoryFixture.trajectorySeed,
    retryReason: 'The first traversal left too few independent candidates.',
    terminalFingerprint: trajectoryFixture.terminalFingerprint,
    trajectoryDirectionalRecord: directionalRecord,
    trajectoryDirectionalRecordStatus: 'bound',
    answerPromptDigest,
    answerUserPrompt,
    answerUserPromptSha256: 'b'.repeat(64),
    survivors: [
      { candidateId: candidateIds[0], finalCoordinate: { ring: 7, sector: 4 } },
      { candidateId: candidateIds[1], finalCoordinate: { ring: 2, sector: 0 } },
      { candidateId: candidateIds[2], finalCoordinate: { ring: 2, sector: 0 } },
    ],
    portiaActiveModelRequestId: null,
    portiaFailedAttemptCount: 0,
    portiaFailureLimit: 3,
    portiaProgress: {
      currentCandidateId: null,
      completedCandidateIds: candidateIds,
      completedAssessments: portiaAssessments,
    },
    portia: {
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      reviewedAnswerPromptDigest: answerPromptDigest,
      directionalRecordVersion: directionalRecord.version,
      directionalRecordDigest: directionalRecord.digest,
      directionalSummary:
        'The canonical trajectory changed the retained directional lenses and their required qualifications.',
      promptDecision: 'permit',
      promptDecisionRationale:
        'The exact board-derived prompt is reasonable with its retained qualification.',
      runSummary: 'Portia ran all thirteen attacks and retained a qualified basis.',
      assessments: portiaAssessments,
      crossCandidateContradictions: [],
      redundancyClusters: [],
      missingCoverage: [],
      unresolvedQuestions: ['What direct observation should come next?'],
      recommendedGateInputs: {
        tensionCandidatePairs: [],
        fatalContradictionIds: [],
        fieldRepairReasons: [],
      },
    },
    gate: {
      algorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
      directionalRecordVersion: directionalRecord.version,
      directionalRecordDigest: directionalRecord.digest,
      survivingDirectionKeys: [...directionalRecord.survivingDirectionKeys],
      directionalBindingsSatisfied: true,
      passed: true,
      usableCandidateCount: 3,
      preservedCount: 2,
      woundedCount: 1,
      consumedCount: 0,
      unresolvedCount: 0,
      independentClusterCount: 3,
      coverageResults: [{
        tag: 'protected_outcome',
        satisfied: true,
        candidateIds,
      }],
      severeUnresolvedObjectionCount: 0,
      contradictionResults: { fatalUnaddressedIds: [], tensionCandidatePairs: [] },
      missingRequirements: [],
      recommendedNextTransition: 'answer',
      explanation: 'The deterministic evidence and actionability floors are met.',
      inputDigest: 'e'.repeat(64),
    },
    charlotte: {
      contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      protectedOutcome: 'Learn safely without an irreversible commitment.',
      directAnswer: 'Run a bounded experiment before making the larger commitment.',
      supportingCandidateIds: candidateIds,
      qualificationsByCandidateId: {
        [candidateIds[2]]: woundedQualification,
      },
      centralTension: 'Learn promptly without exposing affected people to avoidable downside.',
      valueConstraints: ['Keep a stop path.'],
      stakeholderConsequences: ['The accountable player owns the test.'],
      recommendation: 'Run the smallest reversible experiment and decide from the observation.',
      communicationStrategy: 'State the assumption, signal, and stopping rule.',
      uncertainties: ['The observation is not yet known.'],
      whatCouldChangeTheAnswer: ['A contradictory observation.'],
      exactlyThreeNextActions: actions,
    },
    charlotteRenderedAnswer: [
      '# A bounded path forward',
      '',
      'Protect the purpose, run the smallest reversible test, and decide from the observation.',
    ].join('\n'),
    charlotteActiveModelRequestId: null,
    charlotteFailedAttemptCount: 0,
    charlotteFailureLimit: 3,
    wilburActions: [{
      id: '73000000-0000-4000-8000-000000000001',
      lifecycleRunId: '72000000-0000-4000-8000-000000000002',
      charlotteActionIndex: 0,
      charlotteBindingVersion: 'webchess-charlotte-action-binding-v1',
      actor: actions[0].actor,
      action: actions[0].smallestAction,
      testedAssumption: actions[0].assumptionBeingTested,
      expectedObservation: actions[0].expectedObservation,
      decisionThreshold: actions[0].decisionThreshold,
      reviewHorizon: actions[0].reviewHorizon,
      followUpAt: '2026-08-15T20:00:00.000Z',
      status: 'in_progress',
      revision: 1,
      version: 'webchess-wilbur-v1',
      createdAt: '2026-08-01T20:00:00.000Z',
      updatedAt: '2026-08-01T20:00:00.000Z',
    }],
    wilburObservations: [],
    webMemoryEvidence: [],
    research: [],
    activities: [
      'anansi',
      'chess',
      'portia',
      'gate',
      'retry',
      'answer',
      'charlotte',
      'wilbur',
      'web',
    ].map((stage, index) => ({
      id: `activity-${index + 1}`,
      sequence: index + 1,
      stage,
      activityType: 'stage_completed',
      stateFrom: null,
      stateTo: 'wilbur_observed',
      inputEntityIds: [],
      outputEntityIds: [],
      responsibleAgentIds: ['webchess'],
      configurationDigest: 'a'.repeat(64),
      status: 'completed',
      eventVersion: 1,
      createdAt: `2026-08-01T20:0${index}:00.000Z`,
    })),
    versions: {
      software: CURRENT_LIFECYCLE_VERSIONS.software,
      lifecycle: CURRENT_LIFECYCLE_VERSIONS.lifecycle,
      portiaPrompt: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      portiaContract: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      gateAlgorithm: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
      retryPolicy: CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
      charlottePrompt: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      charlotteContract: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      wilburRecord: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      trajectoryDirectionalRecord:
        CURRENT_LIFECYCLE_VERSIONS.trajectoryDirectionalRecord,
      rules: 'circular-direct-king-v1',
      engine: 'engine-v2',
      cast: 'independent-three-shuffle-v1',
      event: CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
    },
    createdAt: '2026-08-01T20:00:00.000Z',
    updatedAt: '2026-08-01T20:07:00.000Z',
  } as unknown as LifecycleAggregate
}

function requestBody<T>(route: Route): T {
  const body = route.request().postDataJSON()
  expect(body).toBeTruthy()
  return body as T
}

function expectServerMutationBoundary(route: Route): void {
  const request = route.request()
  expect(request.method()).toBe('POST')
  expect(request.headers()['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  expect(request.headers()).not.toHaveProperty('authorization')
  expect(request.postData() ?? '').not.toMatch(
    /api[_-]?key|openai_api_key|captures|outcome|provider|model/i,
  )
}

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  })
}

async function expectRootFitsViewport(page: Page, stage: string): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }))

  expect(
    dimensions.scrollWidth,
    `${stage} must not create document-level horizontal scrolling.`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

async function expectReducedMotionApplied(
  page: Page,
  stage: string,
): Promise<void> {
  expect(
    await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
    `${stage} must receive the operating-system reduced-motion preference.`,
  ).toBe(true)

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  const longRunningAnimations = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => {
        const duration = animation.effect?.getComputedTiming().duration
        return (
          animation.playState === 'running' &&
          typeof duration === 'number' &&
          duration > 10
        )
      })
      .map((animation) => ({
        currentTime: animation.currentTime,
        duration: animation.effect?.getComputedTiming().duration,
      })),
  )

  expect(
    longRunningAnimations,
    `${stage} must not leave decorative animations running in reduced-motion mode.`,
  ).toEqual([])
}

async function expectAccessibleDynamicStage(
  page: Page,
  stage: string,
): Promise<void> {
  await expectRootFitsViewport(page, stage)
  await expectReducedMotionApplied(page, stage)
  await expectWcagAA(page)
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  let reachedTarget = await target.evaluate(
    (element) => element === document.activeElement,
  )
  for (let step = 0; step < 20; step += 1) {
    if (reachedTarget) break
    await page.keyboard.press('Tab')
    reachedTarget = await target.evaluate(
      (element) => element === document.activeElement,
    )
  }

  expect(reachedTarget, 'The play control must be reachable with Tab.').toBe(
    true,
  )
}

async function moveBoardFocus(
  page: Page,
  target: { ring: number; sector: number },
): Promise<void> {
  const focusedCell = page.locator('.radial-board__cell:focus')
  await expect(focusedCell).toHaveCount(1)

  let coordinate = await focusedCell.evaluate((element) => ({
    ring: Number((element as HTMLElement).dataset.ring),
    sector: Number((element as HTMLElement).dataset.sector),
  }))

  while (coordinate.ring > target.ring) {
    await page.keyboard.press('ArrowUp')
    coordinate = { ...coordinate, ring: coordinate.ring - 1 }
  }
  while (coordinate.ring < target.ring) {
    await page.keyboard.press('ArrowDown')
    coordinate = { ...coordinate, ring: coordinate.ring + 1 }
  }

  const clockwise = (target.sector - coordinate.sector + 8) % 8
  const counterclockwise = (coordinate.sector - target.sector + 8) % 8
  const key = clockwise <= counterclockwise ? 'ArrowRight' : 'ArrowLeft'
  const steps = Math.min(clockwise, counterclockwise)
  for (let step = 0; step < steps; step += 1) {
    await page.keyboard.press(key)
  }

  await expect(page.locator('.radial-board__cell:focus')).toHaveAttribute(
    'data-ring',
    String(target.ring),
  )
  await expect(page.locator('.radial-board__cell:focus')).toHaveAttribute(
    'data-sector',
    String(target.sector),
  )
}

test.describe('complete durable play flow', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('keyboard-divides, starts, plays, answers, and restores after refresh', async ({
    page,
  }, testInfo) => {
    const terminalEvent = trajectoryFixture.state.events.at(-1)
    if (!terminalEvent || terminalEvent.type !== 'move') {
      throw new Error('The browser terminal fixture must end with a move.')
    }
    const startState = replayGameEvents(
      trajectoryFixture.state.events.slice(0, -1),
      trajectoryFixture.parts,
    )
    const terminalMover = startState.pieces.find(
      (piece) => piece.id === terminalEvent.pieceId,
    )
    if (!terminalMover) {
      throw new Error('The browser terminal fixture is missing its final mover.')
    }
    let currentGame: DurableGame | null = null
    const calls: string[] = []

    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      calls.push(`${request.method()} ${pathname}`)

      if (request.method() === 'GET' && pathname === '/api/games/current') {
        await json(route, { game: currentGame })
        return
      }

      if (request.method() === 'GET' && pathname === '/api/web-memory') {
        await json(route, {
          memory: { cases: [], carriedObservationIds: [] },
        })
        return
      }

      if (
        request.method() === 'GET'
        && pathname === `/api/games/${gameId}/lifecycle`
      ) {
        await json(route, { lifecycle: completedLifecycle() })
        return
      }

      if (pathname === '/api/divide') {
        expectServerMutationBoundary(route)
        expect(requestBody<{
          problem: string
          researchConsent: typeof researchConsent
        }>(route)).toEqual({ problem, researchConsent })
        currentGame = trajectoryGame('mapped', 1, null)
        await json(route, { game: currentGame })
        return
      }

      if (pathname === `/api/games/${gameId}/start`) {
        expectServerMutationBoundary(route)
        expect(requestBody<{ expectedRevision: number }>(route)).toEqual({
          expectedRevision: 1,
        })
        currentGame = trajectoryGame('playing', 2, toGameView(startState))
        await json(route, { game: currentGame })
        return
      }

      if (pathname === `/api/games/${gameId}/moves`) {
        expectServerMutationBoundary(route)
        const command = requestBody<MoveGameCommand>(route)
        expect(Object.keys(command).sort()).toEqual([
          'expectedRevision',
          'pieceId',
          'to',
        ])
        expect(command.expectedRevision).toBe(2)
        const accepted = acceptMoveCommand(
          startState,
          {
            expectedPly: startState.completedPlies + 1,
            pieceId: command.pieceId,
            to: command.to,
          },
          trajectoryFixture.parts,
        )
        expect(accepted.state.outcome).not.toBeNull()
        currentGame = trajectoryGame(
          'answered',
          3,
          toGameView(accepted.state),
          answer,
        )
        await json(route, { game: currentGame })
        return
      }

      throw new Error(`Unexpected browser API request: ${request.method()} ${pathname}`)
    })

    await page.goto('/openclaw', { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', { name: /Bring a problem/i }),
    ).toBeVisible()

    const problemInput = page.getByLabel('What are you trying to understand?')
    await tabTo(page, problemInput)
    await problemInput.fill(problem)
    await problemInput.press('Tab')
    const consentRadio = page.getByRole('radio', {
      name: /Allow bounded research/i,
    })
    await expect(consentRadio).toBeFocused()
    await consentRadio.press('Space')
    await consentRadio.press('Tab')
    const divideButton = page.getByRole('button', {
      name: /Divide the problem/i,
    })
    await expect(divideButton).toBeFocused()
    await divideButton.press('Enter')

    const startButton = page.getByRole('button', {
      name: /Set the pieces in motion/i,
    })
    await expect(startButton).toBeEnabled()
    await expect(
      page.getByRole('progressbar', { name: /Facets cast onto the board/i }),
    ).toHaveAttribute('aria-valuenow', '64')
    await expectAccessibleDynamicStage(page, 'mapped play stage')
    await expect(page.locator('[data-stage-root]')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '3D world' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '2D board' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(startButton).toBeFocused()
    await startButton.press('Enter')

    await expect(
      page.getByRole('region', {
        name: /Play the problem on the circular board/i,
      }),
    ).toBeVisible()
    await expectAccessibleDynamicStage(page, 'active play stage')
    await expect(page.locator('[data-stage-root]')).toBeFocused()

    if (testInfo.project.name === 'mobile') {
      const boardScroller = page.locator('.board-card.is-live')
      const boardDimensions = await boardScroller.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(boardDimensions.scrollWidth).toBeGreaterThan(
        boardDimensions.clientWidth,
      )
      await boardScroller.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(
        await boardScroller.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0)
      await boardScroller.evaluate((element) => {
        element.scrollLeft = 0
      })
    }

    const finalMover = page.getByRole('button', {
      name: new RegExp(
        `^${terminalMover.side} ${terminalMover.kind}, ring ${
          terminalMover.position.ring + 1
        }, ${sectorLabels[terminalMover.position.sector]}$`,
        'i',
      ),
    })
    await tabTo(page, finalMover)
    await page.keyboard.press('Enter')
    await expect(page.locator('.radial-board__cell.is-legal:focus')).toHaveCount(
      1,
    )
    await moveBoardFocus(page, terminalEvent.to)
    const terminalCell = page.locator('.radial-board__cell:focus')
    await expect(terminalCell).toHaveClass(/is-legal/)
    await page.keyboard.press('Enter')

    await expect(
      page.getByRole('heading', {
        name: /The ending is only the middle of the web/i,
      }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Run one bounded experiment/)).toBeVisible()
    await expectAccessibleDynamicStage(page, 'answered play stage')
    await expect(page.locator('[data-stage-root]')).toBeFocused()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', {
        name: /The ending is only the middle of the web/i,
      }),
    ).toBeVisible()
    await expect(page.getByText(/Run one bounded experiment/)).toBeVisible()
    await expectRootFitsViewport(page, 'restored answer stage')
    await expectReducedMotionApplied(page, 'restored answer stage')

    expect(calls).toEqual(expect.arrayContaining([
      'GET /api/games/current',
      'POST /api/divide',
      `POST /api/games/${gameId}/start`,
      `POST /api/games/${gameId}/moves`,
      `GET /api/games/${gameId}/lifecycle`,
    ]))
    expect(calls).not.toContain(`POST /api/games/${gameId}/answer`)
    expect(calls.filter((call) => call === 'GET /api/web-memory')).toHaveLength(2)
  })

  test('renders the complete seven-stage visible lifecycle as a responsive, accessible action record', async ({
    page,
  }, testInfo) => {
    const currentGame = completedLifecycleGame()
    const lifecycle = completedLifecycle()

    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            const target = window as Window & {
              __webchessCopiedPrompt?: string
            }
            target.__webchessCopiedPrompt = value
          },
        },
      })
    })

    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname

      if (request.method() === 'GET' && pathname === '/api/games/current') {
        await json(route, { game: currentGame })
        return
      }
      if (request.method() === 'GET' && pathname === '/api/web-memory') {
        await json(route, {
          memory: { cases: [], carriedObservationIds: [] },
        })
        return
      }
      if (
        request.method() === 'GET'
        && pathname === `/api/games/${gameId}/lifecycle`
      ) {
        await json(route, { lifecycle })
        return
      }
      throw new Error(
        `Unexpected lifecycle API request: ${request.method()} ${pathname}`,
      )
    })

    await page.goto('/openclaw', { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', { name: /The ending is only the middle of the web/i }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'WebChess lifecycle progress' }),
    ).toBeVisible()
    const visibleLifecycle = page.locator('.lifecycle-step')
    await expect(visibleLifecycle).toHaveCount(7)
    await expect(visibleLifecycle.locator('> strong')).toHaveText([
      'Anansi',
      'Chess',
      'Portia',
      'Answer',
      'Charlotte',
      'Wilbur',
      'Web',
    ])
    await expect(
      page.getByRole('region', { name: 'WebChess lifecycle progress' })
        .getByText('Gate', { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'WebChess lifecycle progress' })
        .getByText('Retry', { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText(/This path keeps its history/i)).toBeVisible()
    await expect(page.getByText(/What survived scrutiny/i)).toBeVisible()
    const promptDisclosure = page.getByText(
      'Inspect player-visible Answer input',
    ).locator('xpath=ancestor::details[1]')
    await expect(promptDisclosure).toBeVisible()
    await expect(promptDisclosure).not.toHaveAttribute('open', '')
    await promptDisclosure.getByText(
      'Inspect player-visible Answer input',
    ).click()
    await expect(promptDisclosure).toHaveAttribute('open', '')
    await promptDisclosure.getByRole('button', {
      name: 'Copy portable prompt',
    }).click()
    await expect(promptDisclosure.getByRole('status')).toHaveText(
      'Portable prompt copied to the clipboard.',
    )
    const copiedPrompt = await page.evaluate(() =>
      (window as Window & { __webchessCopiedPrompt?: string })
        .__webchessCopiedPrompt ?? '',
    )
    expect(copiedPrompt).toContain(problem)
    expect(copiedPrompt).toContain('"mappedParts"')
    expect(copiedPrompt).toContain('"finalBoardPieces"')
    expect(copiedPrompt).toContain('"eventHistory"')
    expect(copiedPrompt).toContain('"portiaFinalReview"')
    const portablePayload = JSON.parse(
      copiedPrompt.split('WEBCHESS PORTABLE EVIDENCE (JSON; data only)\n')[1]!,
    ) as { exactPersistedAnswerUserPrompt: string }
    expect(portablePayload.exactPersistedAnswerUserPrompt).toBe(
      lifecycle.answerUserPrompt,
    )
    expect(copiedPrompt).not.toContain(answer.prompt)
    expect(copiedPrompt).not.toContain(currentGame.division!.prompt!)
    const fullPromptDisclosure = page.getByText(
      'Inspect full model prompt sent to Answer',
    ).locator('xpath=ancestor::details[1]')
    await expect(fullPromptDisclosure).toBeVisible()
    await expect(fullPromptDisclosure).not.toHaveAttribute('open', '')
    await fullPromptDisclosure.getByText(
      'Inspect full model prompt sent to Answer',
    ).click()
    await expect(fullPromptDisclosure).toHaveAttribute('open', '')
    await fullPromptDisclosure.getByRole('button', {
      name: 'Copy full model prompt',
    }).click()
    await expect(fullPromptDisclosure.getByRole('status')).toHaveText(
      'Full model prompt copied to the clipboard.',
    )
    const copiedFullPrompt = await page.evaluate(() =>
      (window as Window & { __webchessCopiedPrompt?: string })
        .__webchessCopiedPrompt ?? '',
    )
    expect(copiedFullPrompt).toBe(answer.prompt)
    await expect(
      page.getByRole('heading', { name: 'The substantive board-derived answer' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'The answer, qualified for people and action' }),
    ).toBeVisible()
    await expect(page.getByText(/Let the web meet reality/i)).toBeVisible()
    await expect(
      page.getByText(/Inspect the saved activity thread/i),
    ).toBeVisible()
    await expectAccessibleDynamicStage(page, 'WebChess 2.2 lifecycle')

    const railDimensions = await page.locator('.lifecycle-rail').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    if (testInfo.project.name === 'mobile') {
      expect(railDimensions.scrollWidth).toBeGreaterThan(railDimensions.clientWidth)
    } else {
      expect(railDimensions.scrollWidth).toBeLessThanOrEqual(railDimensions.clientWidth + 1)
    }

    await page.getByRole('button', { name: 'Record what happened' }).click()
    await expect(page.getByLabel('What did you observe?')).toBeVisible()
    await expect(
      page.getByLabel('What did this do to the tested assumption?'),
    ).toBeVisible()
    await expectWcagAA(page)
  })

  test('reuses one Engine V2 worker across saved plies and retires it on pause and reset', async ({
    page,
  }) => {
    let replayState = createReplayState()
    let revision = 2
    let currentGame = game('playing', revision, toGameView(replayState))
    const submittedMoves: MoveGameCommand[] = []
    const browserErrors: string[] = []
    let abandonCalls = 0

    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => {
      browserErrors.push(error.message)
    })

    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname

      if (request.method() === 'GET' && pathname === '/api/games/current') {
        await json(route, { game: currentGame })
        return
      }

      if (request.method() === 'GET' && pathname === '/api/web-memory') {
        await json(route, {
          memory: { cases: [], carriedObservationIds: [] },
        })
        return
      }

      if (pathname === `/api/games/${gameId}/moves`) {
        expectServerMutationBoundary(route)
        const command = requestBody<MoveGameCommand>(route)
        expect(command.expectedRevision).toBe(revision)

        const accepted = acceptMoveCommand(
          replayState,
          {
            expectedPly: replayState.completedPlies + 1,
            pieceId: command.pieceId,
            to: command.to,
          },
          parts,
        )
        replayState = accepted.state
        revision += 1
        submittedMoves.push(command)
        currentGame = game(
          replayState.outcome ? 'completed' : 'playing',
          revision,
          toGameView(replayState),
        )
        await json(route, { game: currentGame })
        return
      }

      if (pathname === `/api/games/${gameId}/abandon`) {
        expectServerMutationBoundary(route)
        expect(requestBody<{ expectedRevision: number }>(route)).toEqual({
          expectedRevision: revision,
        })
        abandonCalls += 1
        revision += 1
        currentGame = game(
          'abandoned',
          revision,
          toGameView(replayState),
        )
        await json(route, { game: currentGame })
        return
      }

      throw new Error(
        `Unexpected worker-flow API request: ${request.method()} ${pathname}`,
      )
    })

    await page.goto('/openclaw', { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('region', {
        name: /Play the problem on the circular board/i,
      }),
    ).toBeVisible()

    const firstWorkerPromise = page.waitForEvent('worker')
    await page.getByRole('button', { name: /Play one turn/i }).click()
    const firstWorker = await firstWorkerPromise
    const firstWorkerUrl = new URL(firstWorker.url())
    expect(firstWorkerUrl.origin).toBe(new URL(page.url()).origin)
    expect(firstWorkerUrl.pathname).toMatch(
      /^\/_next\/static\/chunks\/.+\.js$/,
    )

    await expect
      .poll(() => submittedMoves.length, { timeout: 20_000 })
      .toBe(1)
    await expect(
      page.locator('.turn-header .eyebrow'),
    ).toContainText('Move 02')
    expect(replayState.completedPlies).toBe(1)
    expect(replayState.outcome).toBeNull()

    const autoplayButton = page.getByRole('button', {
      name: /Auto-play to the end/i,
    })
    const firstWorkerClosed = firstWorker.waitForEvent('close')
    await autoplayButton.click()
    await expect(
      page.getByRole('button', { name: /Searching/i }),
    ).toBeDisabled()
    expect(page.workers()).toContain(firstWorker)
    await page.getByRole('button', { name: /Pause auto-play/i }).click()
    await firstWorkerClosed
    await expect(
      page.locator('.play-panel .board-message'),
    ).toContainText(/Auto-play paused\. Choose a Black piece/i)
    await page.waitForTimeout(500)
    expect(submittedMoves).toHaveLength(1)

    const replacementWorkerPromise = page.waitForEvent('worker')
    await page.getByRole('button', { name: /Auto-play to the end/i }).click()
    const replacementWorker = await replacementWorkerPromise
    expect(replacementWorker).not.toBe(firstWorker)
    const replacementWorkerUrl = new URL(replacementWorker.url())
    expect(replacementWorkerUrl.origin).toBe(new URL(page.url()).origin)
    expect(replacementWorkerUrl.pathname).toMatch(
      /^\/_next\/static\/chunks\/.+\.js$/,
    )
    await expect(
      page.getByRole('button', { name: /Searching/i }),
    ).toBeDisabled()

    const replacementWorkerClosed = replacementWorker.waitForEvent('close')
    await page.getByRole('button', { name: /New question/i }).click()
    await replacementWorkerClosed
    await expect(
      page.getByLabel('What are you trying to understand?'),
    ).toBeVisible()
    await page.waitForTimeout(500)

    expect(abandonCalls).toBe(1)
    expect(submittedMoves).toHaveLength(1)
    expect(browserErrors).toEqual([])
  })
})

import type { Route } from '@playwright/test'

import { composeProblemParts } from '../../src/lib/division'
import {
  acceptMoveCommand,
  createReplayState,
  toGameView,
} from '../../src/lib/game-replay'
import type { ReplayState } from '../../src/lib/game-contract'
import type {
  DurableGame,
  MoveGameCommand,
} from '../../src/lib/webchess-api'
import { makeProblemFacets } from '../../src/test/fixtures'
import { expect, test } from './fixtures/test'

const problem =
  'How should I test this local idea without committing the whole organization?'
const gameId = '7a33b7d3-9ff0-4ec0-b8d4-13e30373593a'
const seed = '8a33b7d3-9ff0-4ec0-b8d4-13e30373593a'
const facets = makeProblemFacets('Durable OpenClaw facet')
const parts = composeProblemParts(facets, seed)
const researchConsent = {
  version: 'webchess-research-consent-v1',
  decision: 'allow_search_and_page_fetch',
} as const
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

function game(
  status: DurableGame['status'],
  revision: number,
  state: DurableGame['state'],
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
      seed,
      facets,
      parts,
      model: 'user-provider/configured-model',
      prompt: 'Validated OpenClaw WebChess 2.0 division prompt fixture.',
    },
    state,
    answer: null,
  }
}

function requireReplayState(value: ReplayState | null): ReplayState {
  if (!value) throw new Error('The game has no replay state.')
  return value
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  })
}

test('runs the shared WebChess 2.0 flow and restores it from durable local state', async ({
  page,
}) => {
  test.setTimeout(60_000)
  let currentGame: DurableGame | null = null
  let replayState: ReplayState | null = null
  const calls: string[] = []

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    calls.push(`${request.method()} ${pathname}`)

    expect(request.headers()['x-webchess-openclaw-runtime']).toBe('webchess-2')

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

    if (request.method() === 'POST' && pathname === '/api/divide') {
      expect(request.postDataJSON()).toEqual({ problem, researchConsent })
      currentGame = game('mapped', 1, null)
      await json(route, { game: currentGame })
      return
    }

    if (
      request.method() === 'POST'
      && pathname === `/api/games/${gameId}/start`
    ) {
      expect(request.postDataJSON()).toEqual({ expectedRevision: 1 })
      replayState = createReplayState()
      currentGame = game('playing', 2, toGameView(replayState))
      await json(route, { game: currentGame })
      return
    }

    if (
      request.method() === 'POST'
      && pathname === `/api/games/${gameId}/moves`
    ) {
      if (!replayState) throw new Error('The game was not started.')
      const command = request.postDataJSON() as MoveGameCommand
      expect(command.expectedRevision).toBe(2)
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
      currentGame = game('playing', 3, toGameView(replayState))
      await json(route, { game: currentGame })
      return
    }

    throw new Error(
      `Unexpected OpenClaw v2 request: ${request.method()} ${pathname}`,
    )
  })

  await page.addInitScript(() => {
    window.localStorage.setItem('webchess:board-view', '3d')
    window.sessionStorage.setItem('webchess:board-view', '3d')
  })

  await page.goto('/openclaw', { waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('heading', { name: /Bring a problem/i }),
  ).toBeVisible()
  await expect(page.getByLabel(/WebChess version 2.2/i)).toBeVisible()
  await expect(
    page.getByText(/seven-stage visible WebChess 2.2 lifecycle stay in a dedicated PostgreSQL database/i),
  ).toBeVisible()
  await expect(
    page.getByText(/Portia validates the board-derived answer prompt/i),
  ).toBeVisible()
  await expect(page.getByText(/internal Gate checks sufficiency/i)).toBeVisible()
  await expect(
    page.getByText(/Answer generation runs only after permission/i),
  ).toBeVisible()
  await expect(page.getByText(/Charlotte reviews and qualifies it/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /WebChess home/i }))
    .toHaveAttribute('href', '/openclaw')
  await expect(page.locator('.board-dimension-shell'))
    .toHaveAttribute('data-board-view', '2d')
  await page.getByRole('button', { name: '3D world' }).press('Enter')
  await expect(page.locator('[data-board-dimension="3d"]')).toBeVisible()

  await page.getByLabel('What are you trying to understand?').fill(problem)
  await page.getByRole('radio', { name: /Allow bounded research/i }).check()
  await page.getByRole('button', { name: /Divide the problem/i }).click()
  const start = page.getByRole('button', {
    name: /Set the pieces in motion/i,
  })
  await expect(start).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('.board-dimension-shell'))
    .toHaveAttribute('data-board-view', '2d')
  await page.getByRole('button', { name: '3D world' }).press('Enter')
  await expect(page.locator('[data-board-dimension="3d"]')).toBeVisible()
  await start.press('Enter')

  await expect(
    page.getByRole('region', {
      name: /Play the problem on the circular board/i,
    }),
  ).toBeVisible()
  await expect(page.locator('.board-dimension-shell'))
    .toHaveAttribute('data-board-view', '3d')
  await expect(page.getByRole('button', { name: '3D world' }))
    .toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '2D board' }).press('Enter')
  await expect(page.locator('.radial-board__piece')).toHaveCount(32)
  await expect(page.getByRole('button', { name: '3D world' })).toBeVisible()

  const workerPromise = page.waitForEvent('worker')
  await page.getByRole('button', { name: /Play one turn/i }).press('Enter')
  await workerPromise
  await expect(page.locator('.turn-header .eyebrow')).toContainText(
    'Move 02',
    { timeout: 20_000 },
  )

  const event = requireReplayState(replayState).events[0]
  if (!event || event.type !== 'move') {
    throw new Error('Expected one server-accepted move event.')
  }
  const pieceKind = event.pieceId.split('-')[1]
  const destination = new RegExp(
    `^white ${pieceKind}, ring ${event.to.ring + 1}, ${
      sectorLabels[event.to.sector]
    }$`,
    'i',
  )
  await expect(page.getByRole('button', { name: destination })).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    local: window.localStorage.getItem('webchess:board-view'),
    session: window.sessionStorage.getItem('webchess:board-view'),
  }))).toEqual({ local: '3d', session: '3d' })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('region', {
      name: /Play the problem on the circular board/i,
    }),
  ).toBeVisible()
  await expect(page.locator('.board-dimension-shell'))
    .toHaveAttribute('data-board-view', '2d')
  await expect(page.locator('.radial-board__svg')).toBeVisible()
  await expect(page.getByRole('button', { name: '2D board' }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.turn-header .eyebrow')).toContainText('Move 02')
  await expect(page.getByRole('button', { name: destination })).toBeVisible()
  expect(calls.filter((call) => call !== 'GET /api/web-memory')).toEqual([
    'GET /api/games/current',
    'POST /api/divide',
    `POST /api/games/${gameId}/start`,
    `POST /api/games/${gameId}/moves`,
    'GET /api/games/current',
  ])
  expect(calls.filter((call) => call === 'GET /api/web-memory')).toHaveLength(2)
})

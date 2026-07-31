import type { Route } from '@playwright/test'

import { composeProblemParts } from '../../src/lib/division'
import { OPENCLAW_GAME_STORAGE_KEY } from '../../src/lib/openclaw-webchess-api'
import { makeProblemFacets } from '../../src/test/fixtures'
import type { DurableGame } from '../../src/lib/webchess-api'
import type { MoveGameEvent } from '../../src/lib/game-contract'
import { expect, test } from './fixtures/test'

const problem =
  'How should I test this local idea without committing the whole organization?'
const seed = '7a33b7d3-9ff0-4ec0-b8d4-13e30373593a'
const facets = makeProblemFacets('Local browser facet')
const parts = composeProblemParts(facets, seed)
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

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  })
}

test('launches the visual local flow, animates a move, and restores it from browser storage', async ({
  page,
}) => {
  const calls: string[] = []
  await page.route('**/api/openclaw/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    calls.push(`${request.method()} ${pathname}`)

    if (request.method() === 'GET' && pathname === '/api/openclaw/status') {
      await json(route, {
        available: true,
        model: 'user-provider/configured-model',
        transport: 'local',
        version: 'OpenClaw browser fixture',
      })
      return
    }

    if (request.method() === 'POST' && pathname === '/api/openclaw/divide') {
      expect(request.postDataJSON()).toEqual({ problem })
      expect(request.postData() ?? '').not.toMatch(
        /api[_-]?key|authorization|credential|provider|model/iu,
      )
      await json(route, {
        division: {
          facets,
          model: 'user-provider/configured-model',
          parts,
          prompt: 'Validated local division prompt fixture.',
          seed,
        },
      }, 201)
      return
    }

    throw new Error(
      `Unexpected local browser request: ${request.method()} ${pathname}`,
    )
  })

  await page.goto('/openclaw', { waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('heading', { name: /Bring a problem/i }),
  ).toBeVisible()
  await expect(page.getByText(/saved game and move history stay in this browser/i))
    .toBeVisible()
  await expect(page.getByRole('link', { name: /WebChess home/i }))
    .toHaveAttribute('href', '/openclaw')

  await page.getByLabel('What are you trying to understand?').fill(problem)
  await page.getByRole('button', { name: /Divide the problem/i }).click()
  const start = page.getByRole('button', {
    name: /Set the pieces in motion/i,
  })
  await expect(start).toBeEnabled({ timeout: 15_000 })
  await expect(
    page.getByRole('progressbar', { name: /Facets cast onto the board/i }),
  ).toHaveAttribute('aria-valuenow', '64')
  await start.click()

  await expect(
    page.getByRole('region', {
      name: /Play the problem on the circular board/i,
    }),
  ).toBeVisible()
  await expect(page.getByRole('group', { name: /Chess pieces/i }))
    .toBeVisible()
  await expect(page.locator('.radial-board__piece')).toHaveCount(32)

  const workerPromise = page.waitForEvent('worker')
  await page.getByRole('button', { name: /Play one turn/i }).click()
  await workerPromise
  await expect(page.locator('.turn-header .eyebrow')).toContainText(
    'Move 02',
    { timeout: 20_000 },
  )

  const saved = await page.evaluate((storageKey) => {
    const value = window.localStorage.getItem(storageKey)
    return value ? JSON.parse(value) as DurableGame : null
  }, OPENCLAW_GAME_STORAGE_KEY)
  expect(saved?.state?.events).toHaveLength(1)
  const event = saved?.state?.events[0] as MoveGameEvent | undefined
  expect(event?.type).toBe('move')
  if (!event || event.type !== 'move') {
    throw new Error('Expected one saved local move.')
  }

  const pieceKind = event.pieceId.split('-')[1]
  const destination = new RegExp(
    `^white ${pieceKind}, ring ${event.to.ring + 1}, ${
      sectorLabels[event.to.sector]
    }$`,
    'i',
  )
  const movedPiece = page.getByRole('button', { name: destination })
  await expect(movedPiece).toBeVisible()
  expect(
    await movedPiece.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toContain('0.62s')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('region', {
      name: /Play the problem on the circular board/i,
    }),
  ).toBeVisible()
  await expect(page.locator('.turn-header .eyebrow')).toContainText('Move 02')
  await expect(page.getByRole('button', { name: destination })).toBeVisible()
  expect(calls).toEqual([
    'GET /api/openclaw/status',
    'POST /api/openclaw/divide',
  ])
})

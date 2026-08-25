import type { Page } from '@playwright/test'

import {
  LOCAL_RUNTIME_ROUTES,
  PROTECTED_ROUTES,
  PUBLIC_ROUTES,
} from './fixtures/routes'
import { expect, expectWcagAA, test } from './fixtures/test'

const localAuthActivation =
  process.env.WEBCHESS_E2E_AUTH ?? 'playwright-local'
const localAuthEnabled =
  process.env.PLAYWRIGHT_EXTERNAL_SERVER !== '1' &&
  process.env.VERCEL === undefined &&
  process.env.VERCEL_ENV === undefined

async function expectSuccessfulDocument(
  page: Page,
  path: string,
): Promise<void> {
  const response = await page.goto(path, {
    waitUntil: 'domcontentloaded',
  })

  expect(response, `${path} did not return a document`).not.toBeNull()
  expect(response?.status(), `${path} returned an error`).toBeLessThan(400)
}

async function prepareLocalRoute(
  page: Page,
  path: string,
): Promise<void> {
  if (path === '/openclaw') {
    await page.route('**/api/games/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ game: null }),
      }),
    )
    return
  }

  await page.setExtraHTTPHeaders({
    'x-webchess-e2e-auth': localAuthActivation,
  })

  await page.route('**/api/account/usage', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        usage: {
          period: {
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-08-01T00:00:00.000Z',
          },
          modelOperations: {
            used: 2,
            reserved: 0,
            limit: 20,
            remaining: 18,
          },
          gameStarts: {
            used: 1,
            reserved: 0,
            limit: 10,
            remaining: 9,
          },
          activeModelRequests: 0,
        },
      }),
    }),
  )
}

test.describe('WCAG AA', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.label} has no detectable WCAG AA violations`, async (
      { page },
      testInfo,
    ) => {
      test.slow(
        route.path === '/white-paper',
        'The repository-backed paper requires a full-document accessibility scan.',
      )

      const response = await page.goto(route.path, {
        waitUntil: 'domcontentloaded',
      })

      expect(
        response,
        `${route.path} did not return a document`,
      ).not.toBeNull()
      expect(
        response?.status(),
        `${route.path} returned an error`,
      ).toBeLessThan(400)
      await expectWcagAA(page, testInfo)
    })
  }
})

test.describe('loopback runtime WCAG AA', () => {
  test.skip(
    !localAuthEnabled,
    'The loopback-only test principal is disabled for external servers.',
  )

  for (const route of [...LOCAL_RUNTIME_ROUTES, ...PROTECTED_ROUTES]) {
    test(`${route.label} has no detectable WCAG AA violations`, async (
      { page },
      testInfo,
    ) => {
      await prepareLocalRoute(page, route.path)
      await expectSuccessfulDocument(page, route.path)

      if (route.path === '/openclaw') {
        await expect(
          page.getByLabel('What are you trying to understand?'),
        ).toBeVisible()
      } else {
        await expect(page.getByRole('progressbar')).toHaveCount(2)
      }

      await expectWcagAA(page, testInfo)
    })
  }
})

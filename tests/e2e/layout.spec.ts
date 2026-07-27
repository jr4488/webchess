import type { Page } from '@playwright/test'

import { PUBLIC_ROUTES } from './fixtures/routes'
import { expect, getPrimaryNavigation, test } from './fixtures/test'

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

async function expectReducedMotion(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true)

  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
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
    'Reduced-motion mode must not leave decorative animations running.',
  ).toEqual([])
}

async function prepareAuthenticatedRoute(
  page: Page,
  path: '/play' | '/account',
): Promise<void> {
  await page.setExtraHTTPHeaders({
    'x-webchess-e2e-auth': localAuthActivation,
  })

  if (path === '/play') {
    await page.route('**/api/games/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ game: null }),
      }),
    )
    return
  }

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

test.describe('responsive layout', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.label} fits the viewport`, async ({ page }) => {
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

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))

      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth + 1,
      )
      await expect(page.locator('h1').first()).toBeInViewport()

      const bodyTypography = await page.locator('body').evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
        }
      })
      expect(bodyTypography.fontSize).toBeGreaterThanOrEqual(16)
      if (Number.isFinite(bodyTypography.lineHeight)) {
        expect(bodyTypography.lineHeight).toBeGreaterThanOrEqual(
          bodyTypography.fontSize * 1.4,
        )
      }
    })
  }
})

test('primary navigation is keyboard operable', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const navigation = await getPrimaryNavigation(page)

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
  let reachedNavigation = false
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press('Tab')
    reachedNavigation = await navigation.evaluate(
      (element) => element.contains(document.activeElement),
    )
    if (reachedNavigation) break
  }
  expect(
    reachedNavigation,
    'Primary navigation must be reachable with the Tab key.',
  ).toBe(true)

  const focusedElement = page.locator(':focus')
  await expect(focusedElement).toHaveAttribute('href', /.+/)
  const focusStyle = await focusedElement.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    }
  })

  expect(
    focusStyle.outlineStyle !== 'none' ||
      focusStyle.outlineWidth !== '0px' ||
      focusStyle.boxShadow !== 'none',
    'Focused navigation links need a visible focus indicator',
  ).toBe(true)
})

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  for (const route of [
    { path: '/', label: 'public home' },
    { path: '/sign-in', label: 'sign-in' },
  ] as const) {
    test(`${route.label} honors the operating-system preference`, async ({
      page,
    }) => {
      await expectSuccessfulDocument(page, route.path)
      await expectReducedMotion(page)
    })
  }

  test.describe('loopback authenticated routes', () => {
    test.skip(
      !localAuthEnabled,
      'The loopback-only test principal is disabled for external servers.',
    )

    for (const route of [
      { path: '/play', label: 'play' },
      { path: '/account', label: 'account' },
    ] as const) {
      test(`${route.label} honors the operating-system preference`, async ({
        page,
      }) => {
        await prepareAuthenticatedRoute(page, route.path)
        await expectSuccessfulDocument(page, route.path)

        if (route.path === '/play') {
          await expect(
            page.getByLabel('What are you trying to understand?'),
          ).toBeVisible()
        } else {
          await expect(page.getByRole('progressbar')).toHaveCount(2)
        }

        await expectReducedMotion(page)
      })
    }
  })
})

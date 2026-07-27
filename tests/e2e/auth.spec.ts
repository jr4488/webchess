import fs from 'node:fs'
import path from 'node:path'

import { PROTECTED_ROUTES } from './fixtures/routes'
import { expect, test } from './fixtures/test'

const clerkUiChecksEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY,
)
const localAuthActivation =
  process.env.WEBCHESS_E2E_AUTH ?? 'playwright-local'
const localAuthEnabled =
  process.env.PLAYWRIGHT_EXTERNAL_SERVER !== '1' &&
  process.env.VERCEL === undefined &&
  process.env.VERCEL_ENV === undefined
const authStatePath = process.env.PLAYWRIGHT_AUTH_STATE
  ? path.resolve(process.env.PLAYWRIGHT_AUTH_STATE)
  : undefined
const hasAuthState = Boolean(authStatePath && fs.existsSync(authStatePath))

const unauthenticatedRedirects = [
  {
    requestPath: '/play?resume=game_42',
    returnUrl: '/play?resume=game_42',
  },
  {
    requestPath: '/account/security?from=play',
    returnUrl: '/account/security?from=play',
  },
] as const

test.describe('unauthenticated route protection', () => {
  for (const redirect of unauthenticatedRedirects) {
    test(`${redirect.requestPath} redirects to the exact local sign-in URL`, async ({
      request,
    }) => {
      const response = await request.get(redirect.requestPath, {
        failOnStatusCode: false,
        maxRedirects: 0,
      })
      const expectedLocation = `/sign-in?${new URLSearchParams({
        return_url: redirect.returnUrl,
      }).toString()}`

      expect(response.status()).toBe(307)
      expect(response.headers().location).toBe(expectedLocation)
      expect(
        new URL(
          response.headers().location ?? response.url(),
          response.url(),
        ).searchParams.getAll('return_url'),
      ).toEqual([redirect.returnUrl])
    })
  }
})

test.describe('configured Clerk methods', () => {
  test.skip(
    !clerkUiChecksEnabled,
    'Provider checks require a dedicated Clerk test instance.',
  )

  test('sign in exposes Google, email, and passkey methods', async ({
    page,
  }) => {
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/google/i).first()).toBeVisible()
    await expect(
      page.locator('input[type="email"], input[name="identifier"]').first(),
    ).toBeVisible()
    await expect(page.getByText(/passkey/i).first()).toBeVisible()
  })
})

test.describe('loopback authenticated route smoke', () => {
  test.skip(
    !localAuthEnabled,
    'The loopback-only test principal is disabled for external servers.',
  )

  for (const route of PROTECTED_ROUTES) {
    test(`${route.path} accepts the fixed local test principal`, async ({
      page,
    }) => {
      await page.setExtraHTTPHeaders({
        'x-webchess-e2e-auth': localAuthActivation,
      })
      const response = await page.goto(route.path, {
        waitUntil: 'domcontentloaded',
      })

      expect(response?.status()).toBeLessThan(400)
      await expect(page).toHaveURL(new RegExp(`${route.path}(?:\\?|$)`))
      await expect(page.locator('main')).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth + 1,
      )
    })
  }

  test('account export uses an authenticated POST download', async ({
    page,
  }) => {
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

    let exportMethod: string | undefined
    await page.route('**/api/account/export', (route) => {
      exportMethod = route.request().method()
      return route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: {
          'content-disposition':
            'attachment; filename="webchess-export-2026-07-27.json"',
        },
        body: JSON.stringify({
          format: 'webchess-account-export',
          version: 1,
        }),
      })
    })

    const response = await page.goto('/account', {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('a[href="/api/account/export"]')).toHaveCount(0)

    const exportButton = page.getByRole('button', {
      name: 'Download WebChess data',
    })
    await expect(exportButton).toBeVisible()
    await exportButton.scrollIntoViewIfNeeded()
    await exportButton.focus()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.keyboard.press('Enter'),
    ])

    expect(exportMethod).toBe('POST')
    expect(download.suggestedFilename()).toBe(
      'webchess-export-2026-07-27.json',
    )
  })
})

test.describe('Clerk authenticated route smoke', () => {
  test.skip(
    !hasAuthState,
    'Set PLAYWRIGHT_AUTH_STATE to a dedicated Clerk test-user storage state.',
  )
  test.use({ storageState: authStatePath })

  for (const route of PROTECTED_ROUTES) {
    test(`${route.path} is available to the test user`, async ({ page }) => {
      const response = await page.goto(route.path, {
        waitUntil: 'domcontentloaded',
      })

      expect(response?.status()).toBeLessThan(400)
      await expect(page).toHaveURL(new RegExp(`${route.path}(?:\\?|$)`))
      await expect(page.locator('main')).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth + 1,
      )
    })
  }
})

import { PUBLIC_ROUTES } from './fixtures/routes'
import { expect, expectDocumentLandmarks, test } from './fixtures/test'

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.label} renders at ${route.path}`, async ({ page }) => {
      const response = await page.goto(route.path, {
        waitUntil: 'domcontentloaded',
      })

      expect(response, `${route.path} did not return a document`).not.toBeNull()
      expect(response?.status(), `${route.path} returned an error`).toBeLessThan(
        400,
      )
      await expectDocumentLandmarks(page, {
        siteNavigation: route.shell !== 'auth',
      })
      await expect(page).toHaveTitle(/\S+/)
      await expect(page.locator('body')).not.toContainText(
        'That page is not on this board.',
      )

      const pathname = await page.evaluate(() => window.location.pathname)
      expect(pathname).toBe(route.path)
    })
  }

  test('robots policy keeps account, API, and play routes out of crawlers', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt', {
      failOnStatusCode: false,
    })

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type'] ?? '').toMatch(/^text\/plain\b/i)
    const policy = await response.text()
    expect(policy).toContain('User-Agent: *')
    expect(policy).toContain('Allow: /')
    expect(policy).toContain('Disallow: /account')
    expect(policy).toContain('Disallow: /api/')
    expect(policy).toContain('Disallow: /play')
  })

  test('unknown routes render the accessible custom 404', async ({ page }) => {
    const response = await page.goto('/not-a-real-webchess-route', {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status()).toBe(404)
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'That page is not on this board.',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'WebChess home' }),
    ).toHaveAttribute('href', '/')
    await expect(
      page.getByRole('link', { name: 'Play WebChess' }),
    ).toHaveAttribute('href', '/play')
  })
})

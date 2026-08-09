import { expect, test } from './fixtures/test'

test.describe('canonical WebChess public site', () => {
  test('routes visitors into the working product and repository-backed research', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(400)

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /Every question arrives wrapped in its first frame/i,
      }),
    ).toBeVisible()

    await expect(page.getByRole('link', { name: 'Play WebChess' }).first()).toHaveAttribute(
      'href',
      '/play',
    )
    await expect(page.getByRole('link', { name: 'Read the white paper' })).toHaveAttribute(
      'href',
      '/white-paper',
    )
    await expect(page.getByRole('link', { name: 'Watch an episode' })).toHaveAttribute(
      'href',
      '#episode',
    )
    await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      '/downloads/webchess-white-paper.pdf',
    )
    await expect(page.getByRole('link', { name: 'Download source' })).toHaveAttribute(
      'href',
      '/downloads/webchess-source.zip',
    )

    const illustrativeDisclosure = page.getByText('Illustrative sequence, not the live engine.')
    await expect(illustrativeDisclosure).toBeVisible()
    await expect(
      illustrativeDisclosure.getByRole('link', { name: 'Run the working system.' }),
    ).toHaveAttribute('href', '/play')

    await expect(page.locator('a[href^="mailto:"][href*="white%20paper"]')).toHaveCount(0)
  })

  test('keeps the research page connected to the paper, code, and discussion', async ({ page }) => {
    const response = await page.goto('/research', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(400)

    await expect(page.getByRole('link', { name: 'Read online' })).toHaveAttribute(
      'href',
      '/white-paper',
    )
    await expect(page.getByRole('link', { name: 'Inspect GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/jr4488/webchess',
    )
    await expect(page.getByRole('link', { name: 'Join the discussion' })).toHaveAttribute(
      'href',
      'https://github.com/jr4488/webchess/discussions',
    )
  })
})

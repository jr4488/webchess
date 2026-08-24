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

    await expect(page.getByRole('link', { name: 'Run WebChess locally' })).toHaveAttribute(
      'href',
      '/install',
    )
    await expect(page.getByRole('link', { name: 'Read historical paper 3.0' })).toHaveAttribute(
      'href',
      '/white-paper',
    )
    await expect(page.getByRole('link', { name: 'Watch an episode' })).toHaveAttribute(
      'href',
      '#episode',
    )
    await expect(page.getByRole('link', { name: 'Paper', exact: true })).toHaveAttribute(
      'href',
      '/white-paper',
    )
    await expect(
      page.getByRole('heading', {
        name: 'Eight formal authorities, one generated Answer artifact.',
      }),
    ).toBeVisible()
    await expect(page.locator('#lifecycle').getByRole('heading', { name: 'Gate' })).toBeVisible()
    await expect(page.locator('#lifecycle').getByRole('heading', { name: 'Retry' })).toBeVisible()
    await expect(
      page.locator('#lifecycle').getByRole('heading', {
        name: 'Answer artifact',
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download historical PDF' })).toHaveAttribute(
      'href',
      '/downloads/webchess-white-paper-v3-historical.pdf',
    )
    await expect(page.getByText('Source identity pending').first()).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Download immutable source' }),
    ).toHaveCount(0)

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

    await expect(page.getByRole('link', { name: 'Read historical edition 3.0' })).toHaveAttribute(
      'href',
      '/white-paper',
    )
    await expect(page.getByText('Immutable source pending code freeze')).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Inspect immutable GitHub source' }),
    ).toHaveCount(0)
    await expect(
      page.getByText('Edition 3.1 publication pending code freeze'),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Run the candidate locally' })).toHaveAttribute(
      'href',
      '/install',
    )
    await expect(page.getByRole('link', { name: 'Join the discussion' })).toHaveAttribute(
      'href',
      'https://github.com/jr4488/webchess/discussions',
    )
  })
})

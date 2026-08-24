import type { Page } from '@playwright/test'

import { expectedPublicRelease } from './fixtures/release'
import { GITHUB_REPOSITORY_URL } from './fixtures/routes'
import { expect, test } from './fixtures/test'

const resolvedRelease = expectedPublicRelease()
const immutableTreeUrlPattern = new RegExp(
  `^${GITHUB_REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/tree/[a-f0-9]{40}$`,
  'u',
)

async function expectImmutableGitHubTreeLinks(
  page: Page,
  expectedSourceUrl: string,
): Promise<void> {
  const treeLinks = await page
    .locator(`a[href^="${GITHUB_REPOSITORY_URL}/tree/"]`)
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href),
    )

  expect(treeLinks).toContain(expectedSourceUrl)
  for (const treeLink of treeLinks) {
    expect(
      treeLink,
      `GitHub tree links must use an exact 40-character commit: ${treeLink}`,
    ).toMatch(immutableTreeUrlPattern)
  }
}

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
    if (resolvedRelease) {
      await expect(page.getByRole('link', { name: 'Read mapped paper 3.1' })).toHaveAttribute(
        'href',
        '/white-paper',
      )
    } else {
      await expect(page.getByRole('link', { name: 'Read historical paper 3.0' })).toHaveAttribute(
        'href',
        '/white-paper',
      )
    }
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

    if (resolvedRelease) {
      await expect(page.getByText('Mapped candidate paper · edition 3.1')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Download mapped PDF' })).toHaveAttribute(
        'href',
        '/downloads/webchess-white-paper.pdf',
      )
      await expect(page.getByRole('link', { name: 'Inspect exact source' })).toHaveAttribute(
        'href',
        resolvedRelease.sourceUrl,
      )
      await expect(page.getByRole('link', { name: 'Verify release identity' })).toHaveAttribute(
        'href',
        resolvedRelease.identityPath,
      )
      await expect(page.getByText('Source identity pending')).toHaveCount(0)
      await expect(
        page.getByRole('status').filter({ hasText: /pending/iu }),
      ).toHaveCount(0)
      await expectImmutableGitHubTreeLinks(page, resolvedRelease.sourceUrl)
    } else {
      await expect(page.getByText('Source identity pending').first()).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Download immutable source' }),
      ).toHaveCount(0)
      await expect(
        page.locator('a[href="/downloads/webchess-release-identity.json"]'),
      ).toHaveCount(0)
    }

    const illustrativeDisclosure = page.getByText('Illustrative sequence, not the live engine.')
    await expect(illustrativeDisclosure).toBeVisible()
    await expect(
      illustrativeDisclosure.getByRole('link', { name: 'Install and run the working system.' }),
    ).toHaveAttribute('href', '/install')

    await expect(page.locator('a[href^="mailto:"][href*="white%20paper"]')).toHaveCount(0)
  })

  test('retires hosted play and sends every public recovery path to installation', async ({ page }) => {
    const playResponse = await page.goto('/play', { waitUntil: 'domcontentloaded' })
    expect(playResponse?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/install$/u)
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Install WebChess 2.2.0-rc.1 for local research',
      }),
    ).toBeVisible()

    const notFoundResponse = await page.goto('/this-route-does-not-exist', {
      waitUntil: 'domcontentloaded',
    })
    expect(notFoundResponse?.status()).toBe(404)
    await expect(page.getByRole('link', { name: 'Install WebChess' })).toHaveAttribute(
      'href',
      '/install',
    )
    await expect(page.locator('a[href="/play"]')).toHaveCount(0)
  })

  test('keeps the research page connected to the paper, code, and discussion', async ({ page }) => {
    const response = await page.goto('/research', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(400)

    if (resolvedRelease) {
      await expect(page.getByText('Mapped candidate paper · edition 3.1')).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Read mapped candidate edition 3.1' }),
      ).toHaveAttribute('href', '/white-paper')
      await expect(
        page.getByRole('link', { name: /Read preserved historical edition 3\.0/i }),
      ).toHaveAttribute(
        'href',
        '/downloads/webchess-white-paper-v3-historical.html',
      )
      await expect(
        page.getByRole('link', {
          name: new RegExp(`Inspect exact source ${resolvedRelease.commit}`, 'iu'),
        }),
      ).toHaveAttribute('href', resolvedRelease.sourceUrl)
      await expect(
        page.getByRole('link', { name: 'Verify release identity' }).first(),
      ).toHaveAttribute('href', resolvedRelease.identityPath)
      await expect(
        page.getByText(/(?:Edition 3\.1 publication|Immutable source) pending code freeze/iu),
      ).toHaveCount(0)
      await expect(
        page.getByRole('status').filter({ hasText: /pending/iu }),
      ).toHaveCount(0)
      await expectImmutableGitHubTreeLinks(page, resolvedRelease.sourceUrl)
    } else {
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
    }
    await expect(page.getByRole('link', { name: 'Run the candidate locally' })).toHaveAttribute(
      'href',
      '/install',
    )
    await expect(page.getByRole('link', { name: 'Join the discussion' })).toHaveAttribute(
      'href',
      'https://github.com/jr4488/webchess/discussions',
    )
  })

  test('keeps source downloads fail-closed or bound to the retained release archive', async ({
    page,
    request,
  }) => {
    const response = await page.goto('/security', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBeLessThan(400)

    const sourceRoute = '/downloads/webchess-source.zip'
    if (!resolvedRelease) {
      await expect(page.getByText('Source identity pending').first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Download source' })).toHaveCount(0)

      const unavailable = await request.get(sourceRoute, {
        failOnStatusCode: false,
        maxRedirects: 0,
      })
      expect(unavailable.status()).toBe(503)
      await expect(unavailable.json()).resolves.toMatchObject({
        error: { code: 'RELEASE_IDENTITY_UNAVAILABLE' },
      })
      return
    }

    await expect(page.getByRole('link', { name: 'Download source' })).toHaveAttribute(
      'href',
      sourceRoute,
    )
    await expect(page.getByText('Source identity pending')).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: /pending/iu }),
    ).toHaveCount(0)

    const redirect = await request.get(sourceRoute, {
      failOnStatusCode: false,
      maxRedirects: 0,
    })
    expect(redirect.status()).toBe(307)
    expect(redirect.headers().location).toBe(resolvedRelease.archivePath)

    const archive = await request.get(resolvedRelease.archivePath, {
      failOnStatusCode: false,
    })
    expect(archive.status()).toBe(200)
    expect(archive.headers()['content-type'] ?? '').toMatch(
      /application\/(?:octet-stream|zip)/iu,
    )
    expect((await archive.body()).byteLength).toBeGreaterThan(0)

    const identity = await request.get(resolvedRelease.identityPath, {
      failOnStatusCode: false,
    })
    expect(identity.status()).toBe(200)
    await expect(identity.json()).resolves.toMatchObject({
      paper: { candidate: { edition: '3.1' } },
      source: {
        archive: { downloadPath: resolvedRelease.archivePath },
        commit: resolvedRelease.commit,
      },
      status: 'resolved',
    })
  })
})

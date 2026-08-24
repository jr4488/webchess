import {
  GITHUB_DISCUSSIONS_URL,
  GITHUB_ISSUES_URL,
  GITHUB_REPOSITORY_URL,
  GITHUB_SECURITY_ADVISORY_URL,
  PUBLIC_ROUTES,
} from './fixtures/routes'
import { expectedPublicRelease } from './fixtures/release'
import { expect, test } from './fixtures/test'

const skippedProtocols = /^(?:mailto|tel|javascript|data):/i
const escapedRepositoryUrl = GITHUB_REPOSITORY_URL.replace(
  /[.*+?^${}()|[\]\\]/gu,
  '\\$&',
)
const immutableTreeUrlPattern = new RegExp(
  `^${escapedRepositoryUrl}/tree/[a-f0-9]{40}$`,
  'u',
)
const immutableBlobUrlPattern = new RegExp(
  `^${escapedRepositoryUrl}/blob/[a-f0-9]{40}/.+$`,
  'u',
)
const mutableMainUrlPattern = new RegExp(
  `^${escapedRepositoryUrl}/(?:(?:blob|tree)/main(?:[/?#]|$)|archive/refs/heads/main\\.zip(?:[?#]|$))`,
  'u',
)
const resolvedRelease = expectedPublicRelease()

test('every public page has working internal and external links', async ({
  baseURL,
  page,
  request,
}) => {
  test.setTimeout(180_000)
  const siteURL = new URL(baseURL ?? 'http://127.0.0.1:3011')
  const discovered = new Set<string>()

  for (const route of PUBLIC_ROUTES) {
    const response = await page.goto(route.path, {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status(), `${route.path} is not available`).toBeLessThan(
      400,
    )

    const links = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
    )
    links.forEach((link) => discovered.add(link))
  }

  for (const [url, purpose] of [
    [GITHUB_DISCUSSIONS_URL, 'GitHub Discussions for support'],
    [GITHUB_ISSUES_URL, 'GitHub Issues for bounded defects'],
    [
      GITHUB_SECURITY_ADVISORY_URL,
      'GitHub private vulnerability reporting',
    ],
  ] as const) {
    expect(
      discovered.has(url) || discovered.has(`${url}/`),
      `The site must link to ${purpose}.`,
    ).toBe(true)
  }

  const mutableMainLinks = [...discovered].filter((href) =>
    mutableMainUrlPattern.test(href),
  )
  expect(
    mutableMainLinks,
    'The public site must never advertise mutable main source as its release identity.',
  ).toEqual([])

  const immutableTreeLinks = [...discovered].filter((href) =>
    href.startsWith(`${GITHUB_REPOSITORY_URL}/tree/`),
  )
  for (const href of immutableTreeLinks) {
    expect(
      href,
      `Repository tree links must identify an exact 40-character commit: ${href}`,
    ).toMatch(immutableTreeUrlPattern)
  }
  const immutableBlobLinks = [...discovered].filter((href) =>
    href.startsWith(`${GITHUB_REPOSITORY_URL}/blob/`),
  )
  for (const href of immutableBlobLinks) {
    expect(
      href,
      `Repository file links must identify an exact 40-character commit: ${href}`,
    ).toMatch(immutableBlobUrlPattern)
  }
  if (resolvedRelease) {
    expect(
      discovered.has(resolvedRelease.sourceUrl),
      'The resolved site must advertise its exact immutable release commit.',
    ).toBe(true)
  }

  const requestLinks: string[] = []
  for (const href of discovered) {
    if (skippedProtocols.test(href)) {
      continue
    }

    const url = new URL(href)
    if (url.origin === siteURL.origin && url.hash) {
      const hashTarget = decodeURIComponent(url.hash.slice(1))
      if (hashTarget) {
        await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
        expect(
          await page.evaluate(
            (target) => document.getElementById(target) !== null,
            hashTarget,
          ),
          `Missing fragment target for ${href}`,
        ).toBe(true)
        continue
      }
    }

    requestLinks.push(url.toString())
  }

  const failures: string[] = []
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(8, requestLinks.length) },
    async () => {
      while (cursor < requestLinks.length) {
        const href = requestLinks[cursor]
        cursor += 1
        try {
          const url = new URL(href)
          const sourceArchiveRedirect =
            url.origin === siteURL.origin &&
            url.pathname === '/downloads/webchess-source.zip'
          const response = await request.get(href, {
            failOnStatusCode: false,
            // The reviewed source route intentionally redirects to the exact
            // retained local archive. Validate the redirect contract without
            // obscuring it behind the request client's automatic follow.
            maxRedirects: sourceArchiveRedirect ? 0 : 5,
            timeout: 20_000,
          })
          const status = response.status()
          const externalAccessControlled =
            url.origin !== siteURL.origin && [401, 403, 429].includes(status)
          const privateGitHubHidden =
            href.startsWith(GITHUB_REPOSITORY_URL) && status === 404
          const externalMethodRestricted =
            url.hostname === 'doi.org' && status === 405
          if (
            status >= 400 &&
            !externalAccessControlled &&
            !privateGitHubHidden &&
            !externalMethodRestricted
          ) {
            failures.push(`${href} returned ${status}`)
          }
        } catch (error) {
          failures.push(
            `${href} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
    },
  )
  await Promise.all(workers)

  expect(failures, failures.join('\n')).toEqual([])
})

import { expectedPublicRelease } from './fixtures/release'
import { DOWNLOADS } from './fixtures/routes'
import { expect, test } from './fixtures/test'

const resolvedRelease = expectedPublicRelease()

const advertisedDownloads = [
  {
    page: '/white-paper',
    paths: resolvedRelease
      ? [
          '/downloads/webchess-white-paper.md',
          '/downloads/webchess-white-paper.html',
          '/downloads/webchess-white-paper.pdf',
        ]
      : [
          '/downloads/webchess-white-paper-v3-historical.md',
          '/downloads/webchess-white-paper-v3-historical.html',
          '/downloads/webchess-white-paper-v3-historical.pdf',
        ],
  },
  {
    page: '/install',
    paths: ['/downloads/webchess-installation.md'],
  },
  {
    page: '/license',
    paths: ['/downloads/LICENSE'],
  },
] as const

test.describe('download artifacts', () => {
  for (const download of DOWNLOADS) {
    test(`${download.label} downloads`, async ({ request }) => {
      if (download.redirectLocation) {
        const redirect = await request.get(download.path, {
          failOnStatusCode: false,
          maxRedirects: 0,
        })
        expect(redirect.status()).toBe(307)
        expect(redirect.headers().location ?? '').toMatch(
          download.redirectLocation,
        )

        // The archive route contract ends at the reviewed GitHub redirect.
        // Anonymous access to that external repository is covered by the
        // dedicated link check and can legitimately differ by environment.
        return
      }

      const response = await request.get(download.path, {
        failOnStatusCode: false,
      })

      expect(response.status(), `${download.path} returned an error`).toBe(200)
      expect(response.headers()['content-type'] ?? '').toMatch(
        download.contentType,
      )

      const body = await response.body()
      expect(body.byteLength).toBeGreaterThan(0)
      if (download.signature) {
        expect(body.subarray(0, download.signature.length).toString()).toBe(
          download.signature,
        )
      }
    })
  }

  for (const advertisement of advertisedDownloads) {
    test(`${advertisement.page} advertises its stable downloads`, async ({
      page,
    }) => {
      const response = await page.goto(advertisement.page, {
        waitUntil: 'domcontentloaded',
      })
      expect(response?.status()).toBeLessThan(400)

      for (const downloadPath of advertisement.paths) {
        const link = page.locator(`a[href="${downloadPath}"]`).first()
        await expect(link).toBeVisible()
        await expect(link).toHaveAttribute('download', '')
      }
    })
  }
})

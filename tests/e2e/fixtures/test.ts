import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

export { expect, test }

function formatViolations(
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'],
) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .join(', ')
      return `${violation.id}: ${violation.help} (${targets})`
    })
    .join('\n')
}

export async function expectWcagAA(
  page: Page,
  testInfo?: TestInfo,
): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()

  if (result.violations.length > 0 && testInfo) {
    await testInfo.attach('axe-violations', {
      body: JSON.stringify(result.violations, null, 2),
      contentType: 'application/json',
    })
  }

  expect(
    result.violations,
    `WCAG AA violations:\n${formatViolations(result.violations)}`,
  ).toEqual([])
}

export async function expectDocumentLandmarks(
  page: Page,
  options: { siteNavigation?: boolean } = {},
): Promise<void> {
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('h1').first()).toBeVisible()
  if (options.siteNavigation !== false) {
    await expect(page.locator('header')).toBeVisible()
    await getPrimaryNavigation(page)
  }
}

export async function getPrimaryNavigation(page: Page): Promise<Locator> {
  let navigation = page.locator('nav:visible').first()
  if ((await navigation.count()) === 0) {
    const toggle = page
      .getByRole('button', { name: /(?:menu|navigation)/i })
      .first()
    await expect(
      toggle,
      'A collapsed navigation needs an accessible menu button.',
    ).toBeVisible()
    await toggle.focus()
    await toggle.press('Enter')
    navigation = page.locator('nav:visible').first()
  }

  await expect(navigation).toBeVisible()
  return navigation
}

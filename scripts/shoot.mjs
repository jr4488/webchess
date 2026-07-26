/**
 * Drive a real WebChess session and capture screenshots at each stage.
 *
 * Development aid, not part of the build or the test suite. It exists because
 * the interesting states of this interface only appear while a model is
 * actually streaming, which no static render can show.
 *
 * Usage: node scripts/shoot.mjs [problem]
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Playwright is a globally installed development tool, not a project
// dependency, so it is resolved explicitly rather than imported by name.
const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim()
const { chromium } = await import(
  pathToFileURL(`${globalRoot}/playwright/index.mjs`).href
)

const BASE = process.env.SHOOT_BASE ?? 'http://127.0.0.1:5173'
const OUT = process.env.SHOOT_OUT ?? '/tmp/shots'
const PROBLEM = process.argv[2]
  ?? 'How can I grow the workshop without exhausting the people who make it special?'

const accessCode = readFileSync('.env', 'utf8')
  .split('\n')
  .find((line) => line.startsWith('WEBCHESS_ACCESS_CODE='))
  ?.slice('WEBCHESS_ACCESS_CODE='.length)
  .trim()

if (!accessCode) throw new Error('WEBCHESS_ACCESS_CODE is not set in .env')

// Use the system Chrome rather than Playwright's pinned download.
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`captured ${name}`)
}

page.on('console', (message) => {
  if (message.type() === 'error') console.log('  [browser error]', message.text())
})
page.on('pageerror', (error) => console.log('  [page error]', error.message))

await page.goto(`${BASE}/play`, { waitUntil: 'networkidle' })
await page.getByLabel(/access code/i).fill(accessCode)
await shot('01-gate')

await page.getByRole('button', { name: /enter webchess/i }).click()
await page.getByLabel(/what are you trying to understand/i).waitFor({ timeout: 15_000 })
await page.getByLabel(/what are you trying to understand/i).fill(PROBLEM)
await shot('02-question')

await page.getByRole('button', { name: /divide the problem/i }).click()

// The reasoning panel is the point of this run, so wait for text to actually
// arrive rather than for a fixed delay.
const reasoning = page.locator('.reasoning-stream__text')
try {
  await reasoning.waitFor({ timeout: 180_000 })
  await page.waitForFunction(
    () => (document.querySelector('.reasoning-stream__text')?.textContent?.length ?? 0) > 400,
    null,
    { timeout: 180_000 },
  )
  console.log('reasoning source:',
    await page.locator('.reasoning-stream').getAttribute('data-reasoning-source'))
} catch {
  console.log('no reasoning text arrived before the timeout')
}
await shot('03-thinking')

try {
  await page.getByRole('button', { name: /set the pieces in motion/i })
    .waitFor({ state: 'attached', timeout: 420_000 })
  await page.waitForFunction(
    () => !document.querySelector('button.primary-button[disabled]'),
    null,
    { timeout: 420_000 },
  )
  await shot('04-mapped')

  await page.getByRole('button', { name: /set the pieces in motion/i }).click()
  await page.waitForTimeout(1_200)
  await shot('05-playing')

  await page.getByRole('button', { name: /auto-play to the end/i }).click()
  await page.waitForTimeout(14_000)
  await shot('06-autoplay')
} catch (error) {
  console.log('stage capture stopped:', error.message.split('\n')[0])
  await shot('99-final-state')
}

await browser.close()
console.log('done')

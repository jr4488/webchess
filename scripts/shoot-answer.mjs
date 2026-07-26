/**
 * Play one WebChess game all the way to the synthesized answer and capture it.
 *
 * Development aid, not part of the build or the test suite. The answer stage is
 * the second model run, and it can only be reached through a completed game.
 *
 * Usage: node scripts/shoot-answer.mjs [problem]
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  console.log(`captured ${name}`)
}

page.on('pageerror', (error) => console.log('  [page error]', error.message))

await page.goto(`${BASE}/play`, { waitUntil: 'networkidle' })
await page.getByLabel(/access code/i).fill(accessCode)
await page.getByRole('button', { name: /enter webchess/i }).click()
await page.getByLabel(/what are you trying to understand/i).waitFor({ timeout: 15_000 })
await page.getByLabel(/what are you trying to understand/i).fill(PROBLEM)
await page.getByRole('button', { name: /divide the problem/i }).click()

await page.getByRole('button', { name: /set the pieces in motion/i })
  .waitFor({ state: 'attached', timeout: 420_000 })
await page.waitForFunction(
  () => !document.querySelector('button.primary-button[disabled]'),
  null,
  { timeout: 420_000 },
)
await page.getByRole('button', { name: /set the pieces in motion/i }).click()
await page.getByRole('button', { name: /auto-play to the end/i }).click()
console.log('auto-play started')

// The ending is reached by play, not by a timer, so wait for the reading stage
// itself. A full game can run to 256 plies.
await page.getByRole('heading', { name: /reading|answer/i })
  .first()
  .waitFor({ timeout: 900_000 })
console.log('game ended, answer run started')
await shot('07-answering')

await page.locator('.ai-answer-card:not(.is-loading)').waitFor({ timeout: 600_000 })
await shot('08-answer')

const heading = await page.locator('.ai-answer-card h3, .ai-answer-card h2').first().textContent()
console.log('answer heading:', heading?.trim())

await browser.close()
console.log('done')

import { defineConfig, devices } from '@playwright/test'

const port = 3011
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const defaultWebServerCommand =
  `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`
const localE2EAuthActivation =
  process.env.WEBCHESS_E2E_AUTH ?? 'playwright-local'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1'
    ? undefined
    : {
        command:
          process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? defaultWebServerCommand,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          WEBCHESS_E2E_AUTH: localE2EAuthActivation,
          WEBCHESS_E2E_USER_ID:
            process.env.WEBCHESS_E2E_USER_ID ?? 'e2e_playwright',
        },
      },
  projects: [
    {
      name: 'desktop',
      testIgnore: /links\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'mobile',
      testMatch:
        /(?:accessibility|auth|layout|play-flow|public-routes)\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'links',
      testMatch: /links\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})

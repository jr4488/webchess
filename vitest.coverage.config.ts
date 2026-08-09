import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const generatedExcludes = [
  ...configDefaults.exclude,
  '.next/**',
  'coverage/**',
  'dist/**',
  'playwright-report/**',
  'test-results/**',
  'tests/e2e/**',
]

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(projectRoot, 'src'),
      'server-only': path.join(
        projectRoot,
        'src/test/server-only.ts',
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: './src/test/setup.ts',
          exclude: [
            ...generatedExcludes,
            'tests/integration/**',
          ],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'postgres-integration',
          environment: 'node',
          globals: true,
          setupFiles: [],
          include: ['tests/integration/**/*.integration.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        'src/app/**/layout.tsx',
        'src/app/**/not-found.tsx',
        // These client-only visual effects are exercised by the Playwright
        // route, reduced-motion, accessibility, and layout suites. Counting
        // canvas/SVG animation frames as unit branches would measure the
        // test harness rather than the public contract.
        'src/components/site/AmbientWeb.tsx',
        'src/components/site/EpisodePlayer.tsx',
        'src/components/site/PublicEffects.tsx',
      ],
      reporter: ['text', 'html', 'json'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})

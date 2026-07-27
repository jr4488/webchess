import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

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
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: [
      ...configDefaults.exclude,
      '.next/**',
      'coverage/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'tests/e2e/**',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        'src/app/**/layout.tsx',
        'src/app/**/not-found.tsx',
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

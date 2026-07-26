import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        // The HTML coverage report lands inside the project, so a
        // `npm run verify` run against a live dev server reloaded the open page
        // hundreds of times.
        '**/coverage/**',
        // Server code is loaded by Node, not by the client bundle, so a change
        // here cannot be applied by a reload. Vite still forced one, which
        // discarded the in-browser game state; a local game costs minutes of
        // model time to rebuild. Restart the process to pick these up.
        '**/server/**',
        '**/server.mjs',
      ],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      include: ['server.mjs', 'server/**/*.mjs', 'src/**/*.{ts,tsx}'],
      exclude: ['src/test/**'],
      reporter: ['text', 'html', 'json'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})

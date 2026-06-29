import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirror the `@/*` -> `src/*` alias from tsconfig.json so Vitest (which uses
  // Vite's resolver, not tsconfig paths) can resolve internal imports.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    // `src/env.ts` validates required vars at import time and throws if any are
    // missing. Provide inert dummy values so the suite runs without real
    // secrets (locally and in CI).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
      JWT_SECRET: 'test-jwt-secret',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
    },
  },
})

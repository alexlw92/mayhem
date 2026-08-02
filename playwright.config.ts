import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  globalSetup: './e2e/globalSetup.ts',
  use: {
    screenshot: 'only-on-failure',
  },
})

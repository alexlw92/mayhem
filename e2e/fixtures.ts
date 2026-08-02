import { test as base, _electron as electron, Page, ElectronApplication } from '@playwright/test'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env.dev') })

type WorkerFixtures = { electronApp: ElectronApplication }
type TestFixtures = { window: Page }

export const test = base.extend<TestFixtures, WorkerFixtures>({
  electronApp: [async ({}, use) => {
    const app = await electron.launch({
      args: [path.resolve(__dirname, '../out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: process.env.TEST_DATABASE_URL!,
      },
    })
    const page = await app.firstWindow()
    await page.waitForSelector('.sidebar', { timeout: 15_000 })
    await use(app)
    await app.close()
  }, { scope: 'worker' }],

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await use(page)
  },
})

export { expect } from '@playwright/test'

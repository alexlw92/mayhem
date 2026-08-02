import { test, expect } from './fixtures'

test.beforeEach(async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Players' }).click()
})

test('clicking Champions nav activates it and shows page title', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Champions' }).click()
  await expect(window.locator('.nav-item', { hasText: 'Champions' })).toHaveClass(/active/)
  await expect(window.locator('.page-title', { hasText: 'Champions' })).toBeVisible()
})

test('clicking Augments nav activates it and shows page title', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Augments' }).click()
  await expect(window.locator('.nav-item', { hasText: 'Augments' })).toHaveClass(/active/)
  await expect(window.locator('.page-title', { hasText: 'Augments' }).first()).toBeVisible()
})

test('clicking Players nav activates it and shows page title', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Players' }).click()
  await expect(window.locator('.nav-item', { hasText: 'Players' })).toHaveClass(/active/)
  await expect(window.locator('.page-title', { hasText: 'Players' })).toBeVisible()
})

test('clicking Live nav activates it', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Live' }).click()
  await expect(window.locator('.nav-item', { hasText: 'Live' })).toHaveClass(/active/)
})

test('nav item loses active class when another is clicked', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Champions' }).click()
  await expect(window.locator('.nav-item', { hasText: 'Champions' })).toHaveClass(/active/)
  await window.locator('.nav-item', { hasText: 'Augments' }).click()
  await expect(window.locator('.nav-item', { hasText: 'Augments' })).toHaveClass(/active/)
  await expect(window.locator('.nav-item', { hasText: 'Champions' })).not.toHaveClass(/active/)
})

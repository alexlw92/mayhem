import { test, expect } from './fixtures'

test('sidebar renders navigation and mode toggle', async ({ window }) => {
  await expect(window.locator('.logo')).toBeVisible()
  await expect(window.locator('.nav-list')).toBeVisible()
  await expect(window.locator('.sidebar-mode')).toBeVisible()
})

test('mode toggle: Mayhem active by default', async ({ window }) => {
  const mayhem = window.locator('.mode-btn', { hasText: 'Mayhem' })
  const classic = window.locator('.mode-btn', { hasText: 'Classic' })
  await expect(mayhem).toHaveClass(/active/)
  await expect(classic).not.toHaveClass(/active/)
})

test('mode toggle: clicking Classic switches active state', async ({ window }) => {
  const mayhem = window.locator('.mode-btn', { hasText: 'Mayhem' })
  const classic = window.locator('.mode-btn', { hasText: 'Classic' })
  await classic.click()
  await expect(classic).toHaveClass(/active/)
  await expect(mayhem).not.toHaveClass(/active/)
})

test('mode toggle: clicking Mayhem again restores Mayhem active', async ({ window }) => {
  const mayhem = window.locator('.mode-btn', { hasText: 'Mayhem' })
  const classic = window.locator('.mode-btn', { hasText: 'Classic' })
  await classic.click()
  await mayhem.click()
  await expect(mayhem).toHaveClass(/active/)
  await expect(classic).not.toHaveClass(/active/)
})

test('mode toggle: Champions page shows Annie in Mayhem mode', async ({ window }) => {
  // Ensure Mayhem is active
  await window.locator('.mode-btn', { hasText: 'Mayhem' }).click()
  await window.locator('.nav-item', { hasText: 'Champions' }).click()
  // Clear min-games filter to show all champions including low-game-count ones
  await window.locator('.sort-btn', { hasText: 'All' }).click()
  await expect(window.locator('td', { hasText: 'Annie' })).toBeVisible({ timeout: 10_000 })
})

test('mode toggle: Champions page shows Lux in Classic mode, not Annie', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Champions' }).click()
  await window.locator('.mode-btn', { hasText: 'Classic' }).click()
  await window.locator('.sort-btn', { hasText: 'All' }).click()
  await expect(window.locator('td', { hasText: 'Lux' })).toBeVisible({ timeout: 10_000 })
  await expect(window.locator('td', { hasText: 'Annie' })).not.toBeVisible()
})

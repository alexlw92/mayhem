import { test, expect } from './fixtures'

async function goToAugments(window: import('@playwright/test').Page) {
  await window.locator('.nav-item', { hasText: 'Augments' }).click()
  await window.locator('.mode-btn', { hasText: 'Mayhem' }).click()
  await expect(window.locator('.page-title', { hasText: 'Augments' })).toBeVisible()
}

test('Augments page renders with page title', async ({ window }) => {
  await goToAugments(window)
  await expect(window.locator('.page-title', { hasText: 'Augments' })).toBeVisible()
})

test('rarity All filter is active by default', async ({ window }) => {
  await goToAugments(window)
  // First .aug-btn is the rarity "All" button
  await expect(window.locator('.aug-btn', { hasText: 'All' }).first()).toHaveClass(/active/)
})

test('seeded augments appear after clearing min-picks filter', async ({ window }) => {
  await goToAugments(window)
  // Default minPicks=20 hides our 1-pick augments.
  // There are two "All" aug-btns: rarity (index 0) and min-picks (index 1).
  await window.locator('.aug-btn', { hasText: 'All' }).nth(1).click()
  // Augments 300-302 have no metadata — displayed as "Augment NNN"
  await expect(window.getByText('Augment 300')).toBeVisible({ timeout: 10_000 })
})

test('min-picks filter 20 hides low-pick augments', async ({ window }) => {
  await goToAugments(window)
  await window.locator('.aug-btn', { hasText: 'All' }).nth(1).click()
  await window.getByText('Augment 300').waitFor({ timeout: 10_000 })
  // Re-apply min-picks 20 — 1-pick augments disappear
  await window.locator('.aug-btn', { hasText: '20' }).click()
  await expect(window.getByText('Augment 300')).not.toBeVisible()
})

test('clicking an augment row opens augment detail', async ({ window }) => {
  await goToAugments(window)
  await window.locator('.aug-btn', { hasText: 'All' }).nth(1).click()
  await window.getByText('Augment 300').waitFor({ timeout: 10_000 })
  await window.locator('tbody tr', { hasText: /Augment \d+/ }).first().click()
  // AugmentDetail back button is unique to detail view
  await expect(window.getByRole('button', { name: '←', exact: true })).toBeVisible({ timeout: 5_000 })
})

test('augment detail back button returns to Augments', async ({ window }) => {
  await goToAugments(window)
  await window.locator('.aug-btn', { hasText: 'All' }).nth(1).click()
  await window.getByText('Augment 300').first().waitFor({ timeout: 10_000 })
  await window.locator('tbody tr', { hasText: /Augment \d+/ }).first().click()
  await window.getByRole('button', { name: '←', exact: true }).waitFor({ timeout: 5_000 })
  // AugmentDetail back button has text exactly "←" (no "Back" text)
  await window.getByRole('button', { name: '←', exact: true }).click()
  await expect(window.locator('.page-title', { hasText: 'Augments' })).toBeVisible()
})

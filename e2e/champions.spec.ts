import { test, expect } from './fixtures'

// Each test navigates to Champions and removes the min-games filter
// so our seeded test data (Annie=3 games, Teemo=2 games) is visible.
test.beforeEach(async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Champions' }).click()
  // Ensure Mayhem (2400) mode — seeded Annie and Teemo are in queueId 2400
  await window.locator('.mode-btn', { hasText: 'Mayhem' }).click()
  // Remove min-games filter so all champions show regardless of game count
  await window.locator('.sort-btn', { hasText: 'All' }).click()
  // Wait for at least one visible champion row (hidden pages also have tbody tr in DOM)
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
})

test('shows Annie and Teemo rows from seeded Mayhem data', async ({ window }) => {
  await expect(window.locator('td', { hasText: 'Annie' }).first()).toBeVisible()
  await expect(window.locator('td', { hasText: 'Teemo' }).first()).toBeVisible()
})

test('default sort is by games descending — Annie (3 games) before Teemo (2 games)', async ({ window }) => {
  // Scope to visible rows — hidden pages also have tbody tr in DOM
  const rows = window.locator('tbody tr:visible')
  const allTexts = await rows.allTextContents()
  const annieIdx = allTexts.findIndex(t => t.includes('Annie'))
  const teemoIdx = allTexts.findIndex(t => t.includes('Teemo'))
  expect(annieIdx, 'Annie should be visible').toBeGreaterThanOrEqual(0)
  expect(teemoIdx, 'Teemo should be visible').toBeGreaterThanOrEqual(0)
  // Annie (3 games) must appear before Teemo (2 games) — sort is games DESC
  expect(annieIdx).toBeLessThan(teemoIdx)
})

test('clicking Win Rate header re-sorts the table and shows sort arrow', async ({ window }) => {
  // Use :visible to avoid strict mode from PlayerDetail's champion table in hidden Players div
  await window.locator('th:visible', { hasText: 'Win Rate' }).click()
  // Sort arrow should appear on the header
  await expect(window.locator('th:visible', { hasText: /Win Rate.*[▼▲]/ })).toBeVisible()
  // Table still has rows (scope to visible — hidden pages also have tbody tr in DOM)
  await expect(window.locator('tbody tr:visible').first()).toBeVisible()
})

test('min-games filter 20 hides all seeded champions', async ({ window }) => {
  await window.locator('.sort-btn', { hasText: '20' }).click()
  // Our seeded data has max 3 games — no row passes the 20-game threshold
  // Use :visible scope to avoid strict mode violation from hidden pages' champion cells
  await expect(window.locator('td:visible', { hasText: 'Annie' })).not.toBeVisible()
  await expect(window.locator('td:visible', { hasText: 'Teemo' })).not.toBeVisible()
})

test('search filters by champion name', async ({ window }) => {
  await window.locator('.search-input').fill('Ann')
  // Use :visible to avoid strict mode from hidden pages' champion cells
  await expect(window.locator('td:visible', { hasText: 'Annie' })).toBeVisible()
  await expect(window.locator('td:visible', { hasText: 'Teemo' })).not.toBeVisible()
})

test('clicking a champion row opens champion detail', async ({ window }) => {
  // Click the Annie row
  await window.locator('td', { hasText: 'Annie' }).first().click()
  // ChampionDetail shows champion name as an <h2>
  await expect(window.locator('h2', { hasText: 'Annie' })).toBeVisible({ timeout: 5_000 })
})

test('champion detail shows augments and items tabs', async ({ window }) => {
  await window.locator('td', { hasText: 'Annie' }).first().click()
  // Use :visible to avoid strict mode from PlayerDetail's augments/items buttons in hidden Players div
  await expect(window.locator('button:visible', { hasText: /^augments$/ })).toBeVisible({ timeout: 5_000 })
  await expect(window.locator('button:visible', { hasText: /^items$/ })).toBeVisible()
})

test('champion detail back button returns to Champions list', async ({ window }) => {
  await window.locator('td', { hasText: 'Annie' }).first().click()
  await window.locator('button', { hasText: '← Back' }).click()
  await expect(window.locator('.page-title', { hasText: 'Champions' })).toBeVisible()
})

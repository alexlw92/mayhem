import { test, expect } from './fixtures'

test.beforeEach(async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Players' }).click()
  await window.locator('.mode-btn', { hasText: 'Mayhem' }).click()
  await expect(window.locator('.page-title', { hasText: 'Players' })).toBeVisible()
  await window.locator('button', { hasText: /^Leaderboard$/ }).click()
})

test.afterEach(async ({ window }) => {
  try {
    const back = window.locator('button', { hasText: '← Back' }).first()
    if (await back.isVisible({ timeout: 500 })) await back.click()
    const recent = window.locator('button', { hasText: /^Recent$/ })
    if (await recent.isVisible({ timeout: 500 })) await recent.click()
  } catch { /* already clean */ }
})

test('leaderboard shows both seeded players', async ({ window }) => {
  await expect(window.locator('td', { hasText: 'E2EPlayer#NA1' }).first()).toBeVisible({ timeout: 10_000 })
  await expect(window.locator('td', { hasText: 'E2ECoplay#NA1' }).first()).toBeVisible()
})

test('leaderboard first row is E2EPlayer (highest elo)', async ({ window }) => {
  const rows = window.locator('tbody tr:visible')
  await rows.first().waitFor({ timeout: 10_000 })
  expect(await rows.first().textContent()).toContain('E2EPlayer#NA1')
})

test('leaderboard shows elo rating for top player', async ({ window }) => {
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
  await expect(window.locator('td:visible', { hasText: '1513' }).first()).toBeVisible()
})

test('leaderboard shows win rate for top player', async ({ window }) => {
  const rows = window.locator('tbody tr:visible')
  await rows.first().waitFor({ timeout: 10_000 })
  const lastCell = rows.first().locator('td').last()
  await expect(lastCell).toContainText('60%')
})

test('clicking leaderboard row opens PlayerDetail', async ({ window }) => {
  await window.locator('tbody tr:visible', { hasText: 'E2EPlayer#NA1' }).click({ timeout: 10_000 })
  await expect(window.locator('.page-title', { hasText: 'E2EPlayer#NA1' })).toBeVisible({ timeout: 10_000 })
})

test('Recent toggle restores search view', async ({ window }) => {
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
  await window.locator('button', { hasText: /^Recent$/ }).click()
  await expect(window.locator('input[placeholder="Search by name…"]')).toBeVisible()
})

test('Classic mode shows empty state when no players meet minGames threshold', async ({ window }) => {
  await window.locator('.mode-btn', { hasText: 'Classic' }).click()
  await expect(window.getByText('No elo ratings yet')).toBeVisible({ timeout: 5_000 })
})

test('Sync Leaderboard button is visible and enabled when leaderboard data loads', async ({ window }) => {
  // beforeEach already navigated to Leaderboard tab
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
  const btn = window.locator('button', { hasText: 'Sync Leaderboard' })
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
})

test('Sync Leaderboard button returns to ready state after click', async ({ window }) => {
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
  const btn = window.locator('button', { hasText: 'Sync Leaderboard' })
  await btn.click()
  // Button may briefly show "Queued…" — verify it returns to normal label
  await expect(window.locator('button', { hasText: 'Sync Leaderboard' })).toBeVisible({ timeout: 5_000 })
})

test('sync button label changes to "Sync Recent Players" when switching to Recent tab', async ({ window }) => {
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
  await expect(window.locator('button', { hasText: 'Sync Leaderboard' })).toBeVisible()
  await window.locator('button', { hasText: /^Recent$/ }).click()
  await expect(window.locator('button', { hasText: 'Sync Recent Players' })).toBeVisible()
})

test('Sync Recent Players button is disabled when no recents are loaded', async ({ window }) => {
  await window.locator('tbody tr:visible').first().waitFor({ timeout: 10_000 })
  await window.locator('button', { hasText: /^Recent$/ }).click()
  // Clear any recents left by previous tests (elo.spec.ts adds entries via search)
  while (await window.locator('.lb-remove-btn').first().isVisible({ timeout: 500 }).catch(() => false)) {
    await window.locator('.lb-remove-btn').first().click()
  }
  const btn = window.locator('button', { hasText: 'Sync Recent Players' })
  await expect(btn).toBeVisible()
  await expect(btn).toBeDisabled()
})

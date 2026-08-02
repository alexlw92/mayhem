import { test, expect } from './fixtures'

// Search for e2e-p1 and open their player detail
async function openE2EPlayer(window: import('@playwright/test').Page) {
  await window.locator('.nav-item', { hasText: 'Players' }).click()
  await window.locator('.mode-btn', { hasText: 'Mayhem' }).click()
  await expect(window.locator('.page-title', { hasText: 'Players' })).toBeVisible()

  // Confirm we're definitely in PlayerList (not PlayerDetail) before searching
  const searchInput = window.locator('input[placeholder="Search by name…"]')
  await searchInput.waitFor({ timeout: 5_000 })
  await searchInput.fill('E2EPlayer')
  // Wait for debounce + DB response → dropdown appears
  await window.locator('.recent-dropdown').waitFor({ timeout: 5_000 })
  await window.locator('.recent-item', { hasText: 'E2EPlayer#NA1' }).click()
  // Wait for player detail to load — loading spinner hides tab buttons until data arrives
  await window.locator('button', { hasText: 'matches' }).waitFor({ timeout: 20_000 })
}

test('search by E2EPlayer shows matching player in dropdown', async ({ window }) => {
  await window.locator('.nav-item', { hasText: 'Players' }).click()
  const searchInput = window.locator('input[placeholder="Search by name…"]')
  await searchInput.fill('E2EPlayer')
  await window.locator('.recent-dropdown').waitFor({ timeout: 5_000 })
  await expect(window.locator('.recent-item', { hasText: 'E2EPlayer#NA1' })).toBeVisible()
})

test('clicking search result opens player detail with player name', async ({ window }) => {
  await openE2EPlayer(window)
  await expect(window.locator('.page-title', { hasText: 'E2EPlayer#NA1' })).toBeVisible()
})

test('player detail: matches tab shows match cards', async ({ window }) => {
  await openE2EPlayer(window)
  // Matches tab is active by default
  await expect(window.locator('.match-card').first()).toBeVisible({ timeout: 10_000 })
})

test('player detail: champions tab shows Annie and Teemo for Mayhem mode', async ({ window }) => {
  await openE2EPlayer(window)
  await window.locator('button', { hasText: /^champions$/ }).click()
  // Player champion stats: Annie (3 games), Teemo (2 games) for queueId=2400
  await expect(window.locator('td', { hasText: 'Annie' }).first()).toBeVisible({ timeout: 10_000 })
  await expect(window.locator('td', { hasText: 'Teemo' }).first()).toBeVisible()
})

test('player detail: augments tab shows augments picked by e2e-p1', async ({ window }) => {
  await openE2EPlayer(window)
  // .first() picks the PlayerDetail button; ChampionDetail also has an augments tab in the DOM
  await window.locator('button', { hasText: /^augments$/ }).first().click()
  // e2e-p1 picked augments 300, 301, 302 in match 1001
  // AugmentStatsTable in player detail has no min-picks filter, so all show directly
  await expect(window.locator('td', { hasText: 'Augment 300' }).first()).toBeVisible({ timeout: 10_000 })
})

test('player detail: coplayers tab shows E2ECoplay#NA1', async ({ window }) => {
  await openE2EPlayer(window)
  await window.locator('button', { hasText: 'coplayers' }).click()
  // e2e-p2 co-played with e2e-p1 in all 5 Mayhem matches
  await expect(window.locator('td', { hasText: 'E2ECoplay#NA1' })).toBeVisible({ timeout: 10_000 })
})

test('player detail: back button returns to Players list', async ({ window }) => {
  await openE2EPlayer(window)
  await window.locator('button', { hasText: '← Back' }).first().click()
  await expect(window.locator('.page-title', { hasText: 'Players' })).toBeVisible()
})

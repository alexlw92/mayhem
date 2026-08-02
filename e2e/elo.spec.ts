import { test, expect } from './fixtures'

// Return to Players list after each elo test so subsequent spec files start clean.
// Without this, PlayerDetail is left open and the first openE2EPlayer call in
// players.spec.ts hits a loading race that can exceed the 10 s waitFor timeout.
test.afterEach(async ({ window }) => {
  try {
    const backBtn = window.locator('button', { hasText: '← Back' }).first()
    if (await backBtn.isVisible({ timeout: 500 })) {
      await backBtn.click()
    }
  } catch { /* not in detail view — nothing to clean up */ }
})

async function openE2EPlayerDetail(window: import('@playwright/test').Page, mode: 'Mayhem' | 'Classic' = 'Mayhem') {
  await window.locator('.nav-item', { hasText: 'Players' }).click()
  await window.locator('.mode-btn', { hasText: mode }).click()
  await expect(window.locator('.page-title', { hasText: 'Players' })).toBeVisible()
  const searchInput = window.locator('input[placeholder="Search by name…"]')
  await searchInput.fill('E2EPlayer')
  await window.locator('.recent-dropdown').waitFor({ timeout: 5_000 })
  await window.locator('.recent-item', { hasText: 'E2EPlayer#NA1' }).click()
  await window.locator('button', { hasText: 'matches' }).waitFor({ timeout: 10_000 })
}

test('player detail: elo stat card shows Mayhem rating', async ({ window }) => {
  await openE2EPlayerDetail(window, 'Mayhem')
  const eloCard = window.locator('.stat-card', { hasText: 'Elo' })
  await expect(eloCard).toBeVisible({ timeout: 10_000 })
  await expect(eloCard.locator('.stat-value')).toHaveText('1513')
})

test('player detail: elo tab shows history chart with correct header stats', async ({ window }) => {
  await openE2EPlayerDetail(window, 'Mayhem')
  await window.locator('button', { hasText: /^elo$/ }).click()
  const chart = window.locator('svg').first()
  await expect(chart).toBeVisible({ timeout: 5_000 })
  await expect(window.getByText('5 rated games')).toBeVisible()
  await expect(window.getByText('+13 all-time')).toBeVisible()
})

test('player detail: elo tab chart has one circle per rated game', async ({ window }) => {
  await openE2EPlayerDetail(window, 'Mayhem')
  await window.locator('button', { hasText: /^elo$/ }).click()
  const chart = window.locator('svg').first()
  await expect(chart).toBeVisible({ timeout: 5_000 })
  await expect(chart.locator('circle')).toHaveCount(5)
})

test('player detail: Classic mode shows separate elo rating', async ({ window }) => {
  await openE2EPlayerDetail(window, 'Classic')
  const eloCard = window.locator('.stat-card', { hasText: 'Elo' })
  await expect(eloCard).toBeVisible({ timeout: 10_000 })
  await expect(eloCard.locator('.stat-value')).toHaveText('1499')
})

test('player detail: Classic elo tab shows 2 rated games with negative all-time delta', async ({ window }) => {
  await openE2EPlayerDetail(window, 'Classic')
  await window.locator('button', { hasText: /^elo$/ }).click()
  const chart = window.locator('svg').first()
  await expect(chart).toBeVisible({ timeout: 5_000 })
  await expect(window.getByText('2 rated games')).toBeVisible()
  await expect(window.getByText('-1 all-time')).toBeVisible()
})

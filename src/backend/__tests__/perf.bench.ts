import { bench, beforeAll, afterAll } from 'vitest'
import { initDb, getPlayerStats, getChampionStats, refreshAllMatviews } from '../db'
import { getOrFetch, invalidate, clearAll } from '../queryCache'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => {
  await initDb(TEST_URL)
  // Warm caches so bench measures steady-state
  await getOrFetch('players::2400', () => getPlayerStats(undefined, 2400))
  await getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400))
})

afterAll(() => clearAll())

bench('getPlayerStats (cache warm)', async () => {
  await getOrFetch('players::2400', () => getPlayerStats(undefined, 2400))
})

bench('getPlayerStats (cache cold)', async () => {
  invalidate('players::2400')
  await getOrFetch('players::2400', () => getPlayerStats(undefined, 2400))
}, { time: 10_000 })

bench('getChampionStats (cache warm)', async () => {
  await getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400))
})

bench('getChampionStats (cache cold)', async () => {
  invalidate('champions::2400')
  await getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400))
}, { time: 10_000 })

bench('refreshAllMatviews', async () => {
  await refreshAllMatviews()
}, { time: 10_000 })

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb, insertMatches, Match } from '../db'
import { enqueueMatches, drainForTest } from '../matchQueue'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => {
  await initDb(TEST_URL)
})

async function truncate() {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE participant_augments, participant_items, participant_item_sets, participants, matches RESTART IDENTITY CASCADE`
  await db.end()
}

beforeEach(truncate)

const makeMatch = (gameId: number): Match => ({
  gameId,
  queueId: 2400,
  gameCreation: 1700000000000,
  gameDuration: 1200,
  gameVersion: '15.12',
  participants: [
    {
      puuid: `puuid-${gameId}`,
      summonerName: `Player${gameId}#NA1`,
      championId: 1,
      championName: 'Annie',
      teamId: 100,
      win: true,
      kills: 3, deaths: 1, assists: 5,
      damageDealt: 20000, damageTaken: 10000,
      goldEarned: 8000, champLevel: 10,
      augments: [],
      items: [],
    }
  ]
})

async function matchCount(): Promise<number> {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  const [row] = await db`SELECT COUNT(*)::int AS n FROM matches`
  await db.end()
  return row.n
}

describe('enqueueMatches', () => {
  it('returns batch.length immediately', () => {
    const count = enqueueMatches([makeMatch(1)])
    expect(count).toBe(1)
  })

  it('returns 0 for empty batch', () => {
    expect(enqueueMatches([])).toBe(0)
  })
})

describe('Queue 1 worker — dedup', () => {
  it('inserts new games and skips existing ones', async () => {
    await insertMatches([makeMatch(1)])
    enqueueMatches([makeMatch(1), makeMatch(2)])
    await drainForTest()
    expect(await matchCount()).toBe(2) // 1 seeded + 1 new
  })

  it('pushes nothing to Queue 2 when all games are duplicates', async () => {
    await insertMatches([makeMatch(1)])
    enqueueMatches([makeMatch(1)])
    await drainForTest()
    expect(await matchCount()).toBe(1) // still just 1
  })

  it('inserts all games when none are duplicates', async () => {
    enqueueMatches([makeMatch(10), makeMatch(11), makeMatch(12)])
    await drainForTest()
    expect(await matchCount()).toBe(3)
  })
})

describe('Queue 2 worker — batching', () => {
  it('merges multiple enqueue calls into one insert pass', async () => {
    enqueueMatches([makeMatch(1)])
    enqueueMatches([makeMatch(2)])
    enqueueMatches([makeMatch(3)])
    await drainForTest()
    expect(await matchCount()).toBe(3)
  })
})

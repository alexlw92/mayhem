import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { initDb, insertMatches, getItemBuilds } from '../db'
import type { Match } from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

let sql: ReturnType<typeof postgres>

beforeAll(async () => {
  await initDb(TEST_URL)
  sql = postgres(TEST_URL, { onnotice: () => {} })
})

afterAll(async () => { await sql.end() })

beforeEach(async () => {
  await sql`TRUNCATE participant_items, participant_augments, participants, matches, item_builds_cache RESTART IDENTITY CASCADE`
})

const CHAMP_ID = 42
const ITEMS_A = [1001, 1002, 1003, 1004, 1005]
const ITEMS_B = [1001, 1002, 1003, 2006, 2007]
const PATCH = '15.12'

function matchWith(gameId: number, items: number[], win: boolean, patch = PATCH): Match {
  return {
    gameId,
    queueId: 2400,
    gameCreation: Date.now(),
    gameDuration: 1200,
    gameVersion: patch,
    participants: [{
      puuid: `puuid-${gameId}`,
      summonerName: `Player${gameId}`,
      championId: CHAMP_ID,
      championName: 'Teemo',
      teamId: 100,
      win,
      kills: 0, deaths: 0, assists: 0,
      damageDealt: 10000, damageTaken: 5000, goldEarned: 8000, champLevel: 13,
      augments: [],
      items,
    }],
  }
}

describe('item_builds_cache table', () => {
  it('exists after initDb', async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'item_builds_cache'
    `
    const names = cols.map((r: any) => r.column_name)
    expect(names).toContain('gameVersion')
    expect(names).toContain('championId')
    expect(names).toContain('build')
    expect(names).toContain('games')
    expect(names).toContain('wins')
  })
})

describe('item_builds_cache incremental update via insertMatches', () => {
  it('inserts one row after a participant with 5 items', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    // C(5,5) = 1 combination
    expect(rows).toHaveLength(1)
    expect(rows[0].games).toBe(1)
    expect(rows[0].wins).toBe(1)
    expect(Array.isArray(rows[0].build)).toBe(true)
    expect(rows[0].build).toHaveLength(5)
  })

  it('increments games and wins on a second match with the same build', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await insertMatches([matchWith(2, ITEMS_A, false)])
    const rows = await sql`
      SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].games).toBe(2)
    expect(rows[0].wins).toBe(1)
  })

  it('does not double-count duplicate insertMatches calls (idempotent gameId)', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await insertMatches([matchWith(1, ITEMS_A, true)]) // same gameId — no-op
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    expect(rows).toHaveLength(1)
    expect(rows[0].games).toBe(1)
  })

  it('inserts C(6,5)=6 rows when a participant has 6 items', async () => {
    const sixItems = [1001, 1002, 1003, 1004, 1005, 1006]
    await insertMatches([matchWith(1, sixItems, true)])
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    expect(rows).toHaveLength(6)
  })

  it('skips participants with fewer than 5 items', async () => {
    await insertMatches([matchWith(1, [1001, 1002, 1003, 1004], true)])
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    expect(rows).toHaveLength(0)
  })

  it('stores builds from two different patches separately', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true, '15.11')])
    await insertMatches([matchWith(2, ITEMS_A, true, '15.12')])
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    const patches = rows.map((r: any) => r.gameVersion).sort()
    expect(patches).toEqual(['15.11', '15.12'])
  })
})

describe('getItemBuilds reads from cache', () => {
  it('returns empty array when no data', async () => {
    const result = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A)
    expect(result).toEqual([])
  })

  it('returns the pre-computed build after insertMatches', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    const result = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A)
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(1)
    expect(result[0].wins).toBe(1)
    expect(result[0].build).toHaveLength(5)
  })

  it('allowedIds filter: returns build when all items are allowed', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    // allowedIds is a superset of the build — should return it
    const result = await getItemBuilds(CHAMP_ID, [PATCH], [...ITEMS_A, 9999])
    expect(result).toHaveLength(1)
  })

  it('allowedIds filter: excludes build when one item is not allowed', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    // Exclude item 1005 from allowed list
    const allowed = ITEMS_A.slice(0, 4) // [1001, 1002, 1003, 1004]
    const result = await getItemBuilds(CHAMP_ID, [PATCH], allowed)
    expect(result).toHaveLength(0)
  })

  it('patch filter: excludes builds from other patches', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true, '15.11')])
    const result = await getItemBuilds(CHAMP_ID, ['15.12'], ITEMS_A)
    expect(result).toHaveLength(0)
  })

  it('aggregates builds across patches when no patch filter given', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true, '15.11')])
    await insertMatches([matchWith(2, ITEMS_A, true, '15.12')])
    const result = await getItemBuilds(CHAMP_ID, undefined, ITEMS_A)
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(2)
  })

  it('returns builds ordered by games descending', async () => {
    // ITEMS_A: 1 game, ITEMS_B: 3 games (share 3 items but different combos)
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await insertMatches([matchWith(2, ITEMS_B, true)])
    await insertMatches([matchWith(3, ITEMS_B, false)])
    await insertMatches([matchWith(4, ITEMS_B, true)])
    const allowed = [...new Set([...ITEMS_A, ...ITEMS_B])]
    const result = await getItemBuilds(CHAMP_ID, [PATCH], allowed)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].games).toBeGreaterThanOrEqual(result[i + 1].games)
    }
  })
})

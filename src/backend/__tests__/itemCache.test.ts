import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { initDb, insertMatches, refreshAllMatviews, getItemBuilds, getItemPickRates } from '../db'
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
  await sql`TRUNCATE participant_item_sets, item_picks_cache, item_builds_cache, participant_items, participant_augments, participants, matches RESTART IDENTITY CASCADE`
  await sql`REFRESH MATERIALIZED VIEW player_stats_cache`
  await sql`REFRESH MATERIALIZED VIEW champion_stats_cache`
  await sql`REFRESH MATERIALIZED VIEW augment_stats_cache`
  await sql`REFRESH MATERIALIZED VIEW player_champion_stats_cache`
  await sql`REFRESH MATERIALIZED VIEW player_augment_stats_cache`
  await sql`REFRESH MATERIALIZED VIEW augment_champion_stats_cache`
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
      items: items.map((id, slot) => ({ id, slot })),
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
    await refreshAllMatviews()
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
    await refreshAllMatviews()
    await insertMatches([matchWith(2, ITEMS_A, false)])
    await refreshAllMatviews()
    const rows = await sql`
      SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].games).toBe(2)
    expect(rows[0].wins).toBe(1)
  })

  it('does not double-count duplicate insertMatches calls (idempotent gameId)', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await refreshAllMatviews()
    await insertMatches([matchWith(1, ITEMS_A, true)]) // same gameId — no-op
    await refreshAllMatviews()
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    expect(rows).toHaveLength(1)
    expect(rows[0].games).toBe(1)
  })

  it('inserts C(6,5)=6 rows when a participant has 6 items', async () => {
    const sixItems = [1001, 1002, 1003, 1004, 1005, 1006]
    await insertMatches([matchWith(1, sixItems, true)])
    await refreshAllMatviews()
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    expect(rows).toHaveLength(6)
  })

  it('skips participants with fewer than 5 items', async () => {
    await insertMatches([matchWith(1, [1001, 1002, 1003, 1004], true)])
    await refreshAllMatviews()
    const rows = await sql`SELECT * FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    expect(rows).toHaveLength(0)
  })

  it('stores builds from two different patches separately', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true, '15.11')])
    await refreshAllMatviews()
    await insertMatches([matchWith(2, ITEMS_A, true, '15.12')])
    await refreshAllMatviews()
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
    await refreshAllMatviews()
    const result = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A)
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(1)
    expect(result[0].wins).toBe(1)
    expect(result[0].build).toHaveLength(5)
  })

  it('allowedIds filter: returns build when all items are allowed', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await refreshAllMatviews()
    // allowedIds is a superset of the build — should return it
    const result = await getItemBuilds(CHAMP_ID, [PATCH], [...ITEMS_A, 9999])
    expect(result).toHaveLength(1)
  })

  it('allowedIds filter: excludes build when one item is not allowed', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await refreshAllMatviews()
    // Exclude item 1005 from allowed list
    const allowed = ITEMS_A.slice(0, 4) // [1001, 1002, 1003, 1004]
    const result = await getItemBuilds(CHAMP_ID, [PATCH], allowed)
    expect(result).toHaveLength(0)
  })

  it('patch filter: excludes builds from other patches', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true, '15.11')])
    await refreshAllMatviews()
    const result = await getItemBuilds(CHAMP_ID, ['15.12'], ITEMS_A)
    expect(result).toHaveLength(0)
  })

  it('aggregates builds across patches when no patch filter given', async () => {
    await insertMatches([matchWith(1, ITEMS_A, true, '15.11')])
    await refreshAllMatviews()
    await insertMatches([matchWith(2, ITEMS_A, true, '15.12')])
    await refreshAllMatviews()
    const result = await getItemBuilds(CHAMP_ID, undefined, ITEMS_A)
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(2)
  })

  it('returns builds ordered by games descending', async () => {
    // ITEMS_A: 1 game, ITEMS_B: 3 games (share 3 items but different combos)
    await insertMatches([matchWith(1, ITEMS_A, true)])
    await refreshAllMatviews()
    await insertMatches([matchWith(2, ITEMS_B, true)])
    await refreshAllMatviews()
    await insertMatches([matchWith(3, ITEMS_B, false)])
    await refreshAllMatviews()
    await insertMatches([matchWith(4, ITEMS_B, true)])
    await refreshAllMatviews()
    const allowed = [...new Set([...ITEMS_A, ...ITEMS_B])]
    const result = await getItemBuilds(CHAMP_ID, [PATCH], allowed)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].games).toBeGreaterThanOrEqual(result[i + 1].games)
    }
  })
})

// ─── Queue ID isolation ────────────────────────────────────────────────────────

function matchWithQueue(gameId: number, items: number[], win: boolean, queueId: number): Match {
  return { ...matchWith(gameId, items, win), queueId }
}

describe('item_builds_cache queue ID isolation', () => {
  it('has a queueId column after migration', async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'item_builds_cache' AND column_name = 'queueId'
    `
    expect(cols).toHaveLength(1)
  })

  it('stores separate rows per queueId for the same champion and build', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2400)])
    await refreshAllMatviews()
    await insertMatches([matchWithQueue(2, ITEMS_A, false, 2450)])
    await refreshAllMatviews()
    const rows = await sql`SELECT "queueId", games FROM item_builds_cache WHERE "championId" = ${CHAMP_ID}`
    const q2400 = rows.filter((r: any) => r.queueId === 2400)
    const q2450 = rows.filter((r: any) => r.queueId === 2450)
    expect(q2400).toHaveLength(1)
    expect(q2450).toHaveLength(1)
    expect(q2400[0].games).toBe(1)
    expect(q2450[0].games).toBe(1)
  })

  it('getItemBuilds with queueId=2400 does not return 2450 games', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2450)])
    await refreshAllMatviews()
    const result = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A, 2400)
    expect(result).toHaveLength(0)
  })

  it('getItemBuilds with queueId=2450 does not return 2400 games', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2400)])
    await refreshAllMatviews()
    const result = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A, 2450)
    expect(result).toHaveLength(0)
  })

  it('getItemBuilds returns 2450 data when queried with queueId=2450', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2450)])
    await refreshAllMatviews()
    const result = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A, 2450)
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(1)
    expect(result[0].wins).toBe(1)
  })

  it('accumulates multiple 2450 games without affecting 2400 total', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2400)])
    await refreshAllMatviews()
    await insertMatches([matchWithQueue(2, ITEMS_A, true, 2450)])
    await refreshAllMatviews()
    await insertMatches([matchWithQueue(3, ITEMS_A, false, 2450)])
    await refreshAllMatviews()
    const r2400 = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A, 2400)
    const r2450 = await getItemBuilds(CHAMP_ID, [PATCH], ITEMS_A, 2450)
    expect(r2400[0].games).toBe(1)
    expect(r2450[0].games).toBe(2)
    expect(r2450[0].wins).toBe(1)
  })
})

describe('item_picks_cache queue ID isolation', () => {
  it('has a queueId column after migration', async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'item_picks_cache' AND column_name = 'queueId'
    `
    expect(cols).toHaveLength(1)
  })

  it('stores separate pick rows per queueId', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2400)])
    await refreshAllMatviews()
    await insertMatches([matchWithQueue(2, ITEMS_A, false, 2450)])
    await refreshAllMatviews()
    const rows = await sql`
      SELECT "queueId", picks FROM item_picks_cache
      WHERE "championId" = ${CHAMP_ID} AND "itemId" = ${ITEMS_A[0]}
    `
    const q2400 = rows.filter((r: any) => r.queueId === 2400)
    const q2450 = rows.filter((r: any) => r.queueId === 2450)
    expect(q2400).toHaveLength(1)
    expect(q2450).toHaveLength(1)
  })

  it('item_picks_cache has no rows for 2400 when only 2450 games inserted', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2450)])
    await refreshAllMatviews()
    const rows = await sql`
      SELECT * FROM item_picks_cache
      WHERE "championId" = ${CHAMP_ID} AND "queueId" = 2400
    `
    expect(rows).toHaveLength(0)
  })

  it('item_picks_cache stores picks with correct wins per queue', async () => {
    await insertMatches([matchWithQueue(1, ITEMS_A, true, 2400)])
    await refreshAllMatviews()
    await insertMatches([matchWithQueue(2, ITEMS_A, false, 2450)])
    await refreshAllMatviews()
    const row2400 = await sql`
      SELECT picks, wins FROM item_picks_cache
      WHERE "championId" = ${CHAMP_ID} AND "queueId" = 2400 AND "itemId" = ${ITEMS_A[0]}
    `
    const row2450 = await sql`
      SELECT picks, wins FROM item_picks_cache
      WHERE "championId" = ${CHAMP_ID} AND "queueId" = 2450 AND "itemId" = ${ITEMS_A[0]}
    `
    expect(row2400).toHaveLength(1)
    expect(row2400[0].picks).toBe(1)
    expect(row2400[0].wins).toBe(1)
    expect(row2450).toHaveLength(1)
    expect(row2450[0].picks).toBe(1)
    expect(row2450[0].wins).toBe(0)
  })
})

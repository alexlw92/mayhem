import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb, insertMatches, Match, getPlayerPerformance, buildPlayerPerformanceCache, getPerformancePercentiles, markPerfDirty, flushDirtyPerfCache, rebuildMissingPerfPairs, flushPendingCaches } from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => {
  await initDb(TEST_URL)
})

async function truncate() {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE sync_queue, player_sync_times, participant_augments, participant_items, participants, matches,
    champion_stats_cache, augment_stats_cache, player_stats_cache,
    player_champion_stats_cache, augment_champion_stats_cache, player_augment_stats_cache,
    player_performance_cache, item_builds_cache, item_picks_cache,
    item_archetypes_cache, player_elo, elo_history, pending_cache_games
    RESTART IDENTITY CASCADE`
  await db.end()
}

async function queryChampCache(championId: number, version = '15.12', queueId = 2400) {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  const [row] = await db`
    SELECT * FROM champion_stats_cache
    WHERE "championId" = ${championId} AND "gameVersion" = ${version} AND "queueId" = ${queueId}
  `
  await db.end()
  return row
}

beforeEach(async () => {
  await truncate()
})

// Game: team 100 (Kayle: 4k, OtherChamp: 3k), team 200 (Lux: 2k)
// Kayle total_team_kills = 4+3 = 7, Lux total_team_kills = 2
function makeGame(): Match {
  return {
    gameId: 9001,
    queueId: 2400,
    gameCreation: Date.now(),
    gameDuration: 1200,
    gameVersion: '15.12',
    participants: [
      { puuid: 'p1', summonerName: 'P1', championId: 10, championName: 'Kayle',
        teamId: 100, win: true, kills: 4, deaths: 1, assists: 3,
        damageDealt: 50000, damageTaken: 20000, goldEarned: 12000, champLevel: 15, augments: [] },
      { puuid: 'p2', summonerName: 'P2', championId: 11, championName: 'Other',
        teamId: 100, win: true, kills: 3, deaths: 2, assists: 4,
        damageDealt: 35000, damageTaken: 18000, goldEarned: 10000, champLevel: 13, augments: [] },
      { puuid: 'p3', summonerName: 'P3', championId: 20, championName: 'Lux',
        teamId: 200, win: false, kills: 2, deaths: 4, assists: 1,
        damageDealt: 25000, damageTaken: 30000, goldEarned: 7000, champLevel: 11, augments: [] },
    ]
  }
}

// p1 plays Kayle in 2 games on team 100.
// Game 1: p1 (4k+3a, gold=12000, dur=1200), p2 on same team (3k), p3 on t200 (2k)
// Game 2: p1 (1k+1a, gold=9000, dur=1000), p4 on same team (2k), p5 on t200 (3k)
//
// p1 KP%:  game1=(4+3)/(4+3)=1.0, game2=(1+1)/(1+2)=0.667 → weighted: (7+2)/(7+3)=0.9
// Global Kayle KP% = same as p1 (only p1 plays Kayle) → kpDelta ≈ 0
function makeGames(): Match[] {
  return [
    {
      gameId: 9001, queueId: 2400, gameCreation: 1000, gameDuration: 1200, gameVersion: '15.12',
      participants: [
        { puuid: 'p1', summonerName: 'P1', championId: 10, championName: 'Kayle',
          teamId: 100, win: true, kills: 4, deaths: 1, assists: 3,
          damageDealt: 50000, damageTaken: 20000, goldEarned: 12000, champLevel: 15, augments: [100] },
        { puuid: 'p2', summonerName: 'P2', championId: 11, championName: 'Other',
          teamId: 100, win: true, kills: 3, deaths: 2, assists: 4,
          damageDealt: 30000, damageTaken: 18000, goldEarned: 9000, champLevel: 13, augments: [] },
        { puuid: 'p3', summonerName: 'P3', championId: 20, championName: 'Lux',
          teamId: 200, win: false, kills: 2, deaths: 4, assists: 2,
          damageDealt: 20000, damageTaken: 30000, goldEarned: 6000, champLevel: 11, augments: [] },
      ]
    },
    {
      gameId: 9002, queueId: 2400, gameCreation: 2000, gameDuration: 1000, gameVersion: '15.12',
      participants: [
        { puuid: 'p1', summonerName: 'P1', championId: 10, championName: 'Kayle',
          teamId: 100, win: true, kills: 1, deaths: 0, assists: 1,
          damageDealt: 30000, damageTaken: 10000, goldEarned: 9000, champLevel: 14, augments: [100] },
        { puuid: 'p4', summonerName: 'P4', championId: 11, championName: 'Other',
          teamId: 100, win: true, kills: 2, deaths: 1, assists: 3,
          damageDealt: 25000, damageTaken: 15000, goldEarned: 8000, champLevel: 12, augments: [] },
        { puuid: 'p5', summonerName: 'P5', championId: 20, championName: 'Lux',
          teamId: 200, win: false, kills: 3, deaths: 2, assists: 2,
          damageDealt: 22000, damageTaken: 28000, goldEarned: 7500, champLevel: 12, augments: [] },
      ]
    }
  ]
}

const championMap: Record<number, { name: string; tags: string[] }> = {
  10: { name: 'Kayle', tags: ['Fighter', 'Support'] },
  11: { name: 'Other', tags: ['Tank'] },
  20: { name: 'Lux',   tags: ['Mage', 'Support'] },
}

describe('getPlayerPerformance', () => {
  it('returns zero metrics for unknown player', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('unknown', championMap, ['15.12'], 2400)
    expect(result.poolUniqueChampions).toBe(0)
    expect(result.kpDelta).toBe(0)
    expect(result.dpmDelta).toBe(0)
    expect(result.gpmDelta).toBe(0)
    expect(result.classBuckets).toHaveLength(0)
  })

  it('reports correct pool depth', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    expect(result.poolUniqueChampions).toBe(1)
    expect(result.poolTopChampions).toHaveLength(1)
    expect(result.poolTopChampions[0].championId).toBe(10)
    expect(result.poolTopChampions[0].games).toBe(2)
    expect(result.poolTop3Concentration).toBe(1)
  })

  it('buckets champion games by primary role tag', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    expect(result.classBuckets).toHaveLength(1)
    expect(result.classBuckets[0].class).toBe('Fighter')
    expect(result.classBuckets[0].games).toBe(2)
    expect(result.classBuckets[0].winRate).toBe(1)
  })

  it('kpDelta is ~0 when player is sole representative of their champion', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    // p1 is the only Kayle player so global Kayle KP% === p1's KP%
    expect(Math.abs(result.kpDelta)).toBeLessThan(0.01)
  })
})

describe('champion_stats_cache total_team_kills and total_gold', () => {
  it('accumulates correct team kills and gold per champion', async () => {
    await insertMatches([makeGame()])
    const kayle = await queryChampCache(10)
    expect(Number(kayle.total_team_kills)).toBe(7)   // team 100: 4+3
    expect(Number(kayle.total_gold)).toBe(12000)
    const lux = await queryChampCache(20)
    expect(Number(lux.total_team_kills)).toBe(2)     // team 200: 2
    expect(Number(lux.total_gold)).toBe(7000)
  })
})

async function queryPlayerChampCache(puuid: string, championId: number, version = '15.12', queueId = 2400) {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  const rows = await db`
    SELECT * FROM player_champion_stats_cache
    WHERE puuid = ${puuid} AND "championId" = ${championId} AND "gameVersion" = ${version} AND "queueId" = ${queueId}
  `
  await db.end()
  return rows[0]
}

describe('player_champion_stats_cache total_gold and total_team_kills', () => {
  it('accumulates total_gold and total_team_kills per player-champion', async () => {
    await insertMatches(makeGames())
    const row = await queryPlayerChampCache('p1', 10)
    // game1: gold=12000, team_kills=7 (4+3); game2: gold=9000, team_kills=3 (1+2)
    expect(Number(row.total_gold)).toBe(21000)
    expect(Number(row.total_team_kills)).toBe(10)
  })
})

describe('player_augment_stats_cache', () => {
  it('accumulates player augment pick counts', async () => {
    await insertMatches(makeGames())
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    const [row] = await db`
      SELECT pick_count FROM player_augment_stats_cache
      WHERE puuid = 'p1' AND "augmentId" = 100 AND "gameVersion" = '15.12' AND "queueId" = 2400
    `
    await db.end()
    // p1 picks augId=100 in both games
    expect(Number(row.pick_count)).toBe(2)
  })
})

describe('player_performance_cache / buildPlayerPerformanceCache', () => {
  it('populates correct metrics for sole champion representative', async () => {
    await insertMatches(makeGames())
    await buildPlayerPerformanceCache('15.12', 2400)

    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    const [row] = await db`
      SELECT * FROM player_performance_cache
      WHERE puuid = 'p1' AND "gameVersion" = '15.12' AND "queueId" = 2400
    `
    await db.end()

    expect(row.games).toBe(2)
    // p1 plays Kayle with 100% WR → cpq = 1.0 - 0.5 = 0.5
    expect(Number(row.cpq)).toBeCloseTo(0.5)
    // p1 is sole Kayle player → delta vs expected ≈ 0
    expect(Math.abs(Number(row.kp_delta))).toBeLessThan(0.01)
    expect(Math.abs(Number(row.dpm_pct))).toBeLessThan(0.01)
    expect(Math.abs(Number(row.gpm_pct))).toBeLessThan(0.01)
    // p1 is sole aug 100 picker → apq ≈ 0
    expect(Math.abs(Number(row.apq))).toBeLessThan(0.01)
  })

  it('buildPlayerPerformanceCache populates cache after insertMatches+flush', async () => {
    await insertMatches(makeGames())
    // insertMatches now only deletes stale cache and marks dirty — must flush to rebuild
    await flushDirtyPerfCache()
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    const rows = await db`SELECT * FROM player_performance_cache WHERE "gameVersion" = '15.12' AND "queueId" = 2400`
    await db.end()
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('getPerformancePercentiles', () => {
  it('returns null when fewer than 10 qualifying players', async () => {
    await insertMatches(makeGames())
    // makeGames has only 5 distinct players
    const result = await getPerformancePercentiles('p1', ['15.12'], 2400)
    expect(result).toBeNull()
  })
})

describe('getPlayerPerformance dpmPct and gpmPct', () => {
  it('includes dpmPct and gpmPct as fractional deltas', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    expect(result).toHaveProperty('dpmPct')
    expect(result).toHaveProperty('gpmPct')
    expect(typeof result.dpmPct).toBe('number')
    expect(typeof result.gpmPct).toBe('number')
    // p1 is sole Kayle player, so delta from expected ≈ 0
    expect(Math.abs(result.dpmPct)).toBeLessThan(0.01)
    expect(Math.abs(result.gpmPct)).toBeLessThan(0.01)
  })
})

describe('getPlayerPerformance cache-based computation', () => {
  it('computes kpDelta from cache tables', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    // p1 is sole Kayle player so kpDelta ≈ 0
    expect(Math.abs(result.kpDelta)).toBeLessThan(0.01)
  })

  it('computes dpmPct and gpmPct from cache tables', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    expect(Math.abs(result.dpmPct)).toBeLessThan(0.01)
    expect(Math.abs(result.gpmPct)).toBeLessThan(0.01)
  })

  it('computes augmentPickQuality from player_augment_stats_cache', async () => {
    await insertMatches(makeGames())
    const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
    expect(typeof result.augmentPickQuality).toBe('number')
    // p1 is sole picker of augId 100 so apq ≈ 0
    expect(Math.abs(result.augmentPickQuality)).toBeLessThan(0.01)
  })
})

describe('dirty perf cache machinery', () => {
  it('insertMatches immediately deletes player_performance_cache for affected pairs', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })

    // Pre-populate a perf cache row for ('15.12', 2400)
    await db`
      INSERT INTO player_performance_cache (puuid,"queueId","gameVersion",games,cpq,apq,kp_delta,dpm_pct,gpm_pct)
      VALUES ('p1', 2400, '15.12', 5, 0.1, 0.05, 0.02, 0.1, 0.1)
    `

    // Insert a match for that pair
    await insertMatches([{
      gameId: 99001, queueId: 2400, gameCreation: 1000, gameDuration: 1200, gameVersion: '15.12',
      participants: [
        { puuid: 'p1', summonerName: 'P1', championId: 10, championName: 'Kayle',
          teamId: 100, win: true, kills: 1, deaths: 0, assists: 0,
          damageDealt: 1000, damageTaken: 500, goldEarned: 3000, champLevel: 10, augments: [] },
        { puuid: 'p2', summonerName: 'P2', championId: 20, championName: 'Lux',
          teamId: 200, win: false, kills: 0, deaths: 1, assists: 0,
          damageDealt: 500, damageTaken: 1000, goldEarned: 2000, champLevel: 8, augments: [] },
      ]
    }])

    // Row must be gone immediately — not deferred
    const [row] = await db`SELECT * FROM player_performance_cache WHERE puuid = 'p1' AND "queueId" = 2400 AND "gameVersion" = '15.12'`
    expect(row).toBeUndefined()
    await db.end()
  })

  it('flushDirtyPerfCache is a no-op when nothing is dirty', async () => {
    await expect(flushDirtyPerfCache()).resolves.toBeUndefined()
  })

  it('flushDirtyPerfCache runs and clears the dirty set', async () => {
    markPerfDirty('15.12', 2400)
    // buildPlayerPerformanceCache returns early when no player_champion_stats_cache data exists
    await expect(flushDirtyPerfCache()).resolves.toBeUndefined()
    // Calling again is a no-op (set was cleared)
    await expect(flushDirtyPerfCache()).resolves.toBeUndefined()
  })

  it('rebuildMissingPerfPairs is a no-op when all pairs are present', async () => {
    // No data in player_champion_stats_cache — nothing to rebuild
    await expect(rebuildMissingPerfPairs()).resolves.toBeUndefined()
  })

  it('rebuildMissingPerfPairs rebuilds pairs missing from player_performance_cache', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })

    // insertMatches populates player_champion_stats_cache and champion_stats_cache
    // and deletes player_performance_cache — simulating the state after a crash mid-flush
    await insertMatches(makeGames())

    // Confirm perf cache is absent for this pair
    const before = await db`SELECT COUNT(*) FROM player_performance_cache WHERE "gameVersion" = '15.12' AND "queueId" = 2400`
    expect(Number(before[0].count)).toBe(0)

    // Recovery: rebuild missing pairs (dirty set is empty, as it would be after a crash/restart)
    await rebuildMissingPerfPairs()

    // Perf cache should now have rows for the affected players
    const after = await db`SELECT COUNT(*) FROM player_performance_cache WHERE "gameVersion" = '15.12' AND "queueId" = 2400`
    expect(Number(after[0].count)).toBeGreaterThan(0)

    await db.end()
  })
})

describe('flushPendingCaches', () => {
  it('is a no-op when pending_cache_games is empty', async () => {
    await expect(flushPendingCaches()).resolves.toBeUndefined()
  })

  it('populates all cache tables from pending games', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })

    // Insert raw data directly — simulating what insertMatches will do after Task 3
    await db`
      INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
      VALUES (9001, 2400, 1000, 1200, '15.12'), (9002, 2400, 2000, 1000, '15.12')
    `
    await db`
      INSERT INTO participants
        ("gameId",puuid,"summonerName","championId","championName","teamId",win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel","gameVersion","gameDuration")
      VALUES
        (9001,'p1','P1',10,'Kayle',100,true,4,1,3,50000,20000,12000,15,'15.12',1200),
        (9001,'p2','P2',11,'Other',100,true,3,2,4,30000,18000,9000,13,'15.12',1200),
        (9001,'p3','P3',20,'Lux',200,false,2,4,2,20000,30000,6000,11,'15.12',1200),
        (9002,'p1','P1',10,'Kayle',100,true,1,0,1,30000,10000,9000,14,'15.12',1000),
        (9002,'p4','P4',11,'Other',100,true,2,1,3,25000,15000,8000,12,'15.12',1000),
        (9002,'p5','P5',20,'Lux',200,false,3,2,2,22000,28000,7500,12,'15.12',1000)
    `
    await db`
      INSERT INTO participant_augments ("participantId","augmentId")
      SELECT id, 100 FROM participants WHERE puuid = 'p1'
    `
    await db`INSERT INTO pending_cache_games (game_id) VALUES (9001), (9002)`
    await db.end()

    await flushPendingCaches()

    const db2 = postgres(TEST_URL!, { onnotice: () => {} })
    const champRow = await db2`SELECT games FROM champion_stats_cache WHERE "championId" = 10 AND "gameVersion" = '15.12' AND "queueId" = 2400`
    const playerRow = await db2`SELECT games FROM player_stats_cache WHERE puuid = 'p1' AND "gameVersion" = '15.12' AND "queueId" = 2400`
    const playerChampRow = await db2`SELECT games FROM player_champion_stats_cache WHERE puuid = 'p1' AND "championId" = 10 AND "gameVersion" = '15.12' AND "queueId" = 2400`
    const augRow = await db2`SELECT pick_count FROM player_augment_stats_cache WHERE puuid = 'p1' AND "augmentId" = 100 AND "gameVersion" = '15.12' AND "queueId" = 2400`
    await db2.end()

    expect(Number(champRow[0].games)).toBe(2)
    expect(Number(playerRow[0].games)).toBe(2)
    expect(Number(playerChampRow[0].games)).toBe(2)
    expect(Number(augRow[0].pick_count)).toBe(2)
  })

  it('clears pending_cache_games after processing', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })

    await db`
      INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
      VALUES (9001, 2400, 1000, 1200, '15.12')
    `
    await db`
      INSERT INTO participants
        ("gameId",puuid,"summonerName","championId","championName","teamId",win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel","gameVersion","gameDuration")
      VALUES (9001,'p1','P1',10,'Kayle',100,true,4,1,3,50000,20000,12000,15,'15.12',1200)
    `
    await db`INSERT INTO pending_cache_games (game_id) VALUES (9001)`
    await db.end()

    await flushPendingCaches()

    const db2 = postgres(TEST_URL!, { onnotice: () => {} })
    const [{ count }] = await db2`SELECT COUNT(*) FROM pending_cache_games`
    await db2.end()
    expect(Number(count)).toBe(0)
  })

  it('deletes player_performance_cache and marks pairs dirty for later flush', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })

    await db`
      INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
      VALUES (9001, 2400, 1000, 1200, '15.12')
    `
    await db`
      INSERT INTO participants
        ("gameId",puuid,"summonerName","championId","championName","teamId",win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel","gameVersion","gameDuration")
      VALUES (9001,'p1','P1',10,'Kayle',100,true,4,1,3,50000,20000,12000,15,'15.12',1200)
    `
    await db`
      INSERT INTO player_performance_cache (puuid,"queueId","gameVersion",games,cpq,apq,kp_delta,dpm_pct,gpm_pct)
      VALUES ('p1', 2400, '15.12', 5, 0.1, 0.05, 0.02, 0.1, 0.1)
    `
    await db`INSERT INTO pending_cache_games (game_id) VALUES (9001)`
    await db.end()

    await flushPendingCaches()

    const db2 = postgres(TEST_URL!, { onnotice: () => {} })
    const [row] = await db2`SELECT * FROM player_performance_cache WHERE puuid = 'p1' AND "queueId" = 2400 AND "gameVersion" = '15.12'`
    await db2.end()
    expect(row).toBeUndefined()
  })
})

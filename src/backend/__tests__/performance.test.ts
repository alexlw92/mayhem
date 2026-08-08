import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb, insertMatches, Match, getPlayerPerformance, buildPlayerPerformanceCache, getPerformancePercentiles } from '../db'

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
    item_archetypes_cache, player_elo, elo_history
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

  it('buildPlayerPerformanceCache is called by insertMatches', async () => {
    await insertMatches(makeGames())
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    const rows = await db`SELECT * FROM player_performance_cache WHERE "gameVersion" = '15.12' AND "queueId" = 2400`
    await db.end()
    // insertMatches should have triggered buildPlayerPerformanceCache
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

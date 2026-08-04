import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb, insertMatches, Match } from '../db'

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
    player_champion_stats_cache, augment_champion_stats_cache, item_builds_cache, item_picks_cache,
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

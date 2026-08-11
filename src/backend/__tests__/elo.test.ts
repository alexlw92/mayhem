import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb, insertMatches, recomputePlayerElo, Match } from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => {
  await initDb(TEST_URL)
})

async function truncate() {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE sync_queue, player_sync_times, participant_augments, participant_items, participants, matches,
    player_performance_cache, item_builds_cache, item_picks_cache,
    item_archetypes_cache, player_elo, elo_history
    RESTART IDENTITY CASCADE`
  await db`REFRESH MATERIALIZED VIEW player_stats_cache`
  await db`REFRESH MATERIALIZED VIEW champion_stats_cache`
  await db`REFRESH MATERIALIZED VIEW augment_stats_cache`
  await db`REFRESH MATERIALIZED VIEW player_champion_stats_cache`
  await db`REFRESH MATERIALIZED VIEW player_augment_stats_cache`
  await db`REFRESH MATERIALIZED VIEW augment_champion_stats_cache`
  await db.end()
}

beforeEach(async () => {
  await truncate()
})

function makeMatch(
  gameId: number,
  gc: number,
  team1Puuids: string[],
  team2Puuids: string[],
  winningSide: 100 | 200,
  queueId = 2400
): Match {
  return {
    gameId,
    queueId,
    gameCreation: gc,
    gameDuration: 1000,
    gameVersion: '15.12',
    participants: [
      ...team1Puuids.map(puuid => ({
        puuid, summonerName: puuid, championId: 1, championName: 'Champ',
        teamId: 100, win: winningSide === 100,
        kills: 0, deaths: 0, assists: 0, damageDealt: 0, damageTaken: 0,
        goldEarned: 0, champLevel: 1, augments: [], items: []
      })),
      ...team2Puuids.map(puuid => ({
        puuid, summonerName: puuid, championId: 2, championName: 'Champ2',
        teamId: 200, win: winningSide === 200,
        kills: 0, deaths: 0, assists: 0, damageDealt: 0, damageTaken: 0,
        goldEarned: 0, champLevel: 1, augments: [], items: []
      }))
    ]
  }
}

async function getEloHistory(puuid: string, queueId = 2400) {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  const rows = await db`
    SELECT * FROM elo_history
    WHERE puuid = ${puuid} AND "queueId" = ${queueId}
    ORDER BY "gameCreation" ASC, "gameId" ASC
  `
  await db.end()
  return rows
}

async function getPlayerElo(puuid: string, queueId = 2400) {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  const [row] = await db`SELECT * FROM player_elo WHERE puuid = ${puuid} AND "queueId" = ${queueId}`
  await db.end()
  return row
}

describe('recomputePlayerElo', () => {
  it('returns 0 when player has no games', async () => {
    const n = await recomputePlayerElo('ghost', 2400)
    expect(n).toBe(0)
  })

  it('returns 0 when all games already have elo_history entries', async () => {
    await insertMatches([makeMatch(1, 1000, ['p1'], ['p2'], 100)])
    expect(await recomputePlayerElo('p1', 2400)).toBe(1)
    expect(await recomputePlayerElo('p1', 2400)).toBe(0)
  })

  it('computes elo for a new player starting from 1500', async () => {
    await insertMatches([makeMatch(1, 1000, ['p1'], ['p2'], 100)])
    await recomputePlayerElo('p1', 2400)

    const hist = await getEloHistory('p1')
    expect(hist.length).toBe(1)
    expect(Number(hist[0].elo_before)).toBe(1500)
    expect(Number(hist[0].elo_after)).toBeGreaterThan(1500)

    const pe = await getPlayerElo('p1')
    expect(Number(pe.games_rated)).toBe(1)
    expect(Number(pe.elo)).toBeCloseTo(Number(hist[0].elo_after), 10)
  })

  it('recomputes from oldest unprocessed when a game is inserted before existing ones', async () => {
    await insertMatches([
      makeMatch(1, 100, ['p1'], ['p2'], 100),
      makeMatch(3, 300, ['p1'], ['p2'], 200),
    ])
    await recomputePlayerElo('p1', 2400)

    // game at gc=200 inserted later (e.g. from another player's sync)
    await insertMatches([makeMatch(2, 200, ['p1'], ['p2'], 100)])

    const n = await recomputePlayerElo('p1', 2400)
    expect(n).toBe(2) // recomputed gc=200 and gc=300

    const hist = await getEloHistory('p1')
    expect(hist.length).toBe(3)
    expect(hist.map(h => Number(h.gameCreation))).toEqual([100, 200, 300])

    const pe = await getPlayerElo('p1')
    expect(Number(pe.games_rated)).toBe(3)
  })

  it('does not alter elo_history entries before the oldest unprocessed game', async () => {
    await insertMatches([
      makeMatch(1, 100, ['p1'], ['p2'], 100),
      makeMatch(3, 300, ['p1'], ['p2'], 200),
    ])
    await recomputePlayerElo('p1', 2400)

    const histBefore = await getEloHistory('p1')
    const eloAfterGame1 = Number(histBefore[0].elo_after)

    await insertMatches([makeMatch(2, 200, ['p1'], ['p2'], 100)])
    await recomputePlayerElo('p1', 2400)

    const histAfter = await getEloHistory('p1')
    // gc=100 entry unchanged
    expect(Number(histAfter[0].elo_after)).toBe(eloAfterGame1)
    // gc=200 uses gc=100's elo_after as its starting point
    expect(Number(histAfter[1].elo_before)).toBeCloseTo(eloAfterGame1, 10)
  })

  it('uses prior elo as starting point for a new game after existing ones', async () => {
    await insertMatches([makeMatch(1, 100, ['p1'], ['p2'], 100)])
    await recomputePlayerElo('p1', 2400)

    const hist1 = await getEloHistory('p1')
    const eloAfterGame1 = Number(hist1[0].elo_after)

    await insertMatches([makeMatch(2, 200, ['p1'], ['p2'], 100)])
    await recomputePlayerElo('p1', 2400)

    const hist2 = await getEloHistory('p1')
    expect(hist2.length).toBe(2)
    expect(Number(hist2[1].elo_before)).toBeCloseTo(eloAfterGame1, 10)
  })

  it('covers co-participants: recomputing B picks up games added via another player', async () => {
    // A and B play at gc=100
    await insertMatches([makeMatch(1, 100, ['A'], ['B'], 100)])
    await recomputePlayerElo('A', 2400)
    await recomputePlayerElo('B', 2400)

    // B has an additional game at gc=200 already processed
    await insertMatches([makeMatch(2, 200, ['B'], ['C'], 100)])
    await recomputePlayerElo('B', 2400)

    const histBefore = await getEloHistory('B')
    expect(histBefore.length).toBe(2)

    // A new game at gc=150 is inserted with both A and B
    await insertMatches([makeMatch(3, 150, ['A', 'B'], ['C', 'D'], 100)])

    const n = await recomputePlayerElo('B', 2400)
    expect(n).toBe(2) // recomputed gc=150 and gc=200

    const hist = await getEloHistory('B')
    expect(hist.length).toBe(3)
    expect(hist.map(h => Number(h.gameCreation))).toEqual([100, 150, 200])

    const pe = await getPlayerElo('B')
    expect(Number(pe.games_rated)).toBe(3)
  })

  it('is scoped to the given queueId and does not touch other queues', async () => {
    await insertMatches([
      makeMatch(1, 100, ['p1'], ['p2'], 100, 2400),
      makeMatch(2, 100, ['p1'], ['p2'], 100, 2450),
    ])

    await recomputePlayerElo('p1', 2400)

    expect((await getEloHistory('p1', 2400)).length).toBe(1)
    expect((await getEloHistory('p1', 2450)).length).toBe(0)
    expect(await getPlayerElo('p1', 2450)).toBeUndefined()
  })

  it('games_rated equals total processed games across all recomputes', async () => {
    await insertMatches([
      makeMatch(1, 100, ['p1'], ['p2'], 100),
      makeMatch(2, 200, ['p1'], ['p2'], 200),
      makeMatch(3, 300, ['p1'], ['p2'], 100),
    ])
    await recomputePlayerElo('p1', 2400)

    const pe = await getPlayerElo('p1')
    expect(Number(pe.games_rated)).toBe(3)
  })
})

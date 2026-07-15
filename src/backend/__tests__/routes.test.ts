import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { initDb, Match } from '../db'
import { createExpressApp } from '../server'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

// db.ts loads .env via dotenv.config which may set API_KEY; clear it so test requests don't need auth
delete process.env.API_KEY

const app = createExpressApp()

beforeAll(async () => {
  await initDb(TEST_URL)
})

async function truncate() {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE sync_queue, player_sync_times, participant_augments, participant_items, participants, matches,
    champion_stats_cache, augment_stats_cache, player_stats_cache,
    player_champion_stats_cache, augment_champion_stats_cache, item_builds_cache
    RESTART IDENTITY CASCADE`
  await db.end()
}

beforeEach(async () => {
  await truncate()
})

const sampleMatch: Match = {
  gameId: 5001,
  queueId: 2400,
  gameCreation: new Date('2025-06-15T10:00:00Z').getTime(),
  gameDuration: 1100,
  gameVersion: '15.12',
  participants: [
    {
      puuid: 'test-puuid-1', summonerName: 'Foo#NA1', championId: 10, championName: 'Kayle',
      teamId: 100, win: true, kills: 4, deaths: 1, assists: 6,
      damageDealt: 40000, damageTaken: 15000, goldEarned: 10000, champLevel: 14, augments: [200]
    },
    {
      puuid: 'test-puuid-2', summonerName: 'Bar#EUW', championId: 20, championName: 'Teemo',
      teamId: 200, win: false, kills: 1, deaths: 4, assists: 2,
      damageDealt: 20000, damageTaken: 25000, goldEarned: 7000, champLevel: 11, augments: []
    }
  ]
}

const sampleMatch2: Match = {
  gameId: 5002,
  queueId: 2400,
  gameCreation: new Date('2025-06-16T10:00:00Z').getTime(),
  gameDuration: 1200,
  gameVersion: '15.12',
  participants: [
    {
      puuid: 'test-puuid-1', summonerName: 'Foo#NA1', championId: 10, championName: 'Kayle',
      teamId: 100, win: true, kills: 2, deaths: 1, assists: 4,
      damageDealt: 30000, damageTaken: 12000, goldEarned: 9000, champLevel: 13, augments: []
    },
    {
      puuid: 'test-puuid-3', summonerName: 'Baz#NA1', championId: 30, championName: 'Lux',
      teamId: 100, win: true, kills: 3, deaths: 0, assists: 5,
      damageDealt: 35000, damageTaken: 10000, goldEarned: 9500, champLevel: 14, augments: []
    }
  ]
}

const sampleMatch3: Match = {
  gameId: 5003,
  queueId: 2400,
  gameCreation: new Date('2025-06-17T10:00:00Z').getTime(),
  gameDuration: 1300,
  gameVersion: '15.12',
  participants: [
    {
      puuid: 'test-puuid-1', summonerName: 'Foo#NA1', championId: 10, championName: 'Kayle',
      teamId: 100, win: false, kills: 1, deaths: 3, assists: 2,
      damageDealt: 25000, damageTaken: 18000, goldEarned: 8000, champLevel: 12, augments: []
    },
    {
      puuid: 'test-puuid-3', summonerName: 'Baz#NA1', championId: 30, championName: 'Lux',
      teamId: 100, win: false, kills: 2, deaths: 2, assists: 3,
      damageDealt: 28000, damageTaken: 14000, goldEarned: 8500, champLevel: 13, augments: []
    }
  ]
}

describe('GET /api/patches', () => {
  it('returns an empty array when DB is empty', async () => {
    const res = await request(app).get('/api/patches')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns patches after a match is inserted', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/patches')
    expect(res.status).toBe(200)
    expect(res.body).toContain('15.12')
  })
})

describe('GET /api/players', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/players')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/champions', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/champions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('POST /api/matches/bulk', () => {
  it('inserts matches and returns inserted count', async () => {
    const res = await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(1)
  })

  it('is idempotent — duplicate insert returns 0 inserted', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    expect(res.status).toBe(200)
    expect(res.body.inserted).toBe(0)
  })
})

describe('GET /api/matches/:gameId/exists', () => {
  it('returns false before insert', async () => {
    const res = await request(app).get('/api/matches/5001/exists')
    expect(res.status).toBe(200)
    expect(res.body).toBe(false)
  })

  it('returns true after insert', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/matches/5001/exists')
    expect(res.status).toBe(200)
    expect(res.body).toBe(true)
  })
})

describe('Sync queue endpoints', () => {
  it('GET /api/sync/next returns null when queue is empty', async () => {
    const res = await request(app).get('/api/sync/next?clientId=test')
    expect(res.status).toBe(200)
    expect(res.body.puuid).toBeNull()
  })

  it('GET /api/sync/next returns a PUUID after enqueue', async () => {
    await request(app).post('/api/sync/enqueue').send({ puuid: 'some-puuid' })
    const res = await request(app).get('/api/sync/next?clientId=test')
    expect(res.status).toBe(200)
    expect(res.body.puuid).toBe('some-puuid')
  })

  it('POST /api/sync/done removes the job', async () => {
    await request(app).post('/api/sync/enqueue').send({ puuid: 'done-puuid' })
    await request(app).get('/api/sync/next?clientId=test')
    const done = await request(app).post('/api/sync/done/done-puuid')
    expect(done.status).toBe(200)
    const queue = await request(app).get('/api/sync/queue')
    expect(queue.body.total).toBe(0)
  })

  it('POST /api/sync/enqueue rejects missing puuid', async () => {
    const res = await request(app).post('/api/sync/enqueue').send({})
    expect(res.status).toBe(400)
  })

  it('DELETE /api/sync/queue clears all queue entries', async () => {
    await request(app).post('/api/sync/enqueue').send({ puuid: 'test-puuid' })
    expect((await request(app).get('/api/sync/queue')).body.total).toBe(1)
    const res = await request(app).delete('/api/sync/queue')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect((await request(app).get('/api/sync/queue')).body.total).toBe(0)
  })
})

describe('GET /api/augments', () => {
  it('returns fallback name and empty iconPath when no cache is injected', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug).toBeDefined()
    expect(aug.name).toBe('Augment 200')
    expect(aug.iconPath).toBe('')
  })

  it('returns name and iconPath from injected cache', async () => {
    const appWithCache = createExpressApp({
      getAugments: () => ({
        200: { name: 'Iron Will', rarity: 1, iconPath: 'mayhem-asset://augment-icons/200.png' }
      })
    })
    await request(appWithCache).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(appWithCache).get('/api/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.name).toBe('Iron Will')
    expect(aug.iconPath).toBe('mayhem-asset://augment-icons/200.png')
    expect(aug.rarity).toBe(1)
  })

  it('filters by championId — returns augments picked by that champion', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments?championId=10')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug).toBeDefined()
    expect(aug.pickCount).toBe(1)
    expect(aug.wins).toBe(1)
  })

  it('filters by championId — returns empty for champion with no augments', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments?championId=20')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters by championId and patch — returns empty for unknown patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments?championId=10&patches=99.99')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/players/:puuid/augments', () => {
  it('returns fallback name and empty iconPath when no cache is injected', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug).toBeDefined()
    expect(aug.name).toBe('Augment 200')
    expect(aug.iconPath).toBe('')
  })

  it('returns name and iconPath from injected cache', async () => {
    const appWithCache = createExpressApp({
      getAugments: () => ({
        200: { name: 'Iron Will', rarity: 1, iconPath: 'mayhem-asset://augment-icons/200.png' }
      })
    })
    await request(appWithCache).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(appWithCache).get('/api/players/test-puuid-1/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.name).toBe('Iron Will')
    expect(aug.iconPath).toBe('mayhem-asset://augment-icons/200.png')
  })

  it('returns correct pickCount and wins', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.pickCount).toBe(1)
    expect(aug.wins).toBe(1)
  })

  it('returns empty for player with no augments', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-2/augments')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns empty for unknown patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/augments?patches=99.99')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('is idempotent — duplicate insert does not double the pickCount', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/augments')
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.pickCount).toBe(1)
  })
})

describe('GET /api/augments/:augmentId/champions', () => {
  it('returns empty array when no data', async () => {
    const res = await request(app).get('/api/augments/200/champions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns champion breakdown for a known augment', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments/200/champions')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const row = res.body[0]
    expect(row.championId).toBe(10)
    expect(row.championName).toBe('Kayle')
    expect(row.games).toBe(1)
    expect(row.wins).toBe(1)
    expect(row.avgDpm).toBeGreaterThan(0)
  })

  it('returns empty array for an augment not in any game', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments/999/champions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters by patch — returns data for matching patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments/200/champions?patches=15.12')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].championName).toBe('Kayle')
  })

  it('filters by patch — returns empty for unknown patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments/200/champions?patches=99.99')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters to a specific puuid — returns empty when that player has no picks', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments/200/champions?puuid=test-puuid-2')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters to a specific puuid — returns data when that player has picks', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/augments/200/champions?puuid=test-puuid-1')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].championName).toBe('Kayle')
  })
})

describe('Meta endpoints', () => {
  it('GET /api/meta/champions returns an object', async () => {
    const res = await request(app).get('/api/meta/champions')
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
  })

  it('GET /api/meta/augments returns an object', async () => {
    const res = await request(app).get('/api/meta/augments')
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
  })

  it('GET /api/meta/champions returns injected cache data', async () => {
    const appWithCache = createExpressApp({
      getChampions: () => ({ 64: 'Lee Sin', 1: 'Annie' })
    })
    const res = await request(appWithCache).get('/api/meta/champions')
    expect(res.body[64]).toBe('Lee Sin')
  })
})

describe('GET /api/players/:puuid/coplayers', () => {
  it('returns empty when no shared games', async () => {
    const res = await request(app).get('/api/players/test-puuid-1/coplayers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('requires >= 2 games together — single shared game returns empty', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch2] })
    const res = await request(app).get('/api/players/test-puuid-1/coplayers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns coplayer stats after 2+ shared games on same team', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch2, sampleMatch3] })
    const res = await request(app).get('/api/players/test-puuid-1/coplayers')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const row = res.body[0]
    expect(row.puuid).toBe('test-puuid-3')
    expect(row.summonerName).toBe('Baz#NA1')
    expect(row.games).toBe(2)
    expect(row.wins).toBe(1)
  })

  it('opposite-team players do not appear as coplayers', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/coplayers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters by patch — returns empty for non-matching patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch2, sampleMatch3] })
    const res = await request(app).get('/api/players/test-puuid-1/coplayers?patches=99.99')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /api/sync/enqueue-priority', () => {
  it('enqueues puuids with priority 1', async () => {
    await request(app).post('/api/sync/enqueue-priority').send({ puuids: ['p-high'] })
    const res = await request(app).get('/api/sync/queue')
    expect(res.body.total).toBe(1)
  })

  it('priority item is claimed before normal item', async () => {
    await request(app).post('/api/sync/enqueue').send({ puuid: 'p-normal' })
    await request(app).post('/api/sync/enqueue-priority').send({ puuids: ['p-high'] })
    const res = await request(app).get('/api/sync/next?clientId=test')
    expect(res.body.puuid).toBe('p-high')
  })

  it('upgrades priority on an already-queued item and resets its claim', async () => {
    await request(app).post('/api/sync/enqueue').send({ puuid: 'p-existing' })
    await request(app).get('/api/sync/next?clientId=test')
    await request(app).post('/api/sync/enqueue-priority').send({ puuids: ['p-existing'] })
    const res = await request(app).get('/api/sync/next?clientId=test2')
    expect(res.body.puuid).toBe('p-existing')
  })

  it('rejects missing puuids', async () => {
    const res = await request(app).post('/api/sync/enqueue-priority').send({})
    expect(res.status).toBe(400)
  })
})

// ─── Player endpoints ──────────────────────────────────────────────────────────

describe('GET /api/players/search', () => {
  it('returns empty array for missing query', async () => {
    const res = await request(app).get('/api/players/search')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns empty array for query shorter than 2 chars', async () => {
    const res = await request(app).get('/api/players/search?q=F')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns matching players by summonerName', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/search?q=Foo')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0].summonerName).toBe('Foo#NA1')
    expect(res.body[0].puuid).toBe('test-puuid-1')
  })

  it('returns empty array when no names match', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/search?q=zzz')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/players/:puuid/stats', () => {
  it('returns null for unknown puuid', async () => {
    const res = await request(app).get('/api/players/unknown-puuid/stats')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('returns aggregate stats for a known player', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2, sampleMatch3] })
    const res = await request(app).get('/api/players/test-puuid-1/stats')
    expect(res.status).toBe(200)
    expect(res.body.puuid).toBe('test-puuid-1')
    expect(res.body.summonerName).toBe('Foo#NA1')
    expect(res.body.games).toBe(3)
    expect(res.body.wins).toBe(2)
    expect(res.body.avgDpm).toBeGreaterThan(0)
    expect(res.body.avgGold).toBe(0)
  })

  it('returns null when patch filter matches no games', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/stats?patches=99.99')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })
})

describe('POST /api/players/bulk-stats', () => {
  it('returns empty object for empty puuids array', async () => {
    const res = await request(app).post('/api/players/bulk-stats').send({ puuids: [] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })

  it('returns stats keyed by puuid', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2] })
    const res = await request(app).post('/api/players/bulk-stats').send({ puuids: ['test-puuid-1', 'test-puuid-2'] })
    expect(res.status).toBe(200)
    expect(res.body['test-puuid-1'].games).toBe(2)
    expect(res.body['test-puuid-1'].wins).toBe(2)
    expect(res.body['test-puuid-2'].games).toBe(1)
    expect(res.body['test-puuid-2'].wins).toBe(0)
  })

  it('omits puuids with no matching games', async () => {
    const res = await request(app).post('/api/players/bulk-stats').send({ puuids: ['ghost-puuid'] })
    expect(res.status).toBe(200)
    expect(res.body['ghost-puuid']).toBeUndefined()
  })

  it('respects patch filter', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).post('/api/players/bulk-stats?patches=99.99').send({ puuids: ['test-puuid-1'] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })
})

describe('GET /api/players/:puuid/champions', () => {
  it('returns empty array when no data', async () => {
    const res = await request(app).get('/api/players/test-puuid-1/champions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns per-champion stats for the player', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2, sampleMatch3] })
    const res = await request(app).get('/api/players/test-puuid-1/champions')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const row = res.body[0]
    expect(row.championId).toBe(10)
    expect(row.championName).toBe('Kayle')
    expect(row.games).toBe(3)
    expect(row.wins).toBe(2)
  })

  it('cross-player isolation — puuid-2 sees only Teemo', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-2/champions')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].championId).toBe(20)
    expect(res.body[0].championName).toBe('Teemo')
  })

  it('respects patch filter', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/champions?patches=99.99')
    expect(res.body).toEqual([])
  })
})

describe('GET /api/players/:puuid/matches', () => {
  it('returns empty array when no matches', async () => {
    const res = await request(app).get('/api/players/test-puuid-1/matches')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns only matches containing the requested player', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2] })
    const res = await request(app).get('/api/players/test-puuid-2/matches')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].gameId).toBe(5001)
  })

  it('respects limit param', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2, sampleMatch3] })
    const res = await request(app).get('/api/players/test-puuid-1/matches?limit=2')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  it('match shape includes participants and augments', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/matches')
    const match = res.body[0]
    expect(match.gameId).toBe(5001)
    expect(Array.isArray(match.participants)).toBe(true)
    expect(match.participants).toHaveLength(2)
    const player = match.participants.find((p: any) => p.puuid === 'test-puuid-1')
    expect(player.augments).toContain(200)
  })
})

describe('GET /api/players/:puuid/trend', () => {
  it('returns empty array when no data', async () => {
    const res = await request(app).get('/api/players/test-puuid-1/trend')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns daily win rate entries when days covers match dates', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2, sampleMatch3] })
    // Sample matches are from 2025-06-15..17; use days=400 to reach them from the test run date
    const res = await request(app).get('/api/players/test-puuid-1/trend?days=400')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    const entry = res.body[0]
    expect(entry).toHaveProperty('date')
    expect(entry).toHaveProperty('winRate')
    expect(entry).toHaveProperty('games')
  })
})

describe('GET /api/players/:puuid/name', () => {
  it('returns null for unknown puuid', async () => {
    const res = await request(app).get('/api/players/unknown-puuid/name')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  it('returns the most recent summonerName for a known puuid', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/players/test-puuid-1/name')
    expect(res.status).toBe(200)
    expect(res.body).toBe('Foo#NA1')
  })
})

// ─── Group summary ─────────────────────────────────────────────────────────────

describe('GET /api/group', () => {
  it('returns zero stats when no data', async () => {
    const res = await request(app).get('/api/group')
    expect(res.status).toBe(200)
    expect(res.body.totalMatches).toBe(0)
    expect(res.body.avgWinRate).toBe(0)
    expect(res.body.avgDpm).toBe(0)
  })

  it('returns aggregate stats across all players after insert', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch, sampleMatch2] })
    const res = await request(app).get('/api/group')
    expect(res.status).toBe(200)
    expect(res.body.totalMatches).toBe(2)
    expect(res.body.avgDpm).toBeGreaterThan(0)
    expect(typeof res.body.avgWinRate).toBe('number')
    expect(typeof res.body.avgKda).toBe('number')
  })

  it('avgWinRate and avgKda are non-zero when there are wins and kills', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/group')
    expect(res.body.avgWinRate).toBeGreaterThan(0)
    expect(res.body.avgKda).toBeGreaterThan(0)
  })
})

// ─── Upsert / incomplete games / synctimes ─────────────────────────────────────

describe('PUT /api/matches/:gameId', () => {
  it('creates a match via upsert', async () => {
    const res = await request(app).put('/api/matches/5001').send(sampleMatch)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const exists = await request(app).get('/api/matches/5001/exists')
    expect(exists.body).toBe(true)
  })

  it('overwrites participants on an existing match', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const updated = { ...sampleMatch, gameDuration: 9999 }
    await request(app).put('/api/matches/5001').send(updated)
    const matches = await request(app).get('/api/players/test-puuid-1/matches')
    expect(matches.body[0].gameDuration).toBe(9999)
  })

  it('upsert does not double champion game count', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    await request(app).put('/api/matches/5001').send(sampleMatch)
    const res = await request(app).get('/api/players/test-puuid-1/champions')
    expect(res.body[0].games).toBe(1)
  })

  it('upsert does not double player augment count', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    await request(app).put('/api/matches/5001').send(sampleMatch)
    const res = await request(app).get('/api/players/test-puuid-1/augments')
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.pickCount).toBe(1)
  })
})

describe('GET /api/incomplete-games', () => {
  it('returns empty array when no matches', async () => {
    const res = await request(app).get('/api/incomplete-games')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns gameIds where participant count is below 10', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    const res = await request(app).get('/api/incomplete-games')
    expect(res.body).toContain(5001)
  })

  it('excludes matches that have exactly 10 participants', async () => {
    const fullMatch: Match = {
      ...sampleMatch,
      gameId: 6001,
      participants: Array.from({ length: 10 }, (_, i) => ({
        puuid: `puuid-full-${i}`, summonerName: `Player${i}`, championId: i + 1, championName: `Champ${i}`,
        teamId: i < 5 ? 100 : 200, win: i < 5,
        kills: 1, deaths: 1, assists: 1, damageDealt: 10000, damageTaken: 10000,
        goldEarned: 5000, champLevel: 10, augments: []
      }))
    }
    await request(app).post('/api/matches/bulk').send({ matches: [fullMatch] })
    const res = await request(app).get('/api/incomplete-games')
    expect(res.body).not.toContain(6001)
  })
})

describe('DELETE /api/synctimes', () => {
  it('returns ok', async () => {
    const res = await request(app).delete('/api/synctimes')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('resets existing sync times without removing them', async () => {
    // Set a sync time then invalidate — player should still appear in /api/players (JOIN still finds row)
    await request(app).post('/api/matches/bulk').send({ matches: [sampleMatch] })
    await request(app).post('/api/sync/done/test-puuid-1')
    await request(app).post('/api/sync/done/test-puuid-2')
    await request(app).delete('/api/synctimes')
    const res = await request(app).get('/api/players')
    expect(Array.isArray(res.body)).toBe(true)
    // Players still appear (syncedAt=0 but the row exists)
    expect(res.body.some((p: any) => p.puuid === 'test-puuid-1')).toBe(true)
  })
})

// ─── Sync fail ────────────────────────────────────────────────────────────────

describe('POST /api/sync/fail/:puuid', () => {
  it('releases claim so the job can be reclaimed by another worker', async () => {
    await request(app).post('/api/sync/enqueue').send({ puuid: 'fail-test' })
    await request(app).get('/api/sync/next?clientId=worker-1')
    // Job is now claimed — worker-2 can't take it
    const before = await request(app).get('/api/sync/next?clientId=worker-2')
    expect(before.body.puuid).toBeNull()
    // Fail it — lease released
    await request(app).post('/api/sync/fail/fail-test')
    const after = await request(app).get('/api/sync/next?clientId=worker-2')
    expect(after.body.puuid).toBe('fail-test')
  })
})

// ─── Items endpoints ───────────────────────────────────────────────────────────

const ITEM_CHAMP_ID = 55
const ITEMS_CORE = [3001, 3003, 3089, 3135, 3157]
const ITEMS_ALT =  [3001, 3003, 3089, 3165, 3157]
const ITEMS_ALLOWED = [3001, 3003, 3089, 3135, 3157, 3165]

const matchWithItems: Match = {
  gameId: 9001,
  queueId: 2400,
  gameCreation: new Date('2025-06-20T10:00:00Z').getTime(),
  gameDuration: 1100,
  gameVersion: '15.12',
  participants: [
    {
      puuid: 'item-puuid-1', summonerName: 'Mage#NA1', championId: ITEM_CHAMP_ID, championName: 'Syndra',
      teamId: 100, win: true, kills: 5, deaths: 1, assists: 3,
      damageDealt: 50000, damageTaken: 12000, goldEarned: 11000, champLevel: 15, augments: [],
      items: ITEMS_CORE,
    },
    {
      puuid: 'item-puuid-2', summonerName: 'Other#NA1', championId: 99, championName: 'Lux',
      teamId: 200, win: false, kills: 1, deaths: 4, assists: 2,
      damageDealt: 20000, damageTaken: 25000, goldEarned: 7000, champLevel: 11, augments: [],
      items: [3006, 3031, 3033, 3034, 3035],
    }
  ]
}

const matchWithItemsAlt: Match = {
  gameId: 9002,
  queueId: 2400,
  gameCreation: new Date('2025-06-21T10:00:00Z').getTime(),
  gameDuration: 1200,
  gameVersion: '15.12',
  participants: [
    {
      puuid: 'item-puuid-3', summonerName: 'Mage2#NA1', championId: ITEM_CHAMP_ID, championName: 'Syndra',
      teamId: 100, win: false, kills: 2, deaths: 3, assists: 4,
      damageDealt: 35000, damageTaken: 18000, goldEarned: 9000, champLevel: 14, augments: [],
      items: ITEMS_ALT,
    }
  ]
}

const matchWithItemsOldPatch: Match = {
  gameId: 9003,
  queueId: 2400,
  gameCreation: new Date('2025-06-18T10:00:00Z').getTime(),
  gameDuration: 1000,
  gameVersion: '15.11',
  participants: [
    {
      puuid: 'item-puuid-4', summonerName: 'Mage3#NA1', championId: ITEM_CHAMP_ID, championName: 'Syndra',
      teamId: 100, win: true, kills: 3, deaths: 1, assists: 5,
      damageDealt: 45000, damageTaken: 10000, goldEarned: 10500, champLevel: 15, augments: [],
      items: ITEMS_CORE,
    }
  ]
}

describe('GET /api/items/picks', () => {
  beforeAll(async () => {
    await request(app).post('/api/meta/items').send({
      items: [
        { id: 3001, name: 'Evenshroud',       iconPath: '', category: 'Armor'  },
        { id: 3003, name: "Archangel's Staff", iconPath: '', category: 'AP'     },
        { id: 3089, name: "Rabadon's Deathcap",iconPath: '', category: 'AP'     },
        { id: 3135, name: 'Void Staff',        iconPath: '', category: 'AP'     },
        { id: 3157, name: "Zhonya's Hourglass",iconPath: '', category: 'AP'     },
        { id: 3165, name: 'Morellonomicon',    iconPath: '', category: 'AP'     },
        { id: 3006, name: "Berserker's Greaves",iconPath:'', category: 'Boots'  },
      ],
      componentIds: [],
    })
  })

  it('returns 400 when championId is missing', async () => {
    const res = await request(app).get('/api/items/picks')
    expect(res.status).toBe(400)
  })

  it('returns empty items array when no data for champion', async () => {
    const res = await request(app).get(`/api/items/picks?championId=${ITEM_CHAMP_ID}`)
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(typeof res.body.totalGames).toBe('number')
  })

  it('returns item pick counts after match insertion', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get(`/api/items/picks?championId=${ITEM_CHAMP_ID}`)
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThan(0)
    const ids = res.body.items.map((r: any) => r.itemId)
    for (const id of ITEMS_CORE) expect(ids).toContain(id)
  })

  it('each row has picks and wins fields', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get(`/api/items/picks?championId=${ITEM_CHAMP_ID}`)
    for (const row of res.body.items) {
      expect(typeof row.picks).toBe('number')
      expect(typeof row.wins).toBe('number')
      expect(row.picks).toBeGreaterThan(0)
    }
  })

  it('filters by patch — returns empty for non-matching patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get(`/api/items/picks?championId=${ITEM_CHAMP_ID}&patches=99.99`)
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it('filters by patch — returns data for matching patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems, matchWithItemsOldPatch] })
    const res = await request(app).get(`/api/items/picks?championId=${ITEM_CHAMP_ID}&patches=15.12`)
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThan(0)
    // Each item in the result came from the 15.12 match only (1 game)
    for (const row of res.body.items) {
      expect(row.picks).toBe(1)
    }
  })

  it('does not return picks for other champions', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get('/api/items/picks?championId=999')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })
})

describe('GET /api/items/builds', () => {
  it('returns 400 when championId is missing', async () => {
    const res = await request(app).get('/api/items/builds')
    expect(res.status).toBe(400)
  })

  it('returns empty array when no data for champion', async () => {
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns build rows after match insertion', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}`)
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    const row = res.body[0]
    expect(Array.isArray(row.build)).toBe(true)
    expect(typeof row.games).toBe('number')
    expect(typeof row.wins).toBe('number')
  })

  it('allowedIds filter — excludes builds containing items not in allowed list', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    // Provide only 4 of the 5 core items — the one build should be excluded
    const partialAllowed = ITEMS_CORE.slice(0, 4).join(',')
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${partialAllowed}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returned builds only contain items present in the allowed list', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems, matchWithItemsAlt] })
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}`)
    expect(res.status).toBe(200)
    const allowedSet = new Set(ITEMS_ALLOWED)
    for (const row of res.body) {
      for (const id of row.build) {
        expect(allowedSet.has(id)).toBe(true)
      }
    }
  })

  it('filters by patch — returns empty for non-matching patch', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}&patches=99.99`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters by patch — returns data for matching patch only', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems, matchWithItemsOldPatch] })
    // Both patches have the same build; filtering to 15.12 should return games=1
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}&patches=15.12`)
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    const total = res.body.reduce((s: number, r: any) => s + r.games, 0)
    expect(total).toBe(1)
  })

  it('aggregates games across patches when no patch filter given', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems, matchWithItemsOldPatch] })
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}`)
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    const total = res.body.reduce((s: number, r: any) => s + r.games, 0)
    expect(total).toBeGreaterThanOrEqual(2)
  })

  it('is idempotent — duplicate match insert does not double the build count', async () => {
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    await request(app).post('/api/matches/bulk').send({ matches: [matchWithItems] })
    const res = await request(app).get(`/api/items/builds?championId=${ITEM_CHAMP_ID}&allowed=${ITEMS_ALLOWED.join(',')}&patches=15.12`)
    expect(res.status).toBe(200)
    const total = res.body.reduce((s: number, r: any) => s + r.games, 0)
    expect(total).toBe(1)
  })
})

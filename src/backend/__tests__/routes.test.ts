import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { initDb, Match } from '../db'
import { createExpressApp } from '../server'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

const app = createExpressApp()

beforeAll(async () => {
  await initDb(TEST_URL)
})

async function truncate() {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE sync_queue, player_sync_times, participant_augments, participants, matches RESTART IDENTITY CASCADE`
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

describe('GET /api/patches', () => {
  it('returns an empty array when DB is empty', async () => {
    const res = await request(app).get('/api/patches')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns patches after a match is inserted', async () => {
    await request(app).post('/api/matches').send(sampleMatch)
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

describe('POST /api/matches', () => {
  it('inserts a match and returns ok', async () => {
    const res = await request(app).post('/api/matches').send(sampleMatch)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('is idempotent — duplicate insert does not 500', async () => {
    await request(app).post('/api/matches').send(sampleMatch)
    const res = await request(app).post('/api/matches').send(sampleMatch)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/matches/:gameId/exists', () => {
  it('returns false before insert', async () => {
    const res = await request(app).get('/api/matches/5001/exists')
    expect(res.status).toBe(200)
    expect(res.body).toBe(false)
  })

  it('returns true after insert', async () => {
    await request(app).post('/api/matches').send(sampleMatch)
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
})

describe('GET /api/augments', () => {
  it('returns fallback name and empty iconPath when no cache is injected', async () => {
    await request(app).post('/api/matches').send(sampleMatch)
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
    await request(appWithCache).post('/api/matches').send(sampleMatch)
    const res = await request(appWithCache).get('/api/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.name).toBe('Iron Will')
    expect(aug.iconPath).toBe('mayhem-asset://augment-icons/200.png')
    expect(aug.rarity).toBe(1)
  })
})

describe('GET /api/players/:puuid/augments', () => {
  it('returns fallback name and empty iconPath when no cache is injected', async () => {
    await request(app).post('/api/matches').send(sampleMatch)
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
    await request(appWithCache).post('/api/matches').send(sampleMatch)
    const res = await request(appWithCache).get('/api/players/test-puuid-1/augments')
    expect(res.status).toBe(200)
    const aug = res.body.find((a: any) => a.augmentId === 200)
    expect(aug.name).toBe('Iron Will')
    expect(aug.iconPath).toBe('mayhem-asset://augment-icons/200.png')
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

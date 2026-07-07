import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initDb,
  enqueuePlayer,
  enqueueAll,
  claimNextJob,
  completeJob,
  failJob,
  getQueueStatus,
  insertMatch,
  invalidateAllSyncTimes,
  Match
} from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

// Access internal sql_ for cleanup — we import via a helper that shares the module singleton
let sql: any

beforeAll(async () => {
  await initDb(TEST_URL)
  // Grab the postgres client via a dynamic import trick on the same module instance
  const mod = await import('../db')
  // We'll use the exported functions for cleanup
})

afterAll(async () => {
  // Nothing to close — postgres pool closes on process exit
})

async function truncateQueue() {
  // Use enqueueAll/completeJob indirectly — just re-init clears nothing.
  // Instead import the internal sql via the db module by calling a known safe query.
  // We rely on the fact that initDb already ran: use invalidateAllSyncTimes as a proxy,
  // then manually clear with a raw delete via the public API workaround.
  // Best approach: expose a test-only truncate, or use a separate postgres connection.
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE sync_queue, player_sync_times, participant_augments, participants, matches RESTART IDENTITY CASCADE`
  await db.end()
}

beforeEach(async () => {
  await truncateQueue()
})

const sampleMatch = (gameId = 9001): Match => ({
  gameId,
  queueId: 2400,
  gameCreation: new Date('2025-06-01T00:00:00Z').getTime(),
  gameDuration: 1000,
  gameVersion: '15.11',
  participants: [
    {
      puuid: 'puuid-alpha', summonerName: 'Alpha#1234', championId: 1, championName: 'Annie',
      teamId: 100, win: true, kills: 3, deaths: 1, assists: 5,
      damageDealt: 20000, damageTaken: 10000, goldEarned: 8000, champLevel: 10, augments: [101]
    },
    {
      puuid: 'puuid-beta', summonerName: 'Beta#5678', championId: 2, championName: 'Olaf',
      teamId: 200, win: false, kills: 1, deaths: 3, assists: 2,
      damageDealt: 15000, damageTaken: 18000, goldEarned: 6000, champLevel: 9, augments: []
    }
  ]
})

describe('enqueuePlayer', () => {
  it('adds a row to sync_queue', async () => {
    await enqueuePlayer('puuid-test')
    const status = await getQueueStatus()
    expect(status.total).toBe(1)
  })

  it('is idempotent — calling twice does not duplicate', async () => {
    await enqueuePlayer('puuid-test')
    await enqueuePlayer('puuid-test')
    const status = await getQueueStatus()
    expect(status.total).toBe(1)
  })
})

describe('enqueueAll', () => {
  it('enqueues multiple players', async () => {
    await enqueueAll(['a', 'b', 'c'])
    expect((await getQueueStatus()).total).toBe(3)
  })

  it('is a no-op for empty arrays', async () => {
    await enqueueAll([])
    expect((await getQueueStatus()).total).toBe(0)
  })
})

describe('claimNextJob', () => {
  it('returns null when the queue is empty', async () => {
    const result = await claimNextJob('client-1')
    expect(result).toBeNull()
  })

  it('returns a PUUID when one is available', async () => {
    await enqueuePlayer('puuid-x')
    const result = await claimNextJob('client-1')
    expect(result).toBe('puuid-x')
  })

  it('marks the row as claimed', async () => {
    await enqueuePlayer('puuid-x')
    await claimNextJob('client-1')
    // Should not be claimable again immediately (lease still valid)
    const second = await claimNextJob('client-2')
    expect(second).toBeNull()
  })

  it('two concurrent claims return different PUUIDs', async () => {
    await enqueueAll(['puuid-1', 'puuid-2'])
    const [a, b] = await Promise.all([
      claimNextJob('client-a'),
      claimNextJob('client-b')
    ])
    expect(new Set([a, b]).size).toBe(2)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
  })

  it('re-claims an entry with an expired lease', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    await db`INSERT INTO sync_queue (puuid, queued_at, claimed_at, claimed_by, lease_expires_at)
             VALUES ('expired-puuid', ${Date.now() - 10000}, ${Date.now() - 400000}, 'dead-client', ${Date.now() - 1000})`
    await db.end()

    const result = await claimNextJob('new-client')
    expect(result).toBe('expired-puuid')
  })
})

describe('completeJob', () => {
  it('removes the row from the queue', async () => {
    await enqueuePlayer('puuid-done')
    await claimNextJob('client-1')
    await completeJob('puuid-done')
    expect((await getQueueStatus()).total).toBe(0)
  })
})

describe('failJob', () => {
  it('releases the lease so another client can claim it', async () => {
    await enqueuePlayer('puuid-fail')
    await claimNextJob('client-1')
    await failJob('puuid-fail')
    const result = await claimNextJob('client-2')
    expect(result).toBe('puuid-fail')
  })

  it('keeps the row in the queue', async () => {
    await enqueuePlayer('puuid-fail')
    await claimNextJob('client-1')
    await failJob('puuid-fail')
    expect((await getQueueStatus()).total).toBe(1)
  })
})

describe('insertMatch', () => {
  it('enqueues all participant PUUIDs after insert', async () => {
    await insertMatch(sampleMatch())
    const status = await getQueueStatus()
    expect(status.total).toBe(2) // puuid-alpha + puuid-beta
  })

  it('does not double-enqueue on duplicate insert', async () => {
    await insertMatch(sampleMatch())
    await insertMatch(sampleMatch()) // ON CONFLICT DO NOTHING
    expect((await getQueueStatus()).total).toBe(2)
  })
})

describe('invalidateAllSyncTimes', () => {
  it('re-enqueues all known participants', async () => {
    await insertMatch(sampleMatch(9001))
    await insertMatch(sampleMatch(9002))
    // Drain the queue first
    await claimNextJob('c'); await claimNextJob('c'); await claimNextJob('c'); await claimNextJob('c')
    await completeJob('puuid-alpha'); await completeJob('puuid-beta')

    await invalidateAllSyncTimes()
    // puuid-alpha and puuid-beta should be re-enqueued
    expect((await getQueueStatus()).total).toBe(2)
  })
})

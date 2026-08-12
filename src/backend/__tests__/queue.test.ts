import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initDb,
  enqueuePlayer,
  enqueueAll,
  claimNextJob,
  completeJob,
  failJob,
  getQueueStatus,
  clearQueue,
  insertMatches,
  invalidateAllSyncTimes,
  recordSyncResult,
  getSyncLog,
  getNextQueuedPlayers,
  getPendingMatchCount,
  Match
} from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => {
  await initDb(TEST_URL)
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
  await db`TRUNCATE sync_log, sync_queue, player_sync_times, participant_augments, participants, matches RESTART IDENTITY CASCADE`
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

describe('clearQueue', () => {
  it('removes all entries from the queue', async () => {
    await enqueuePlayer('puuid-a')
    await enqueuePlayer('puuid-b')
    expect((await getQueueStatus()).total).toBe(2)
    await clearQueue()
    expect((await getQueueStatus()).total).toBe(0)
  })

  it('is a no-op on an empty queue', async () => {
    await clearQueue()
    expect((await getQueueStatus()).total).toBe(0)
  })
})

describe('insertMatches', () => {
  it('enqueues all participant PUUIDs after insert', async () => {
    await insertMatches([sampleMatch()])
    const status = await getQueueStatus()
    expect(status.total).toBe(2) // puuid-alpha + puuid-beta
  })

  it('does not double-enqueue on duplicate insert', async () => {
    await insertMatches([sampleMatch()])
    await insertMatches([sampleMatch()]) // ON CONFLICT DO NOTHING
    expect((await getQueueStatus()).total).toBe(2)
  })
})

describe('invalidateAllSyncTimes', () => {
  it('zeroes syncedAt for all known players without re-enqueuing', async () => {
    await insertMatches([sampleMatch(9001)])
    await claimNextJob('c'); await claimNextJob('c')
    await completeJob('puuid-alpha'); await completeJob('puuid-beta')

    // Queue should now be empty, both players have sync times
    expect((await getQueueStatus()).total).toBe(0)

    await invalidateAllSyncTimes()
    // Queue stays empty — no auto-enqueue on full reload
    expect((await getQueueStatus()).total).toBe(0)
    // But players are now stale (syncedAt = 0)
    const { isPlayerStale } = await import('../db')
    expect(await isPlayerStale('puuid-alpha', 1)).toBe(true)
  })
})

describe('recordSyncResult / getSyncLog', () => {
  it('records a successful sync and retrieves it', async () => {
    await recordSyncResult({ puuid: 'p1', summonerName: 'Alpha#1234', gamesImported: 5, durationMs: 800 })
    const log = await getSyncLog(10)
    expect(log).toHaveLength(1)
    expect(log[0].puuid).toBe('p1')
    expect(log[0].summonerName).toBe('Alpha#1234')
    expect(log[0].gamesImported).toBe(5)
    expect(log[0].durationMs).toBe(800)
    expect(log[0].error).toBeNull()
    expect(log[0].syncedAt).toBeGreaterThan(0)
  })

  it('records an error sync', async () => {
    await recordSyncResult({ puuid: 'p2', summonerName: 'Beta#5678', gamesImported: 0, durationMs: 0, error: 'fetch failed' })
    const log = await getSyncLog(10)
    expect(log[0].error).toBe('fetch failed')
    expect(log[0].gamesImported).toBe(0)
  })

  it('returns entries newest-first', async () => {
    await recordSyncResult({ puuid: 'p1', summonerName: 'Alpha', gamesImported: 1, durationMs: 100 })
    await recordSyncResult({ puuid: 'p2', summonerName: 'Beta', gamesImported: 2, durationMs: 200 })
    const log = await getSyncLog(10)
    expect(log[0].puuid).toBe('p2')
    expect(log[1].puuid).toBe('p1')
  })

  it('respects the limit parameter', async () => {
    await recordSyncResult({ puuid: 'p1', summonerName: 'A', gamesImported: 1, durationMs: 100 })
    await recordSyncResult({ puuid: 'p2', summonerName: 'B', gamesImported: 2, durationMs: 200 })
    await recordSyncResult({ puuid: 'p3', summonerName: 'C', gamesImported: 3, durationMs: 300 })
    const log = await getSyncLog(2)
    expect(log).toHaveLength(2)
  })
})

describe('getNextQueuedPlayers', () => {
  it('returns queued players ordered by priority DESC then queued_at ASC', async () => {
    await enqueuePlayer('puuid-normal')
    await new Promise(r => setTimeout(r, 10))
    await enqueuePlayer('puuid-normal2')
    // Enqueue a priority player
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    await db`INSERT INTO sync_queue (puuid, queued_at, priority) VALUES ('puuid-vip', ${Date.now()}, 1) ON CONFLICT DO NOTHING`
    await db.end()

    const players = await getNextQueuedPlayers(10)
    expect(players[0].puuid).toBe('puuid-vip')
    expect(players[0].priority).toBe(1)
    expect(players[1].puuid).toBe('puuid-normal')
    expect(players[2].puuid).toBe('puuid-normal2')
  })

  it('returns empty array when queue is empty', async () => {
    const players = await getNextQueuedPlayers(20)
    expect(players).toHaveLength(0)
  })

  it('respects the limit parameter', async () => {
    await enqueueAll(['a', 'b', 'c', 'd', 'e'])
    const players = await getNextQueuedPlayers(3)
    expect(players).toHaveLength(3)
  })
})

describe('pendingMatchCount', () => {
  it('increments when matches are inserted', async () => {
    const before = getPendingMatchCount()
    await insertMatches([sampleMatch(99901)])
    expect(getPendingMatchCount()).toBeGreaterThan(before)
  })
})

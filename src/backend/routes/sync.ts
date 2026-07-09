import { Router } from 'express'
import {
  matchExists,
  insertMatches,
  upsertMatch,
  getIncompleteGameIds,
  invalidateAllSyncTimes,
  claimNextJob,
  completeJob,
  failJob,
  enqueuePlayer,
  enqueuePriority,
  getQueueStatus,
  clearQueue,
  setPlayerSyncTime,
  Match
} from '../db'

export interface SyncOptions {
  warmCache?: () => Promise<void>
}

export function createSyncRouter(opts: SyncOptions = {}): Router {
  const router = Router()

  router.post('/matches/bulk', async (req, res) => {
    const { matches } = req.body as { matches: Match[] }
    const inserted = await insertMatches(matches)
    if (inserted > 0 && opts.warmCache) {
      opts.warmCache().catch(err => console.warn('[cache] warm failed:', (err as Error).message))
    }
    res.json({ inserted })
  })

  router.get('/matches/:gameId/exists', async (req, res) => {
    res.json(await matchExists(parseInt(req.params.gameId)))
  })

  router.put('/matches/:gameId', async (req, res) => {
    await upsertMatch(req.body as Match)
    res.json({ ok: true })
  })

  router.get('/incomplete-games', async (_req, res) => {
    res.json(await getIncompleteGameIds())
  })

  router.delete('/synctimes', async (_req, res) => {
    await invalidateAllSyncTimes()
    res.json({ ok: true })
  })

  router.get('/sync/next', async (req, res) => {
    const clientId = (req.query.clientId as string) || 'unknown'
    const puuid = await claimNextJob(clientId)
    res.json({ puuid })
  })

  router.post('/sync/done/:puuid', async (req, res) => {
    await Promise.all([
      completeJob(req.params.puuid),
      setPlayerSyncTime(req.params.puuid)
    ])
    res.json({ ok: true })
  })

  router.post('/sync/fail/:puuid', async (req, res) => {
    await failJob(req.params.puuid)
    res.json({ ok: true })
  })

  router.post('/sync/enqueue', async (req, res) => {
    const { puuid } = req.body as { puuid: string }
    if (!puuid) { res.status(400).json({ error: 'puuid required' }); return }
    await enqueuePlayer(puuid)
    res.json({ ok: true })
  })

  router.post('/sync/enqueue-priority', async (req, res) => {
    const puuids: string[] = req.body.puuids ?? []
    if (!Array.isArray(puuids) || puuids.length === 0) { res.status(400).json({ error: 'puuids required' }); return }
    await enqueuePriority(puuids)
    res.json({ ok: true })
  })

  router.get('/sync/queue', async (_req, res) => {
    res.json(await getQueueStatus())
  })

  router.delete('/sync/queue', async (_req, res) => {
    await clearQueue()
    res.json({ ok: true })
  })

  return router
}

export default createSyncRouter()

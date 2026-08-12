import { Router, NextFunction } from 'express'
import { getOrFetch, invalidate } from '../queryCache'
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
  Match,
  recordSyncResult, getSyncLog, getNextQueuedPlayers, refreshAllMatviews
} from '../db'

export function createSyncRouter(): Router {
  const router = Router()

  router.post('/matches/bulk', async (req, res, next: NextFunction) => {
    try {
      const { matches } = req.body as { matches: Match[] }
      const inserted = await insertMatches(matches)
      res.json({ inserted })
    } catch (err) { next(err) }
  })

  router.get('/matches/:gameId/exists', async (req, res, next: NextFunction) => {
    try {
      res.json(await matchExists(parseInt(req.params.gameId)))
    } catch (err) { next(err) }
  })

  router.put('/matches/:gameId', async (req, res, next: NextFunction) => {
    try {
      await upsertMatch(req.body as Match)
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.get('/incomplete-games', async (_req, res, next: NextFunction) => {
    try {
      res.json(await getIncompleteGameIds())
    } catch (err) { next(err) }
  })

  router.delete('/synctimes', async (_req, res, next: NextFunction) => {
    try {
      await invalidateAllSyncTimes()
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.get('/sync/next', async (req, res, next: NextFunction) => {
    try {
      const clientId = (req.query.clientId as string) || 'unknown'
      const puuid = await claimNextJob(clientId)
      res.json({ puuid })
    } catch (err) { next(err) }
  })

  router.post('/sync/done/:puuid', async (req, res, next: NextFunction) => {
    try {
      await Promise.all([
        completeJob(req.params.puuid),
        setPlayerSyncTime(req.params.puuid)
      ])
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.post('/sync/fail/:puuid', async (req, res, next: NextFunction) => {
    try {
      await failJob(req.params.puuid)
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.post('/sync/enqueue', async (req, res, next: NextFunction) => {
    try {
      const { puuid } = req.body as { puuid: string }
      if (!puuid) { res.status(400).json({ error: 'puuid required' }); return }
      await enqueuePlayer(puuid)
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.post('/sync/enqueue-priority', async (req, res, next: NextFunction) => {
    try {
      const puuids: string[] = req.body.puuids ?? []
      if (!Array.isArray(puuids) || puuids.length === 0) { res.status(400).json({ error: 'puuids required' }); return }
      await enqueuePriority(puuids)
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.get('/sync/queue', async (_req, res, next: NextFunction) => {
    try {
      res.json(await getOrFetch('sync_queue', () => getQueueStatus(), 10_000))
    } catch (err) { next(err) }
  })

  router.delete('/sync/queue', async (_req, res, next: NextFunction) => {
    try {
      await clearQueue()
      invalidate('sync_queue')
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.post('/sync/log', async (req, res, next: NextFunction) => {
    try {
      const { puuid, summonerName, gamesImported, durationMs, error } = req.body as {
        puuid: string; summonerName: string; gamesImported: number
        durationMs: number; error?: string
      }
      await recordSyncResult({ puuid, summonerName, gamesImported, durationMs, error })
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.get('/sync/log', async (req, res, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10), 500)
      res.json(await getSyncLog(limit))
    } catch (err) { next(err) }
  })

  router.get('/sync/queue/players', async (req, res, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10), 100)
      res.json(await getOrFetch(`sync_queue_players:${limit}`, () => getNextQueuedPlayers(limit), 5_000))
    } catch (err) { next(err) }
  })

  router.post('/sync/refresh', async (_req, res, next: NextFunction) => {
    try {
      refreshAllMatviews().catch(err => console.warn('[matview] forced refresh failed:', (err as Error).message))
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  return router
}

export default createSyncRouter()

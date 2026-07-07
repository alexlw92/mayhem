import { Router } from 'express'
import {
  matchExists,
  insertMatch,
  upsertMatch,
  getIncompleteGameIds,
  invalidateAllSyncTimes,
  claimNextJob,
  completeJob,
  failJob,
  enqueuePlayer,
  getQueueStatus,
  setPlayerSyncTime,
  Match
} from '../db'

const router = Router()

router.get('/matches/:gameId/exists', async (req, res) => {
  res.json(await matchExists(parseInt(req.params.gameId)))
})

router.post('/matches', async (req, res) => {
  await insertMatch(req.body as Match)
  res.json({ ok: true })
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

router.get('/sync/queue', async (_req, res) => {
  res.json(await getQueueStatus())
})

export default router

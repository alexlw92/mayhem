import { Router } from 'express'
import {
  getPatches,
  getPlayerStats,
  getOnePlayerStats,
  getBulkPlayerStats,
  getChampionStats,
  getRecentMatches,
  getAugmentStats,
  getAugmentChampionStats,
  getWinRateTrend,
  getPlayerName,
  getCoplayerStats,
  getGroupSummary,
  searchPlayers,
  getItemBuilds,
  getItemPickRates,
  AugmentInfo
} from '../db'

export interface StatsOptions {
  getAugments?: () => Record<number, AugmentInfo>
  latestPatch?: { value: string | null }
}

const parsePatches = (raw: unknown): string[] | undefined => {
  if (typeof raw !== 'string' || !raw) return undefined
  return raw.split(',')
}

export function createStatsRouter(opts: StatsOptions = {}): Router {
  const router = Router()

  router.get('/patches', async (_req, res) => {
    res.json(await getPatches())
  })

  router.get('/players', async (req, res) => {
    res.json(await getPlayerStats(parsePatches(req.query.patches)))
  })

  router.get('/players/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q || q.length < 2) return res.json([])
    res.json(await searchPlayers(q))
  })

  router.get('/players/:puuid/stats', async (req, res) => {
    res.json(await getOnePlayerStats(req.params.puuid, parsePatches(req.query.patches)))
  })

  router.post('/players/bulk-stats', async (req, res) => {
    const puuids = Array.isArray(req.body.puuids) ? (req.body.puuids as string[]) : []
    res.json(await getBulkPlayerStats(puuids, parsePatches(req.query.patches)))
  })

  router.get('/players/:puuid/champions', async (req, res) => {
    res.json(await getChampionStats(req.params.puuid, parsePatches(req.query.patches)))
  })

  router.get('/players/:puuid/matches', async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
    res.json(await getRecentMatches(limit, req.params.puuid, parsePatches(req.query.patches)))
  })

  router.get('/players/:puuid/augments', async (req, res) => {
    const augCache = opts.getAugments?.() ?? {}
    res.json(await getAugmentStats(req.params.puuid, undefined, parsePatches(req.query.patches), augCache))
  })

  router.get('/players/:puuid/trend', async (req, res) => {
    const days = req.query.days ? parseInt(req.query.days as string) : undefined
    res.json(await getWinRateTrend(req.params.puuid, days))
  })

  router.get('/players/:puuid/name', async (req, res) => {
    res.json(await getPlayerName(req.params.puuid))
  })

  router.get('/players/:puuid/coplayers', async (req, res) => {
    res.json(await getCoplayerStats(req.params.puuid, parsePatches(req.query.patches)))
  })

  router.get('/group', async (_req, res) => {
    res.json(await getGroupSummary())
  })

  router.get('/champions', async (req, res) => {
    res.json(await getChampionStats(undefined, parsePatches(req.query.patches)))
  })

  router.get('/augments', async (req, res) => {
    const augCache = opts.getAugments?.() ?? {}
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    res.json(await getAugmentStats(undefined, championId, patches, augCache))
  })

  router.get('/augments/:augmentId/champions', async (req, res) => {
    const augmentId = parseInt(req.params.augmentId)
    const puuid = typeof req.query.puuid === 'string' ? req.query.puuid : undefined
    res.json(await getAugmentChampionStats(augmentId, puuid, parsePatches(req.query.patches)))
  })

  router.get('/items/builds', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const allowedIds = typeof req.query.allowed === 'string' && req.query.allowed
      ? req.query.allowed.split(',').map(Number).filter(Boolean)
      : []
    res.json(await getItemBuilds(championId, patches, allowedIds))
  })

  router.get('/items/picks', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    res.json(await getItemPickRates(championId, patches))
  })

  return router
}

export default createStatsRouter()

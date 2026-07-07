import { Router } from 'express'
import {
  getPatches,
  getPlayerStats,
  getOnePlayerStats,
  getChampionStats,
  getRecentMatches,
  getAugmentStats,
  getAugmentChampionStats,
  getWinRateTrend,
  getPlayerName,
  getCoplayerStats,
  getGroupSummary,
  searchPlayers,
  AugmentInfo
} from '../db'

export interface StatsOptions {
  getAugments?: () => Record<number, AugmentInfo>
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

  router.get('/players/:puuid/champions', async (req, res) => {
    res.json(await getChampionStats(req.params.puuid, parsePatches(req.query.patches)))
  })

  router.get('/players/:puuid/matches', async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
    res.json(await getRecentMatches(limit, req.params.puuid, parsePatches(req.query.patches)))
  })

  router.get('/players/:puuid/augments', async (req, res) => {
    const cache = opts.getAugments?.() ?? {}
    res.json(await getAugmentStats(req.params.puuid, undefined, parsePatches(req.query.patches), cache))
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
    const cache = opts.getAugments?.() ?? {}
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    res.json(await getAugmentStats(undefined, championId, parsePatches(req.query.patches), cache))
  })

  router.get('/augments/:augmentId/champions', async (req, res) => {
    const augmentId = parseInt(req.params.augmentId)
    const puuid = typeof req.query.puuid === 'string' ? req.query.puuid : undefined
    res.json(await getAugmentChampionStats(augmentId, puuid, parsePatches(req.query.patches)))
  })

  return router
}

export default createStatsRouter()

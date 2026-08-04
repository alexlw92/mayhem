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
  getPlayerName,
  getCoplayerStats,
  searchPlayers,
  getItemBuilds,
  getItemPickRates,
  upsertItemMeta,
  getOrComputeArchetypes,
  updateElo,
  recomputeEloFull,
  getEloHistory,
  getEloLeaderboard,
  recomputePlayerElo,
  AugmentInfo
} from '../db'

export interface StatsOptions {
  getAugments?: () => Record<number, AugmentInfo>
  getChampions?: () => Record<number, { name: string; tags: string[] }>
  latestPatch?: { value: string | null }
}

const parsePatches = (raw: unknown): string[] | undefined => {
  if (typeof raw !== 'string' || !raw) return undefined
  return raw.split(',')
}

const parseQueueId = (raw: unknown): number =>
  typeof raw === 'string' && raw ? parseInt(raw) || 2400 : 2400

export function createStatsRouter(opts: StatsOptions = {}): Router {
  const router = Router()

  router.get('/patches', async (_req, res) => {
    res.json(await getPatches())
  })

  router.get('/players', async (req, res) => {
    res.json(await getPlayerStats(parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/players/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q || q.length < 2) return res.json([])
    res.json(await searchPlayers(q))
  })

  router.get('/players/elo-leaderboard', async (req, res) => {
    const queueId = parseQueueId(req.query.queueId)
    const minGames = parseInt(req.query.minGames as string) || 10
    res.json(await getEloLeaderboard(queueId, minGames))
  })

  router.get('/players/:puuid/stats', async (req, res) => {
    res.json(await getOnePlayerStats(req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.post('/players/bulk-stats', async (req, res) => {
    const puuids = Array.isArray(req.body.puuids) ? (req.body.puuids as string[]) : []
    res.json(await getBulkPlayerStats(puuids, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/players/:puuid/champions', async (req, res) => {
    res.json(await getChampionStats(req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/players/:puuid/matches', async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
    res.json(await getRecentMatches(limit, req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/players/:puuid/augments', async (req, res) => {
    const augCache = opts.getAugments?.() ?? {}
    res.json(await getAugmentStats(req.params.puuid, undefined, parsePatches(req.query.patches), augCache, parseQueueId(req.query.queueId)))
  })

  router.get('/players/:puuid/name', async (req, res) => {
    res.json(await getPlayerName(req.params.puuid))
  })

  router.get('/players/:puuid/coplayers', async (req, res) => {
    res.json(await getCoplayerStats(req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/champions', async (req, res) => {
    res.json(await getChampionStats(undefined, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/augments', async (req, res) => {
    const augCache = opts.getAugments?.() ?? {}
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    res.json(await getAugmentStats(undefined, championId, patches, augCache, parseQueueId(req.query.queueId)))
  })

  router.get('/augments/:augmentId/champions', async (req, res) => {
    const augmentId = parseInt(req.params.augmentId)
    const puuid = typeof req.query.puuid === 'string' ? req.query.puuid : undefined
    res.json(await getAugmentChampionStats(augmentId, puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })

  router.get('/items/builds', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const allowedIds = typeof req.query.allowed === 'string' && req.query.allowed
      ? req.query.allowed.split(',').map(Number).filter(Boolean)
      : []
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getItemBuilds(championId, patches, allowedIds, queueId))
  })

  router.get('/items/picks', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    res.json(await getItemPickRates(championId, patches, parseQueueId(req.query.queueId)))
  })

  router.get('/items/archetypes', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    res.json(await getOrComputeArchetypes(championId, patches, parseQueueId(req.query.queueId)))
  })

  router.get('/items/summary', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const queueId = parseQueueId(req.query.queueId)
    const [archetypes, picks] = await Promise.all([
      getOrComputeArchetypes(championId, patches, queueId),
      getItemPickRates(championId, patches, queueId),
    ])
    res.json({ archetypes, totalGames: picks.totalGames, items: picks.items })
  })

  router.post('/meta/items', async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const componentIds = Array.isArray(req.body?.componentIds) ? req.body.componentIds : []
    await upsertItemMeta(items, componentIds)
    res.json({ ok: true })
  })

  router.post('/players/elo/recompute', async (req, res) => {
    const queueId = parseQueueId(req.query.queueId)
    const wipe = req.query.wipe === 'true'
    const games = wipe ? await recomputeEloFull(queueId) : await updateElo(queueId)
    res.json({ ok: true, games })
  })

  router.post('/players/elo/recompute-affected', async (req, res) => {
    const puuids: string[] = Array.isArray(req.body?.puuids) ? req.body.puuids : []
    if (puuids.length === 0) return res.json({ recomputed: 0 })
    const results = await Promise.all(
      puuids.flatMap(p => [2400, 2450].map(q => recomputePlayerElo(p, q)))
    )
    res.json({ recomputed: results.reduce((s, n) => s + n, 0) })
  })

  router.get('/players/:puuid/elo-history', async (req, res) => {
    res.json(await getEloHistory(req.params.puuid, parseQueueId(req.query.queueId)))
  })

  return router
}

export default createStatsRouter()

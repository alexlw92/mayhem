import { Router, NextFunction } from 'express'
import { getOrFetch } from '../queryCache'
import { getMetrics, resetMetrics } from '../metrics'
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
  AugmentInfo,
  getPlayerPerformance,
  getPerformancePercentiles,
  ChampionMeta,
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

  const patchKey = (patches: string[] | undefined) => (patches ?? []).slice().sort().join(',')

  router.get('/patches', async (_req, res, next: NextFunction) => {
    try {
      res.json(await getPatches())
    } catch (err) { next(err) }
  })

  router.get('/players', async (req, res, next: NextFunction) => {
    try {
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `players:${patchKey(patches)}:${queueId}`,
        () => getPlayerStats(patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/players/search', async (req, res, next: NextFunction) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      if (!q || q.length < 2) return res.json([])
      res.json(await searchPlayers(q))
    } catch (err) { next(err) }
  })

  router.get('/players/elo-leaderboard', async (req, res, next: NextFunction) => {
    try {
      const queueId = parseQueueId(req.query.queueId)
      const minGames = parseInt(req.query.minGames as string) || 10
      res.json(await getEloLeaderboard(queueId, minGames))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/stats', async (req, res, next: NextFunction) => {
    try {
      res.json(await getOnePlayerStats(req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })

  router.post('/players/bulk-stats', async (req, res, next: NextFunction) => {
    try {
      const puuids = Array.isArray(req.body.puuids) ? (req.body.puuids as string[]) : []
      res.json(await getBulkPlayerStats(puuids, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/champions', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `champ_player:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getChampionStats(puuid, patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/matches', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
      res.json(await getOrFetch(
        `matches_player:${puuid}:${patchKey(patches)}:${queueId}:${limit ?? ''}`,
        () => getRecentMatches(limit, puuid, patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/augments', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      const augCache = opts.getAugments?.() ?? {}
      res.json(await getOrFetch(
        `aug_player:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getAugmentStats(puuid, undefined, patches, augCache, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/name', async (req, res, next: NextFunction) => {
    try {
      res.json(await getPlayerName(req.params.puuid))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/coplayers', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `coplayers:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getCoplayerStats(puuid, patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/champions', async (req, res, next: NextFunction) => {
    try {
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `champions:${patchKey(patches)}:${queueId}`,
        () => getChampionStats(undefined, patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/augments', async (req, res, next: NextFunction) => {
    try {
      const augCache = opts.getAugments?.() ?? {}
      const rawPatches = parsePatches(req.query.patches)
      const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
      const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
      const queueId = parseQueueId(req.query.queueId)
      if (championId !== undefined) {
        res.json(await getAugmentStats(undefined, championId, patches, augCache, queueId))
      } else {
        res.json(await getOrFetch(
          `augments:${patchKey(patches)}:${queueId}`,
          () => getAugmentStats(undefined, undefined, patches, augCache, queueId)
        ))
      }
    } catch (err) { next(err) }
  })

  router.get('/augments/:augmentId/champions', async (req, res, next: NextFunction) => {
    try {
      const augmentId = parseInt(req.params.augmentId)
      const puuid = typeof req.query.puuid === 'string' ? req.query.puuid : undefined
      res.json(await getAugmentChampionStats(augmentId, puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })

  router.get('/items/builds', async (req, res, next: NextFunction) => {
    try {
      const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
      if (!championId) return res.status(400).json({ error: 'championId required' })
      const rawPatches = parsePatches(req.query.patches)
      const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
      const allowedIds = typeof req.query.allowed === 'string' && req.query.allowed
        ? req.query.allowed.split(',').map(Number).filter(Boolean)
        : []
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `item_builds:${championId}:${patchKey(patches)}:${allowedIds.slice().sort().join(',')}:${queueId}`,
        () => getItemBuilds(championId, patches, allowedIds, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/items/picks', async (req, res, next: NextFunction) => {
    try {
      const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
      if (!championId) return res.status(400).json({ error: 'championId required' })
      const rawPatches = parsePatches(req.query.patches)
      const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `item_picks:${championId}:${patchKey(patches)}:${queueId}`,
        () => getItemPickRates(championId, patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/items/archetypes', async (req, res, next: NextFunction) => {
    try {
      const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
      if (!championId) return res.status(400).json({ error: 'championId required' })
      const rawPatches = parsePatches(req.query.patches)
      const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `item_archetypes:${championId}:${patchKey(patches)}:${queueId}`,
        () => getOrComputeArchetypes(championId, patches, queueId)
      ))
    } catch (err) { next(err) }
  })

  router.get('/items/summary', async (req, res, next: NextFunction) => {
    try {
      const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
      if (!championId) return res.status(400).json({ error: 'championId required' })
      const rawPatches = parsePatches(req.query.patches)
      const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
      const queueId = parseQueueId(req.query.queueId)
      const [archetypes, picks] = await Promise.all([
        getOrFetch(
          `item_archetypes:${championId}:${patchKey(patches)}:${queueId}`,
          () => getOrComputeArchetypes(championId, patches, queueId)
        ),
        getOrFetch(
          `item_picks:${championId}:${patchKey(patches)}:${queueId}`,
          () => getItemPickRates(championId, patches, queueId)
        ),
      ])
      res.json({ archetypes, totalGames: picks.totalGames, items: picks.items })
    } catch (err) { next(err) }
  })

  router.post('/meta/items', async (req, res, next: NextFunction) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : []
      const componentIds = Array.isArray(req.body?.componentIds) ? req.body.componentIds : []
      await upsertItemMeta(items, componentIds)
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  router.post('/players/elo/recompute', async (req, res, next: NextFunction) => {
    try {
      const queueId = parseQueueId(req.query.queueId)
      const wipe = req.query.wipe === 'true'
      const games = wipe ? await recomputeEloFull(queueId) : await updateElo(queueId)
      res.json({ ok: true, games })
    } catch (err) { next(err) }
  })

  router.post('/players/elo/recompute-affected', async (req, res, next: NextFunction) => {
    try {
      const puuids: string[] = Array.isArray(req.body?.puuids) ? req.body.puuids : []
      if (puuids.length === 0) return res.json({ recomputed: 0 })
      const results = await Promise.all(
        puuids.flatMap(p => [2400, 2450].map(q => recomputePlayerElo(p, q)))
      )
      res.json({ recomputed: results.reduce((s, n) => s + n, 0) })
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/elo-history', async (req, res, next: NextFunction) => {
    try {
      res.json(await getEloHistory(req.params.puuid, parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })

  router.get('/players/:puuid/performance', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      const championMap = (opts.getChampions?.() ?? {}) as Record<number, ChampionMeta>
      const [perf, percentiles] = await Promise.all([
        getOrFetch(
          `perf_data:${puuid}:${patchKey(patches)}:${queueId}`,
          () => getPlayerPerformance(puuid, championMap, patches, queueId)
        ),
        getOrFetch(
          `perf:${puuid}:${patchKey(patches)}:${queueId}`,
          () => getPerformancePercentiles(puuid, patches, queueId)
        ),
      ])
      res.json({ ...perf, percentiles })
    } catch (err) { next(err) }
  })

  router.get('/metrics', (_req, res) => {
    res.json(getMetrics())
  })

  router.post('/metrics/reset', (_req, res) => {
    resetMetrics()
    res.json({ ok: true })
  })

  return router
}

export default createStatsRouter()

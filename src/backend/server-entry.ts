import 'dotenv/config'
import axios from 'axios'
import {
  initDb,
  upsertChampions, upsertAugments,
  getChampionsFromDb, getAugmentsFromDb,
  getPatches, getChampionStats, getAugmentStats, getPlayerStats,
} from './db'
import { setCached } from './queryCache'
import { createExpressApp } from './server'
import type { AugmentInfo } from './db'

const PORT = parseInt(process.env.PORT ?? '3847')
const REFRESH_INTERVAL_MS = 60 * 60 * 1000

async function fetchChampionNames(): Promise<Record<number, string>> {
  const { data: versions } = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json', { timeout: 10000 })
  const { data } = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`, { timeout: 10000 })
  const map: Record<number, string> = {}
  for (const c of Object.values(data.data) as any[]) map[parseInt(c.key)] = c.name
  return map
}

async function fetchAugments(): Promise<Record<number, AugmentInfo>> {
  const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json'
  const RARITY_MAP: Record<string, number> = { kSilver: 0, kGold: 1, kPrismatic: 2 }
  const { data } = await axios.get(CDRAGON, { timeout: 15000 })
  const map: Record<number, AugmentInfo> = {}
  for (const a of (Array.isArray(data) ? data : [])) {
    map[a.id] = { id: a.id, name: a.nameTRA ?? `Augment ${a.id}`, desc: '', iconPath: '', rarity: RARITY_MAP[a.rarity ?? ''] ?? 0 }
  }
  return map
}

async function refreshMetadata(
  champRef: { value: Record<number, string> },
  augRef: { value: Record<number, AugmentInfo> }
): Promise<void> {
  try {
    const [champions, augments] = await Promise.all([fetchChampionNames(), fetchAugments()])
    await Promise.all([upsertChampions(champions), upsertAugments(augments)])
    champRef.value = champions
    augRef.value = augments
    console.log(`[meta] refreshed — ${Object.keys(champions).length} champions, ${Object.keys(augments).length} augments`)
  } catch (err) {
    console.warn('[meta] refresh failed (using cached DB data):', (err as Error).message)
  }
}

async function tryWarm(key: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    setCached(key, await fn())
    console.log(`[cache] ${key} done`)
  } catch (e) {
    console.warn(`[cache] ${key} failed:`, (e as Error).message)
  }
}

async function warmCache(augRef: { value: Record<number, AugmentInfo> }): Promise<void> {
  const patches = await getPatches()
  const patch = patches[0] ?? null

  // Patch-specific queries first — these are what users see on first load.
  // All-patches queries (full table scans) run after and are lower priority.
  if (patch) {
    await tryWarm(`champions:${patch}`, () => getChampionStats(undefined, [patch]))
    await tryWarm(`players:${patch}`,   () => getPlayerStats([patch]))
    await tryWarm(`augments:${patch}`,  () => getAugmentStats(undefined, undefined, [patch], augRef.value))
  }

  await tryWarm('champions:all', () => getChampionStats(undefined, undefined))
  await tryWarm('players:all',   () => getPlayerStats(undefined))
  await tryWarm('augments:all',  () => getAugmentStats(undefined, undefined, undefined, augRef.value))

  console.log('[cache] warm complete')
}

async function main() {
  console.log('[db] initializing...')
  await initDb()
  console.log('[db] ready')

  const champRef = { value: await getChampionsFromDb() }
  const augRef   = { value: await getAugmentsFromDb() }
  console.log(`[meta] loaded from DB — ${Object.keys(champRef.value).length} champions, ${Object.keys(augRef.value).length} augments`)

  refreshMetadata(champRef, augRef)
  setInterval(() => refreshMetadata(champRef, augRef), REFRESH_INTERVAL_MS)

  createExpressApp({
    getChampions: () => champRef.value,
    getAugments:  () => augRef.value,
    warmCache: () => warmCache(augRef),
  }).listen(PORT, () => {
    console.log(`[server] :${PORT}`)
    warmCache(augRef).catch(err => console.warn('[cache] warm failed:', (err as Error).message))
  })
}

main().catch((err) => { console.error(err); process.exit(1) })

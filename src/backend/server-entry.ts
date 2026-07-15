import axios from 'axios'
import {
  initDb,
  backfillDetailCaches,
  upsertChampions, upsertAugments,
  getChampionsFromDb, getAugmentsFromDb,
  getPatches,
  upsertItemMeta,
} from './db'
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

async function fetchAndStoreItems(): Promise<void> {
  const CDRAGON_PLUGIN = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'
  const { data } = await axios.get<any[]>(`${CDRAGON_PLUGIN}/v1/items.json`, { timeout: 15000 })
  const items: Array<{ id: number; name: string; iconPath: string; category: string }> = []
  const componentIds: number[] = []
  for (const item of data) {
    if (!item.id || !item.name) continue
    const cats: string[] = item.categories ?? []
    if (cats.includes('Consumable') || cats.includes('Trinket')) continue
    if ((item.priceTotal ?? 0) < 700) continue
    if ((item.from?.length ?? 0) === 0 && Array.isArray(item.to) && item.to.length > 0) {
      componentIds.push(item.id); continue
    }
    const iconRaw: string = item.iconPath ?? ''
    const iconPath = iconRaw
      ? `${CDRAGON_PLUGIN}/${iconRaw.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase()}`
      : ''
    items.push({ id: item.id, name: item.name, iconPath, category: cats.includes('Boots') ? 'Boots' : (cats[0] ?? '') })
  }
  await upsertItemMeta(items, componentIds)
  console.log(`[meta] seeded ${items.length} items + ${componentIds.length} components`)
}

async function main() {
  console.log('[db] initializing...')
  await initDb()
  console.log('[db] ready')
  backfillDetailCaches().catch(err => console.warn('[backfill] failed:', (err as Error).message))
  fetchAndStoreItems().catch(err => console.warn('[meta] item seed failed:', (err as Error).message))

  const champRef = { value: await getChampionsFromDb() }
  const augRef   = { value: await getAugmentsFromDb() }
  const latestPatchRef = { value: null as string | null }
  console.log(`[meta] loaded from DB — ${Object.keys(champRef.value).length} champions, ${Object.keys(augRef.value).length} augments`)

  const patches = await getPatches()
  latestPatchRef.value = patches[0] ?? null

  refreshMetadata(champRef, augRef)
  setInterval(() => refreshMetadata(champRef, augRef), REFRESH_INTERVAL_MS)

  createExpressApp({
    getChampions: () => champRef.value,
    getAugments:  () => augRef.value,
    latestPatch:  latestPatchRef,
  }).listen(PORT, () => {
    console.log(`[server] :${PORT}`)
    ;(process as any).parentPort?.postMessage({ type: 'ready' })
  })
}

main().catch((err) => { console.error(err); process.exit(1) })

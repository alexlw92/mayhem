import 'dotenv/config'
import axios from 'axios'
import { initDb } from './db'
import { createExpressApp } from './server'
import type { AugmentInfo } from './db'

const PORT = parseInt(process.env.PORT ?? '3847')

async function fetchChampionNames(): Promise<Record<number, string>> {
  const { data: versions } = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json', { timeout: 10000 })
  const { data } = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`, { timeout: 10000 })
  const map: Record<number, string> = {}
  for (const c of Object.values(data.data) as any[]) map[parseInt(c.key)] = c.name
  return map
}

async function fetchAugments(): Promise<Record<number, AugmentInfo>> {
  const CDRAGON = 'https://raw.communitydragon.org/latest/cdragon/arena/en_us.json'
  const RARITY_MAP: Record<string, number> = { kSilver: 0, kGold: 1, kPrismatic: 2 }
  const { data } = await axios.get(CDRAGON, { timeout: 15000 })
  const map: Record<number, AugmentInfo> = {}
  for (const a of data.augments ?? []) {
    map[a.id] = { id: a.id, name: a.nameTRA ?? `Augment ${a.id}`, desc: '', iconPath: '', rarity: RARITY_MAP[a.rarity ?? ''] ?? 0 }
  }
  return map
}

async function main() {
  await initDb()
  const [champions, augments] = await Promise.all([fetchChampionNames(), fetchAugments()])
  createExpressApp({ getChampions: () => champions, getAugments: () => augments })
    .listen(PORT, () => console.log(`[server] :${PORT}`))
}
main().catch((err) => { console.error(err); process.exit(1) })

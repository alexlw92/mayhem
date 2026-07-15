export interface ItemMeta {
  id: number
  name: string
  iconPath: string
  category: string
}

export interface BuildRow {
  build: number[]
  games: number
  wins: number
  items: ItemMeta[]
}

export interface Archetype {
  openingId: number
  openingItem: ItemMeta
  archetypeLabel: string | null
  bootId: number | null
  bootItem: ItemMeta | null
  coreIds: [number, number]
  coreItems: [ItemMeta, ItemMeta]
  variants: BuildRow[]
  games: number
  wins: number
}

// Items that are characteristically purchased FIRST in ARAM, grouped by champion archetype.
// Items can belong to multiple archetypes (e.g. Eclipse is both Assassin and Fighter).
const ITEM_ARCHETYPES: Record<string, string[]> = {
  Tank:     ['heartsteel', 'sunfire aegis', 'frostfire gauntlet', 'turbo chemtank'],
  Fighter:  ['ravenous hydra', 'divine sunderer', 'trinity force', 'iceborn gauntlet', 'eclipse'],
  Crit:     ['yun tal wildarrows', 'collector', 'essence reaver'],
  'On-Hit': ['kraken slayer'],
  AP:       ["luden's tempest", 'blackfire torch', 'malignance', 'rod of ages',
             "archangel's staff", 'hextech rocketbelt', 'night harvester', 'imperial mandate'],
  Assassin: ['hubris', 'duskblade of draktharr', 'eclipse'],
  Support:  ['imperial mandate', 'manamune'],
}

// name (lowercase) → archetype label(s)
const FIRST_ITEM_LOOKUP = new Map<string, string[]>()
for (const [label, names] of Object.entries(ITEM_ARCHETYPES)) {
  for (const name of names) {
    const existing = FIRST_ITEM_LOOKUP.get(name) ?? []
    existing.push(label)
    FIRST_ITEM_LOOKUP.set(name, existing)
  }
}

export function clusterBuilds(builds: BuildRow[], validItemNames?: Set<string>): Archetype[] {
  if (builds.length === 0) return []

  const globalFreq = new Map<number, number>()
  const itemById = new Map<number, ItemMeta>()
  for (const b of builds) {
    for (const item of b.items) {
      globalFreq.set(item.id, (globalFreq.get(item.id) ?? 0) + b.games)
      if (!itemById.has(item.id)) itemById.set(item.id, item)
    }
  }

  const tripleMap = new Map<string, { ids: [number, number, number]; games: number; wins: number; variants: BuildRow[] }>()
  for (const b of builds) {
    const ids = b.items.map(i => i.id)
    for (let i = 0; i < ids.length - 2; i++) {
      for (let j = i + 1; j < ids.length - 1; j++) {
        for (let k = j + 1; k < ids.length; k++) {
          const sorted = [ids[i], ids[j], ids[k]].sort((a, z) => a - z) as [number, number, number]
          const key = sorted.join('-')
          const entry = tripleMap.get(key) ?? { ids: sorted, games: 0, wins: 0, variants: [] }
          entry.games += b.games
          entry.wins += b.wins
          entry.variants.push(b)
          tripleMap.set(key, entry)
        }
      }
    }
  }

  const top = [...tripleMap.values()].sort((a, b) => b.games - a.games).slice(0, 10)

  return top.map(({ ids, games, wins, variants }) => {
    const items = ids.map(id => itemById.get(id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' })

    const isOpener = (item: ItemMeta) => {
      const lower = item.name.toLowerCase()
      return FIRST_ITEM_LOOKUP.has(lower) && (!validItemNames || validItemNames.has(lower))
    }
    const byFreqDesc = (a: ItemMeta, b: ItemMeta) => (globalFreq.get(b.id) ?? 0) - (globalFreq.get(a.id) ?? 0)

    const recognized = items.filter(isOpener).sort(byFreqDesc)
    const others = items.filter(i => !isOpener(i)).sort(byFreqDesc)
    const ordered = [...recognized, ...others]

    const opener = ordered[0]
    const openerLabel = FIRST_ITEM_LOOKUP.get(opener.name.toLowerCase())?.join(' / ') ?? null

    return {
      openingId: opener.id,
      openingItem: opener,
      archetypeLabel: openerLabel,
      bootId: null,
      bootItem: null,
      coreIds: [ordered[1].id, ordered[2].id] as [number, number],
      coreItems: [ordered[1], ordered[2]] as [ItemMeta, ItemMeta],
      variants: [...variants].sort((a, b) => b.games - a.games),
      games,
      wins,
    }
  })
}

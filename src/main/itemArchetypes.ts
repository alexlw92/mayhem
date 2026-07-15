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
  coreIds: number[]
  coreItems: ItemMeta[]
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
    for (const item of b.items.filter(i => i.category !== 'Boots')) {
      globalFreq.set(item.id, (globalFreq.get(item.id) ?? 0) + b.games)
      if (!itemById.has(item.id)) itemById.set(item.id, item)
    }
  }

  const pairMap = new Map<string, { ids: [number, number]; games: number; wins: number; variants: BuildRow[] }>()
  for (const b of builds) {
    const ids = b.items.filter(i => i.category !== 'Boots').map(i => i.id)
    for (let i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const sorted = [ids[i], ids[j]].sort((a, z) => a - z) as [number, number]
        const key = sorted.join('-')
        const entry = pairMap.get(key) ?? { ids: sorted, games: 0, wins: 0, variants: [] }
        entry.games += b.games
        entry.wins += b.wins
        entry.variants.push(b)
        pairMap.set(key, entry)
      }
    }
  }

  const sortedPairs = [...pairMap.values()].sort((a, b) => b.games - a.games)
  const assigned = new Set<BuildRow>()
  const top: Array<{ ids: [number, number]; games: number; wins: number; variants: BuildRow[] }> = []

  for (const pair of sortedPairs) {
    if (top.length >= 20) break
    const unassigned = pair.variants.filter(b => !assigned.has(b))
    if (unassigned.length === 0) continue
    unassigned.forEach(b => assigned.add(b))
    top.push({
      ids: pair.ids,
      variants: pair.variants,
      games: pair.games,
      wins: pair.wins,
    })
  }

  function topNSig(variants: BuildRow[], n: number): string {
    const freq = new Map<number, number>()
    for (const v of variants) {
      for (const item of v.items.filter(i => i.category !== 'Boots')) {
        freq.set(item.id, (freq.get(item.id) ?? 0) + v.games)
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id]) => id)
      .sort((a, b) => a - b)
      .join('-')
  }

  function buildArchetype(variants: BuildRow[], games: number, wins: number, numCore: 1 | 2): Archetype {
    const localFreq = new Map<number, number>()
    for (const v of variants) {
      for (const item of v.items.filter(i => i.category !== 'Boots')) {
        localFreq.set(item.id, (localFreq.get(item.id) ?? 0) + v.games)
      }
    }
    const topIds = [...localFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1 + numCore)
      .map(([id]) => id)
    const items = topIds.map(id => itemById.get(id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' })

    const first = items[0]
    const cores = items.slice(1)
    const archetypeLabel = items.map(i => FIRST_ITEM_LOOKUP.get(i.name.toLowerCase())).find(Boolean)?.join(' / ') ?? null
    return {
      openingId: first.id,
      openingItem: first,
      archetypeLabel,
      bootId: null,
      bootItem: null,
      coreIds: cores.map(c => c.id),
      coreItems: cores,
      variants: [...variants].sort((a, b) => b.games - a.games),
      games,
      wins,
    }
  }

  function mergeGroup(group: Array<{ variants: BuildRow[]; games: number; wins: number }>, numCore: 1 | 2): Archetype {
    if (group.length === 1) return buildArchetype(group[0].variants, group[0].games, group[0].wins, numCore)
    const uniqueVariants = new Set<BuildRow>()
    for (const g of group) for (const v of g.variants) uniqueVariants.add(v)
    const all = [...uniqueVariants]
    return buildArchetype(all, all.reduce((s, v) => s + v.games, 0), all.reduce((s, v) => s + v.wins, 0), numCore)
  }

  function runMergePass(archs: Archetype[], n: number): Archetype[] {
    const groups = new Map<string, Archetype[]>()
    for (const a of archs) {
      const key = topNSig(a.variants, n)
      const g = groups.get(key) ?? []
      g.push(a)
      groups.set(key, g)
    }
    return [...groups.values()].map(group => {
      if (group.length === 1) return group[0]
      const uniqueVariants = new Set<BuildRow>()
      for (const a of group) for (const v of a.variants) uniqueVariants.add(v)
      const all = [...uniqueVariants]
      return buildArchetype(all, all.reduce((s, v) => s + v.games, 0), all.reduce((s, v) => s + v.wins, 0), 2)
    })
  }

  // Pass 1: derive opener for each top[] entry first, then group by top-3 sig
  const preliminary = top.map(e => buildArchetype(e.variants, e.games, e.wins, 1))
  const pass1Map = new Map<string, number[]>()
  preliminary.forEach((arch, idx) => {
    const key = topNSig(arch.variants, 3)
    const g = pass1Map.get(key) ?? []
    g.push(idx)
    pass1Map.set(key, g)
  })
  let archetypes: Archetype[] = [...pass1Map.values()].map(indices => {
    if (indices.length === 1) return preliminary[indices[0]]
    const group = indices.map(i => top[i])
    return mergeGroup(group, 2)
  }).sort((a, b) => b.games - a.games)

  // Pass 2 (top-4) and Pass 3 (top-5): further merge within same opener
  archetypes = runMergePass(archetypes, 4).sort((a, b) => b.games - a.games)
  archetypes = runMergePass(archetypes, 5).sort((a, b) => b.games - a.games)

  return archetypes
}

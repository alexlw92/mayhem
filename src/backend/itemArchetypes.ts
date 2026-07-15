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
  starterId: number | null
  coreIds: number[]
  coreItems: ItemMeta[]
  variants: BuildRow[]
  games: number
  wins: number
}

export interface TripleRow {
  triple: number[]
  games: number
  wins: number
}

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

const FIRST_ITEM_LOOKUP = new Map<string, string[]>()
for (const [label, names] of Object.entries(ITEM_ARCHETYPES)) {
  for (const name of names) {
    const existing = FIRST_ITEM_LOOKUP.get(name) ?? []
    existing.push(label)
    FIRST_ITEM_LOOKUP.set(name, existing)
  }
}

export function clusterByFrequency(
  builds: BuildRow[],
  componentIds: Set<number>,
): Archetype[] {
  if (builds.length === 0) return []

  function top3(pool: BuildRow[]): ItemMeta[] {
    const freq = new Map<number, { item: ItemMeta; games: number }>()
    for (const b of pool) {
      for (const item of b.items) {
        if (item.category === 'Boots' || componentIds.has(item.id) || !item.name) continue
        const e = freq.get(item.id) ?? { item, games: 0 }
        e.games += b.games
        freq.set(item.id, e)
      }
    }
    return [...freq.values()].sort((a, b) => b.games - a.games).slice(0, 3).map(e => e.item)
  }

  const archetypes: Archetype[] = []
  let remaining = [...builds]

  // Find the most-frequent item (across all variant builds) that appears in ITEM_ARCHETYPES
  function findStarterId(pool: BuildRow[]): number | null {
    const freq = new Map<number, { item: ItemMeta; games: number }>()
    for (const b of pool) {
      for (const item of b.items) {
        if (item.category === 'Boots' || !item.name) continue
        const e = freq.get(item.id) ?? { item, games: 0 }
        e.games += b.games
        freq.set(item.id, e)
      }
    }
    const sorted = [...freq.values()].sort((a, b) => b.games - a.games)
    return sorted.find(e => FIRST_ITEM_LOOKUP.has(e.item.name.toLowerCase()))?.item.id ?? null
  }

  while (remaining.length > 0 && archetypes.length < 20) {
    const triple = top3(remaining)
    if (triple.length < 3) break

    const tripleIds = new Set(triple.map(i => i.id))
    const claimed = remaining.filter(b => b.items.filter(i => tripleIds.has(i.id)).length >= 2)
    if (claimed.length === 0) break

    remaining = remaining.filter(b => b.items.filter(i => tripleIds.has(i.id)).length < 2)

    const games = claimed.reduce((s, b) => s + b.games, 0)
    const wins  = claimed.reduce((s, b) => s + b.wins,  0)
    const archetypeLabel = triple.map(i => FIRST_ITEM_LOOKUP.get(i.name.toLowerCase())).find(Boolean)?.join(' / ') ?? null
    const starterId = findStarterId(claimed)
    archetypes.push({
      openingId: triple[0].id, openingItem: triple[0], archetypeLabel, starterId,
      coreIds: triple.slice(1).map(i => i.id), coreItems: triple.slice(1),
      variants: claimed.sort((a, b) => b.games - a.games),
      games, wins,
    })
  }

  function mergePass(archs: Archetype[]): Archetype[] {
    const parent = archs.map((_, i) => i)
    const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]))
    const union = (a: number, b: number) => { parent[find(a)] = find(b) }

    const pairToFirst = new Map<string, number>()
    archs.forEach((a, i) => {
      const ids = [a.openingId, ...a.coreIds].sort((x, y) => x - y)
      for (let x = 0; x < ids.length - 1; x++)
        for (let y = x + 1; y < ids.length; y++) {
          const k = `${ids[x]}-${ids[y]}`
          pairToFirst.has(k) ? union(i, pairToFirst.get(k)!) : pairToFirst.set(k, i)
        }
    })

    const groups = new Map<number, Archetype[]>()
    archs.forEach((a, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), a]) })

    return [...groups.values()].map(group => {
      if (group.length === 1) return group[0]
      const allVariants = [...new Set(group.flatMap(a => a.variants))]
      const games = allVariants.reduce((s, b) => s + b.games, 0)
      const wins  = allVariants.reduce((s, b) => s + b.wins,  0)
      // Use the biggest sub-archetype's triple as representative — recomputing with top3
      // introduces items not in either original triple, causing cascading merges across passes.
      const biggest = group.reduce((best, a) => a.games > best.games ? a : best)
      return {
        openingId: biggest.openingId,
        openingItem: biggest.openingItem,
        archetypeLabel: biggest.archetypeLabel,
        starterId: findStarterId(allVariants),
        coreIds: biggest.coreIds,
        coreItems: biggest.coreItems,
        variants: allVariants.sort((a, b) => b.games - a.games),
        games, wins,
      }
    })
  }

  let result = archetypes
  while (true) {
    const merged = mergePass(result)
    if (merged.length === result.length) break
    result = merged
  }

  return result.sort((a, b) => b.games - a.games)
}

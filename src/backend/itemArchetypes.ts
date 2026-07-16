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
  boots: { item: ItemMeta; picks: number; pickRate: number; wins: number }[]
  flexPairs: { items: [ItemMeta, ItemMeta]; picks: number; pickRate: number; wins: number }[]
}

const ITEM_ARCHETYPES: Record<string, string[]> = {
  Tank:     ['heartsteel', 'sunfire aegis', 'frostfire gauntlet', 'turbo chemtank'],
  Fighter:  ['ravenous hydra', 'divine sunderer', 'trinity force', 'iceborn gauntlet', 'eclipse'],
  Crit:     ['yun tal wildarrows', 'collector', 'essence reaver'],
  'On-Hit': ['kraken slayer', 'blade of the ruined king'],
  AP:       ["luden's tempest", 'blackfire torch', 'malignance', 'rod of ages',
             "archangel's staff", 'hextech rocketbelt', 'night harvester', 'imperial mandate',
             'lich bane', 'dusk and dawn'],
  Assassin: ['hubris', 'duskblade of draktharr', 'eclipse', 'dusk and dawn', 'collector'],
  Support:  ['imperial mandate', 'manamune'],
}

const FIRST_ITEM_LOOKUP = new Map<string, string[]>()
const STARTER_PRIORITY = new Map<string, number>()
for (const [label, names] of Object.entries(ITEM_ARCHETYPES)) {
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const existing = FIRST_ITEM_LOOKUP.get(name) ?? []
    existing.push(label)
    FIRST_ITEM_LOOKUP.set(name, existing)
    const prev = STARTER_PRIORITY.get(name) ?? Infinity
    STARTER_PRIORITY.set(name, Math.min(prev, i))
  }
}

function tripleKey(a: number, b: number, c: number): string {
  const s = [a, b, c].sort((x, y) => x - y)
  return `${s[0]}_${s[1]}_${s[2]}`
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

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
  const candidates = [...freq.values()].filter(e => FIRST_ITEM_LOOKUP.has(e.item.name.toLowerCase()))
  candidates.sort((a, b) => {
    const pa = STARTER_PRIORITY.get(a.item.name.toLowerCase()) ?? Infinity
    const pb = STARTER_PRIORITY.get(b.item.name.toLowerCase()) ?? Infinity
    return pa !== pb ? pa - pb : b.games - a.games
  })
  return candidates[0]?.item.id ?? null
}

export function clusterByCooccurrence(
  builds: BuildRow[],
  componentIds: Set<number>,
): Archetype[] {
  if (builds.length === 0) return []

  const totalGames = builds.reduce((s, b) => s + b.games, 0)
  const threshold = Math.max(totalGames * 0.02, 3)

  const itemById = new Map<number, ItemMeta>()
  for (const b of builds) {
    for (const item of b.items) {
      if (!itemById.has(item.id)) itemById.set(item.id, item)
    }
  }

  interface TripleEntry {
    ids: [number, number, number]
    games: number
    wins: number
    builds: BuildRow[]
  }

  // Phase 1: enumerate all triples and pairs from non-boot, non-component items
  const tripleMap = new Map<string, TripleEntry>()
  const pairGames = new Map<string, number>()

  for (const b of builds) {
    const ids = b.items
      .filter(i => i.category !== 'Boots' && !componentIds.has(i.id) && i.name)
      .map(i => i.id)

    for (let x = 0; x < ids.length - 1; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const pk = pairKey(ids[x], ids[y])
        pairGames.set(pk, (pairGames.get(pk) ?? 0) + b.games)
      }
    }

    for (let x = 0; x < ids.length - 2; x++) {
      for (let y = x + 1; y < ids.length - 1; y++) {
        for (let z = y + 1; z < ids.length; z++) {
          const tk = tripleKey(ids[x], ids[y], ids[z])
          if (!tripleMap.has(tk)) {
            tripleMap.set(tk, { ids: [ids[x], ids[y], ids[z]], games: 0, wins: 0, builds: [] })
          }
          const entry = tripleMap.get(tk)!
          entry.games += b.games
          entry.wins += b.wins
          entry.builds.push(b)
        }
      }
    }
  }

  // Phase 2: iterate pairs descending by games, collect up to 3 triples per pair
  const sortedPairs = [...pairGames.entries()].sort((a, b) => b[1] - a[1])
  const seenTriples = new Set<string>()
  const claimedPairs = new Set<string>()
  const candidates: TripleEntry[] = []

  for (const [pk] of sortedPairs) {
    const parts = pk.split('_')
    const pA = parseInt(parts[0])
    const pB = parseInt(parts[1])

    const pairTriples: TripleEntry[] = []
    for (const entry of tripleMap.values()) {
      if (entry.ids.includes(pA) && entry.ids.includes(pB)) pairTriples.push(entry)
    }
    pairTriples.sort((a, b) => b.games - a.games)

    let added = 0
    for (const triple of pairTriples) {
      if (added >= 3) break
      const tk = tripleKey(triple.ids[0], triple.ids[1], triple.ids[2])
      if (seenTriples.has(tk)) continue
      const tripleHasClaimedPair = [
        pairKey(triple.ids[0], triple.ids[1]),
        pairKey(triple.ids[0], triple.ids[2]),
        pairKey(triple.ids[1], triple.ids[2]),
      ].some(pk => claimedPairs.has(pk))
      if (tripleHasClaimedPair) continue
      if (triple.games < threshold) continue
      const hasStarter = triple.ids.some(id => {
        const meta = itemById.get(id)
        return meta ? FIRST_ITEM_LOOKUP.has(meta.name.toLowerCase()) : false
      })
      if (!hasStarter) continue
      seenTriples.add(tk)
      claimedPairs.add(pairKey(triple.ids[0], triple.ids[1]))
      claimedPairs.add(pairKey(triple.ids[0], triple.ids[2]))
      claimedPairs.add(pairKey(triple.ids[1], triple.ids[2]))
      candidates.push(triple)
      added++
    }
  }

  candidates.sort((a, b) => b.games - a.games)
  const top = candidates.slice(0, 8)

  // Phase 3: enrich each triple with boots + flex pair stats (all conditioned on full triple)
  return top.map(triple => {
    const coreIdSet = new Set<number>(triple.ids)
    const totalFullTriple = triple.games

    // Boots
    const bootMap = new Map<number, { item: ItemMeta; picks: number; wins: number }>()
    for (const b of triple.builds) {
      for (const item of b.items) {
        if (item.category !== 'Boots' || !item.name) continue
        const e = bootMap.get(item.id) ?? { item, picks: 0, wins: 0 }
        e.picks += b.games
        e.wins += b.wins
        bootMap.set(item.id, e)
      }
    }
    const boots = [...bootMap.values()]
      .sort((a, b) => b.picks - a.picks)
      .map(e => ({ ...e, pickRate: totalFullTriple > 0 ? e.picks / totalFullTriple : 0 }))

    // Flex pairs: non-core, non-boot, non-component items in each full-triple build
    const flexPairMap = new Map<string, { items: [ItemMeta, ItemMeta]; picks: number; wins: number }>()
    for (const b of triple.builds) {
      const flex = b.items.filter(
        i => !coreIdSet.has(i.id) && i.category !== 'Boots' && !componentIds.has(i.id) && i.name
      )
      for (let x = 0; x < flex.length - 1; x++) {
        for (let y = x + 1; y < flex.length; y++) {
          const fk = pairKey(flex[x].id, flex[y].id)
          const e = flexPairMap.get(fk) ?? { items: [flex[x], flex[y]] as [ItemMeta, ItemMeta], picks: 0, wins: 0 }
          e.picks += b.games
          e.wins += b.wins
          flexPairMap.set(fk, e)
        }
      }
    }
    const flexPairs = [...flexPairMap.values()]
      .sort((a, b) => b.picks - a.picks)
      .map(e => ({ ...e, pickRate: totalFullTriple > 0 ? e.picks / totalFullTriple : 0 }))

    const archMetas = triple.ids.map(id => itemById.get(id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' })
    const archetypeLabel = archMetas.map(i => FIRST_ITEM_LOOKUP.get(i.name.toLowerCase())).find(Boolean)?.join(' / ') ?? null
    const starterId = findStarterId(triple.builds)

    // Reorder so detected starter is first
    let orderedIds = [...triple.ids] as number[]
    let orderedMetas = [...archMetas]
    if (starterId !== null) {
      const idx = orderedIds.indexOf(starterId)
      if (idx > 0) {
        orderedIds = [orderedIds[idx], ...orderedIds.filter((_, i) => i !== idx)]
        orderedMetas = [orderedMetas[idx], ...orderedMetas.filter((_, i) => i !== idx)]
      }
    }

    return {
      openingId: orderedIds[0],
      openingItem: orderedMetas[0],
      archetypeLabel,
      starterId,
      coreIds: orderedIds.slice(1),
      coreItems: orderedMetas.slice(1),
      variants: triple.builds.slice().sort((a, b) => b.games - a.games),
      games: triple.games,
      wins: triple.wins,
      boots,
      flexPairs,
    }
  }).sort((a, b) => b.games - a.games)
}

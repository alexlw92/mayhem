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
  coreIds: number[]
  coreItems: ItemMeta[]
  games: number
  wins: number
  boots: { item: ItemMeta; picks: number; pickRate: number; wins: number }[]
  fifthItems: { item: ItemMeta; picks: number; pickRate: number; wins: number }[]
}

function quadKey(a: number, b: number, c: number, d: number): string {
  const s = [a, b, c, d].sort((x, y) => x - y)
  return `${s[0]}_${s[1]}_${s[2]}_${s[3]}`
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

function allQuadPairs(ids: [number, number, number, number]): string[] {
  return [
    pairKey(ids[0], ids[1]), pairKey(ids[0], ids[2]), pairKey(ids[0], ids[3]),
    pairKey(ids[1], ids[2]), pairKey(ids[1], ids[3]), pairKey(ids[2], ids[3]),
  ]
}

export function clusterByCooccurrence(
  builds: BuildRow[],
  componentIds: Set<number>,
  noItemRatios: Map<number, number>,
): Archetype[] {
  if (builds.length === 0) return []

  const totalGames = builds.reduce((s, b) => s + b.games, 0)
  const threshold = Math.max(totalGames * 0.01, 2)

  const itemById = new Map<number, ItemMeta>()
  for (const b of builds) {
    for (const item of b.items) {
      if (!itemById.has(item.id)) itemById.set(item.id, item)
    }
  }

  interface QuadEntry {
    ids: [number, number, number, number]
    games: number
    wins: number
    builds: BuildRow[]
  }

  // Phase 1: enumerate all quads and pairs from non-boot, non-component items
  const quadMap = new Map<string, QuadEntry>()
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

    for (let x = 0; x < ids.length - 3; x++) {
      for (let y = x + 1; y < ids.length - 2; y++) {
        for (let z = y + 1; z < ids.length - 1; z++) {
          for (let w = z + 1; w < ids.length; w++) {
            const qk = quadKey(ids[x], ids[y], ids[z], ids[w])
            if (!quadMap.has(qk)) {
              quadMap.set(qk, { ids: [ids[x], ids[y], ids[z], ids[w]], games: 0, wins: 0, builds: [] })
            }
            const entry = quadMap.get(qk)!
            entry.games += b.games
            entry.wins += b.wins
            entry.builds.push(b)
          }
        }
      }
    }
  }

  // Phase 2: iterate pairs descending by games, collect up to 3 quads per pair
  const sortedPairs = [...pairGames.entries()].sort((a, b) => b[1] - a[1])
  const seenQuads = new Set<string>()
  const claimedPairs = new Set<string>()
  const candidates: QuadEntry[] = []

  for (const [pk] of sortedPairs) {
    const parts = pk.split('_')
    const pA = parseInt(parts[0])
    const pB = parseInt(parts[1])

    const pairQuads: QuadEntry[] = []
    for (const entry of quadMap.values()) {
      if (entry.ids.includes(pA) && entry.ids.includes(pB)) pairQuads.push(entry)
    }
    pairQuads.sort((a, b) => b.games - a.games)

    let added = 0
    for (const quad of pairQuads) {
      if (added >= 3) break
      const qk = quadKey(quad.ids[0], quad.ids[1], quad.ids[2], quad.ids[3])
      if (seenQuads.has(qk)) continue
      if (allQuadPairs(quad.ids).some(p => claimedPairs.has(p))) continue
      if (quad.games < threshold) continue
      seenQuads.add(qk)
      for (const p of allQuadPairs(quad.ids)) claimedPairs.add(p)
      candidates.push(quad)
      added++
    }
  }

  candidates.sort((a, b) => b.games - a.games)
  const top = candidates.slice(0, 8)

  // Phase 3: enrich each quad with boots + fifth items, order by no-item ratio
  return top.map(quad => {
    const quadIdSet = new Set<number>(quad.ids)
    const totalFullQuad = quad.games

    // Boots
    const bootMap = new Map<number, { item: ItemMeta; picks: number; wins: number }>()
    for (const b of quad.builds) {
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
      .map(e => ({ ...e, pickRate: totalFullQuad > 0 ? e.picks / totalFullQuad : 0 }))

    // Fifth items: non-quad, non-boot, non-component items in each build
    const fifthMap = new Map<number, { item: ItemMeta; picks: number; wins: number }>()
    for (const b of quad.builds) {
      const flex = b.items.filter(
        i => !quadIdSet.has(i.id) && i.category !== 'Boots' && !componentIds.has(i.id) && i.name
      )
      for (const item of flex) {
        const e = fifthMap.get(item.id) ?? { item, picks: 0, wins: 0 }
        e.picks += b.games
        e.wins += b.wins
        fifthMap.set(item.id, e)
      }
    }
    const fifthItems = [...fifthMap.values()]
      .sort((a, b) => b.picks - a.picks)
      .map(e => ({ ...e, pickRate: totalFullQuad > 0 ? e.picks / totalFullQuad : 0 }))

    // Order quad items by no-item ratio descending: highest ratio = opener (bought earliest)
    const orderedIds = [...quad.ids].sort(
      (a, b) => (noItemRatios.get(b) ?? 0) - (noItemRatios.get(a) ?? 0)
    )
    const orderedMetas = orderedIds.map(
      id => itemById.get(id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' }
    )

    return {
      openingId: orderedIds[0],
      openingItem: orderedMetas[0],
      coreIds: orderedIds.slice(1),
      coreItems: orderedMetas.slice(1),
      games: quad.games,
      wins: quad.wins,
      boots,
      fifthItems,
    }
  }).sort((a, b) => b.games - a.games)
}

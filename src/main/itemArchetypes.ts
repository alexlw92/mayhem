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
  coreIds: [number, number, number]
  coreItems: [ItemMeta, ItemMeta, ItemMeta]
  variants: BuildRow[]
  games: number
  wins: number
}

export function clusterBuilds(builds: BuildRow[]): Archetype[] {
  const trioMap = new Map<string, { ids: [number, number, number]; games: number; wins: number; combos: BuildRow[] }>()
  for (const b of builds) {
    const items = b.build
    for (let i = 0; i < items.length - 2; i++)
      for (let j = i + 1; j < items.length - 1; j++)
        for (let k = j + 1; k < items.length; k++) {
          const key = `${items[i]}-${items[j]}-${items[k]}`
          const entry = trioMap.get(key) ?? { ids: [items[i], items[j], items[k]], games: 0, wins: 0, combos: [] }
          entry.games += b.games
          entry.wins += b.wins
          entry.combos.push(b)
          trioMap.set(key, entry)
        }
  }

  const sortedTrios = [...trioMap.values()].sort((a, b) => b.games - a.games)
  const assigned = new Set<BuildRow>()
  const archetypes: Archetype[] = []

  for (const trio of sortedTrios) {
    if (archetypes.length >= 10) break
    const unassigned = trio.combos.filter(b => !assigned.has(b))
    if (unassigned.length === 0) continue
    unassigned.forEach(b => assigned.add(b))
    const findItem = (id: number): ItemMeta =>
      unassigned.flatMap(b => b.items).find(i => i.id === id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' }
    archetypes.push({
      coreIds: trio.ids,
      coreItems: [findItem(trio.ids[0]), findItem(trio.ids[1]), findItem(trio.ids[2])],
      variants: [...unassigned].sort((a, b) => b.games - a.games),
      games: unassigned.reduce((s, b) => s + b.games, 0),
      wins: unassigned.reduce((s, b) => s + b.wins, 0),
    })
  }

  return archetypes.sort((a, b) => b.games - a.games)
}

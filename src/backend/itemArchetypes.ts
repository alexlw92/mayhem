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
  orGroups: ItemMeta[][]
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

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

function buildGraph(
  pool: BuildRow[],
  componentIds: Set<number>,
): { edges: Map<string, number>; strength: Map<number, number> } {
  const edges = new Map<string, number>()
  const strength = new Map<number, number>()
  for (const b of pool) {
    const ids = b.items
      .filter(i => i.category !== 'Boots' && !componentIds.has(i.id) && i.name)
      .map(i => i.id)
    for (let x = 0; x < ids.length - 1; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const k = edgeKey(ids[x], ids[y])
        const w = b.games
        edges.set(k, (edges.get(k) ?? 0) + w)
        strength.set(ids[x], (strength.get(ids[x]) ?? 0) + w)
        strength.set(ids[y], (strength.get(ids[y]) ?? 0) + w)
      }
    }
  }
  return { edges, strength }
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
  const sorted = [...freq.values()].sort((a, b) => b.games - a.games)
  return sorted.find(e => FIRST_ITEM_LOOKUP.has(e.item.name.toLowerCase()))?.item.id ?? null
}

export function clusterByCooccurrence(
  builds: BuildRow[],
  componentIds: Set<number>,
): Archetype[] {
  if (builds.length === 0) return []

  const itemById = new Map<number, ItemMeta>()
  for (const b of builds) {
    for (const item of b.items) {
      if (!itemById.has(item.id)) itemById.set(item.id, item)
    }
  }

  const archetypes: Archetype[] = []
  let remaining = [...builds]

  while (remaining.length > 0 && archetypes.length < 20) {
    const { edges, strength } = buildGraph(remaining, componentIds)
    if (strength.size === 0) break

    // Seed with the highest-strength node (most central item across remaining builds)
    const seedId = [...strength.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const archIds: number[] = [seedId]

    // Greedily extend to 4 items: each step adds the candidate most connected to current archIds
    for (let step = 0; step < 3; step++) {
      let bestId = -1
      let bestScore = -1
      for (const [nodeId] of strength) {
        if (archIds.includes(nodeId)) continue
        const score = archIds.reduce((s, a) => s + (edges.get(edgeKey(nodeId, a)) ?? 0), 0)
        if (score > bestScore) { bestScore = score; bestId = nodeId }
      }
      if (bestId === -1 || bestScore === 0) break
      archIds.push(bestId)
    }

    if (archIds.length < 2) break

    const archIdSet = new Set(archIds)
    // ≥75% overlap: for 4-item archetypes requires 3 matching items
    const threshold = Math.max(2, Math.ceil(archIds.length * 0.75))

    const isMatch = (b: BuildRow) => {
      const ids = b.items.filter(i => i.category !== 'Boots' && !componentIds.has(i.id) && i.name).map(i => i.id)
      return ids.filter(id => archIdSet.has(id)).length >= threshold
    }

    const claimed = remaining.filter(isMatch)
    if (claimed.length === 0) break

    remaining = remaining.filter(b => !isMatch(b))

    const games = claimed.reduce((s, b) => s + b.games, 0)
    const wins  = claimed.reduce((s, b) => s + b.wins,  0)
    const archMetas = archIds.map(id => itemById.get(id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' })
    const archetypeLabel = archMetas.map(i => FIRST_ITEM_LOOKUP.get(i.name.toLowerCase())).find(Boolean)?.join(' / ') ?? null

    archetypes.push({
      openingId: archIds[0],
      openingItem: archMetas[0],
      archetypeLabel,
      starterId: findStarterId(claimed),
      coreIds: archIds.slice(1),
      coreItems: archMetas.slice(1),
      variants: claimed.sort((a, b) => b.games - a.games),
      games, wins,
      orGroups: [],
    })
  }

  // OR-item detection: within each archetype, identify mutually-exclusive flex items
  // (items that are frequently built but almost never co-occur, e.g. LDR vs Mortal Reminder)
  for (const arch of archetypes) {
    const archIdSet = new Set([arch.openingId, ...arch.coreIds])
    const { edges: archEdges } = buildGraph(arch.variants, componentIds)

    const flexFreq = new Map<number, { item: ItemMeta; games: number }>()
    for (const v of arch.variants) {
      for (const item of v.items) {
        if (archIdSet.has(item.id) || item.category === 'Boots' || !item.name) continue
        const s = flexFreq.get(item.id) ?? { item, games: 0 }
        s.games += v.games
        flexFreq.set(item.id, s)
      }
    }

    const minFlexGames = arch.games * 0.20
    const highFreqFlex = [...flexFreq.entries()]
      .filter(([, s]) => s.games >= minFlexGames)
      .map(([id, s]) => ({ id, item: s.item, games: s.games }))

    if (highFreqFlex.length < 2) continue

    const parent = new Map<number, number>()
    const find = (x: number): number => {
      const p = parent.get(x) ?? x
      if (p === x) return x
      const root = find(p)
      parent.set(x, root)
      return root
    }
    const union = (a: number, b: number) => parent.set(find(a), find(b))

    for (let i = 0; i < highFreqFlex.length - 1; i++) {
      for (let j = i + 1; j < highFreqFlex.length; j++) {
        const A = highFreqFlex[i]
        const B = highFreqFlex[j]
        const gamesWithBoth = archEdges.get(edgeKey(A.id, B.id)) ?? 0
        const mutualRate = gamesWithBoth / Math.min(A.games, B.games)
        if (mutualRate < 0.15) union(A.id, B.id)
      }
    }

    const groupMap = new Map<number, ItemMeta[]>()
    for (const { id, item } of highFreqFlex) {
      const root = find(id)
      const g = groupMap.get(root) ?? []
      g.push(item)
      groupMap.set(root, g)
    }

    arch.orGroups = [...groupMap.values()].filter(g => g.length > 1)
  }

  return archetypes.sort((a, b) => b.games - a.games)
}

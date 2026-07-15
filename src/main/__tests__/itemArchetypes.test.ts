import { describe, it, expect } from 'vitest'
import { clusterBuilds } from '../itemArchetypes'
import type { BuildRow } from '../itemArchetypes'

function item(id: number, name = `Item ${id}`) {
  return { id, name, iconPath: '', category: '' }
}

function build(ids: number[], games: number, wins: number, names?: string[]): BuildRow {
  return { build: ids, games, wins, items: ids.map((id, i) => item(id, names?.[i] ?? `Item ${id}`)) }
}

describe('clusterBuilds', () => {
  it('returns empty array for empty input', () => {
    expect(clusterBuilds([])).toEqual([])
  })

  it('single build produces one archetype', () => {
    const result = clusterBuilds([build([1, 2, 3, 4, 5], 10, 6)])
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(10)
    expect(result[0].wins).toBe(6)
    expect(result[0].openingId).toBeDefined()
    expect(result[0].coreIds).toHaveLength(2)
    expect(result[0].variants).toHaveLength(1)
  })

  it('two builds with same opener that share a non-opener pair become one archetype', () => {
    // b1 and b2 both have Heartsteel(1) as opener AND share the pair 2-3 in remaining items
    const b1 = build([1, 2, 3, 4, 5], 20, 12, ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([1, 2, 3, 6, 7], 10, 5,  ['Heartsteel', 'Item 2', 'Item 3', 'Item 6', 'Item 7'])
    const result = clusterBuilds([b1, b2])
    // top pair from remaining items is 2-3 (games=30), both builds contain it → 1 archetype
    expect(result).toHaveLength(1)
    expect(result[0].openingId).toBe(1)
    expect(result[0].games).toBe(30)
    expect(result[0].wins).toBe(17)
  })

  it('same opener with two distinct cores produces two archetypes', () => {
    // b1 and b2 share Heartsteel opener but have completely different remaining items
    const b1 = build([1, 2, 3, 4, 5], 20, 10, ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([1, 6, 7, 8, 9], 15, 8,  ['Heartsteel', 'Item 6', 'Item 7', 'Item 8', 'Item 9'])
    const result = clusterBuilds([b1, b2])
    expect(result).toHaveLength(2)
    expect(result[0].openingId).toBe(1)
    expect(result[1].openingId).toBe(1)
    // Different core pairs
    expect(result[0].coreIds).not.toEqual(result[1].coreIds)
  })

  it('two builds with different openers become two archetypes', () => {
    const b1 = build([1, 2, 3, 4, 5], 20, 10, ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([6, 7, 8, 9, 10], 15, 8, ['Hubris', 'Item 7', 'Item 8', 'Item 9', 'Item 10'])
    const result = clusterBuilds([b1, b2])
    expect(result).toHaveLength(2)
    const openers = result.map(a => a.openingId)
    expect(openers).toContain(1)
    expect(openers).toContain(6)
  })

  it('archetypes are sorted by games descending', () => {
    const b1 = build([1, 2, 3, 4, 5], 5, 2,   ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([6, 7, 8, 9, 10], 20, 10, ['Hubris', 'Item 7', 'Item 8', 'Item 9', 'Item 10'])
    const b3 = build([11, 12, 13, 14, 15], 12, 6, ['Collector', 'Item 12', 'Item 13', 'Item 14', 'Item 15'])
    const result = clusterBuilds([b1, b2, b3])
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].games).toBeGreaterThanOrEqual(result[i + 1].games)
    }
  })

  it('variants within an archetype are sorted by games descending', () => {
    const b1 = build([1, 2, 3, 4, 5], 5, 3,    ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([1, 2, 6, 7, 8], 20, 10,  ['Heartsteel', 'Item 2', 'Item 6', 'Item 7', 'Item 8'])
    const b3 = build([1, 2, 9, 10, 11], 12, 6, ['Heartsteel', 'Item 2', 'Item 9', 'Item 10', 'Item 11'])
    const result = clusterBuilds([b1, b2, b3])
    const variants = result[0].variants
    for (let i = 0; i < variants.length - 1; i++) {
      expect(variants[i].games).toBeGreaterThanOrEqual(variants[i + 1].games)
    }
  })

  it('caps output at 10 archetypes even with many unique openers', () => {
    const builds: BuildRow[] = []
    const knownOpeners = [
      'Heartsteel', 'Hubris', 'Collector', "Luden's Tempest", 'Blackfire Torch',
      'Immortal Shieldbow', 'Galeforce', 'Kraken Slayer', 'Ravenous Hydra', 'Riftmaker', 'Rod of Ages',
    ]
    for (let i = 0; i < knownOpeners.length; i++) {
      const base = i * 5
      builds.push(build(
        [base + 1, base + 2, base + 3, base + 4, base + 5],
        10 - i, 5,
        [knownOpeners[i], `Item ${base+2}`, `Item ${base+3}`, `Item ${base+4}`, `Item ${base+5}`]
      ))
    }
    const result = clusterBuilds(builds)
    expect(result.length).toBeLessThanOrEqual(10)
  })

  it('each build appears in exactly one archetype (no double-counting)', () => {
    const b1 = build([1, 2, 3, 4, 5], 10, 5, ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([1, 2, 6, 7, 8], 8, 4,  ['Heartsteel', 'Item 2', 'Item 6', 'Item 7', 'Item 8'])
    const b3 = build([9, 10, 11, 12, 13], 6, 3, ['Hubris', 'Item 10', 'Item 11', 'Item 12', 'Item 13'])
    const result = clusterBuilds([b1, b2, b3])
    const allVariants = result.flatMap(a => a.variants)
    const uniqueBuilds = new Set(allVariants.map(v => v.build.join(',')))
    expect(uniqueBuilds.size).toBe(allVariants.length)
  })

  it('archetype games equals sum of variant games', () => {
    const b1 = build([1, 2, 3, 4, 5], 15, 8, ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])
    const b2 = build([1, 2, 6, 7, 8], 10, 5, ['Heartsteel', 'Item 2', 'Item 6', 'Item 7', 'Item 8'])
    const result = clusterBuilds([b1, b2])
    for (const arch of result) {
      const variantGamesSum = arch.variants.reduce((s, v) => s + v.games, 0)
      expect(arch.games).toBe(variantGamesSum)
    }
  })

  it('coreItems contain valid ItemMeta for each coreId', () => {
    const result = clusterBuilds([build([10, 20, 30, 40, 50], 5, 3)])
    const arch = result[0]
    for (let i = 0; i < 2; i++) {
      expect(arch.coreItems[i].id).toBe(arch.coreIds[i])
      expect(typeof arch.coreItems[i].name).toBe('string')
    }
  })

  it('bootId and bootItem are null by default (no boots attached)', () => {
    const result = clusterBuilds([build([1, 2, 3, 4, 5], 10, 5)])
    expect(result[0].bootId).toBeNull()
    expect(result[0].bootItem).toBeNull()
  })

  it('openingItem matches openingId', () => {
    const result = clusterBuilds([build([1, 2, 3, 4, 5], 10, 5, ['Heartsteel', 'Item 2', 'Item 3', 'Item 4', 'Item 5'])])
    expect(result[0].openingItem.id).toBe(result[0].openingId)
  })

  it('IE (low item ID) is not detected as opener when Collector (higher ID) is present', () => {
    // Simulate sorted build: IE has lower ID than Collector, but Collector is the rush item
    // IE is NOT in FIRST_ITEM_NAMES, Collector IS — so Collector should be the opener
    const b = build([3031, 3036, 3094, 6655, 3085], 10, 5, [
      'Infinity Edge',    // ID 3031 — comes first in sorted array, but NOT a first item
      "Lord Dominik's Regards", // ID 3036
      'Rapid Firecannon', // ID 3094
      'Collector',        // ID 6655 — should be detected as opener
      "Runaan's Hurricane", // ID 3085
    ])
    const result = clusterBuilds([b])
    expect(result[0].openingId).toBe(6655) // Collector, not IE
    expect(result[0].openingItem.name).toBe('Collector')
  })
})

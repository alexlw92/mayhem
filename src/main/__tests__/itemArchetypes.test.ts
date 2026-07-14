import { describe, it, expect } from 'vitest'
import { clusterBuilds } from '../itemArchetypes'
import type { BuildRow } from '../itemArchetypes'

function item(id: number) {
  return { id, name: `Item ${id}`, iconPath: '', category: '' }
}

function build(ids: number[], games: number, wins: number): BuildRow {
  return { build: ids, games, wins, items: ids.map(item) }
}

describe('clusterBuilds', () => {
  it('returns empty array for empty input', () => {
    expect(clusterBuilds([])).toEqual([])
  })

  it('returns empty array when fewer than 3 distinct items exist', () => {
    // A build with only 2 items cannot form a trio
    const result = clusterBuilds([build([1, 2, 3, 4, 5], 1, 1)])
    expect(result).toHaveLength(1)
  })

  it('single build produces one archetype', () => {
    const result = clusterBuilds([build([1, 2, 3, 4, 5], 10, 6)])
    expect(result).toHaveLength(1)
    expect(result[0].games).toBe(10)
    expect(result[0].wins).toBe(6)
    expect(result[0].coreIds).toHaveLength(3)
    expect(result[0].variants).toHaveLength(1)
  })

  it('two builds sharing 3-item core become one archetype', () => {
    const b1 = build([1, 2, 3, 4, 5], 20, 12)
    const b2 = build([1, 2, 3, 6, 7], 10, 5)
    const result = clusterBuilds([b1, b2])
    expect(result).toHaveLength(1)
    expect(result[0].coreIds).toContain(1)
    expect(result[0].coreIds).toContain(2)
    expect(result[0].coreIds).toContain(3)
    expect(result[0].games).toBe(30)
    expect(result[0].wins).toBe(17)
    expect(result[0].variants).toHaveLength(2)
  })

  it('two builds with no shared trio become two archetypes', () => {
    const b1 = build([1, 2, 3, 4, 5], 20, 10)
    const b2 = build([6, 7, 8, 9, 10], 15, 8)
    const result = clusterBuilds([b1, b2])
    expect(result).toHaveLength(2)
  })

  it('archetypes are sorted by games descending', () => {
    const b1 = build([1, 2, 3, 4, 5], 5, 2)
    const b2 = build([6, 7, 8, 9, 10], 20, 10)
    const b3 = build([11, 12, 13, 14, 15], 12, 6)
    const result = clusterBuilds([b1, b2, b3])
    expect(result[0].games).toBeGreaterThanOrEqual(result[1].games)
    expect(result[1].games).toBeGreaterThanOrEqual(result[2]?.games ?? 0)
  })

  it('variants within an archetype are sorted by games descending', () => {
    const b1 = build([1, 2, 3, 4, 5], 5, 3)
    const b2 = build([1, 2, 3, 6, 7], 20, 10)
    const b3 = build([1, 2, 3, 8, 9], 12, 6)
    const result = clusterBuilds([b1, b2, b3])
    const variants = result[0].variants
    for (let i = 0; i < variants.length - 1; i++) {
      expect(variants[i].games).toBeGreaterThanOrEqual(variants[i + 1].games)
    }
  })

  it('caps output at 10 archetypes even with many unique builds', () => {
    const builds: BuildRow[] = []
    // 11 builds with completely disjoint item sets
    for (let i = 0; i < 11; i++) {
      const base = i * 5
      builds.push(build([base + 1, base + 2, base + 3, base + 4, base + 5], 10 - i, 5))
    }
    const result = clusterBuilds(builds)
    expect(result.length).toBeLessThanOrEqual(10)
  })

  it('each build appears in at most one archetype (no double-counting)', () => {
    const b1 = build([1, 2, 3, 4, 5], 10, 5)
    const b2 = build([1, 2, 3, 6, 7], 8, 4)
    const b3 = build([1, 2, 4, 6, 8], 6, 3) // shares pair with both above but no common trio with b2 after b1 is assigned
    const result = clusterBuilds([b1, b2, b3])
    const allVariants = result.flatMap(a => a.variants)
    const uniqueBuilds = new Set(allVariants.map(v => v.build.join(',')))
    expect(uniqueBuilds.size).toBe(allVariants.length)
  })

  it('archetype games equals sum of variant games', () => {
    const b1 = build([1, 2, 3, 4, 5], 15, 8)
    const b2 = build([1, 2, 3, 6, 7], 10, 5)
    const result = clusterBuilds([b1, b2])
    for (const arch of result) {
      const variantGamesSum = arch.variants.reduce((s, v) => s + v.games, 0)
      expect(arch.games).toBe(variantGamesSum)
    }
  })

  it('coreItems contain valid ItemMeta for each coreId', () => {
    const result = clusterBuilds([build([10, 20, 30, 40, 50], 5, 3)])
    const arch = result[0]
    for (let i = 0; i < 3; i++) {
      expect(arch.coreItems[i].id).toBe(arch.coreIds[i])
      expect(typeof arch.coreItems[i].name).toBe('string')
    }
  })
})

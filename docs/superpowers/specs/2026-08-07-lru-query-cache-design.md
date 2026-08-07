# Design: LRU Read-Through Query Cache

## Context

Several Express routes serve data from pre-computed SQL cache tables (champion stats, augment stats, item builds, item picks, item archetypes, performance percentiles, player list). The SQL tables already avoid expensive full-table scans; the remaining overhead is repeated reads of the same (patch, queueId) combo within a session — e.g., every time the user switches champion in the Items tab, opens the Champions tab, or opens the Performance tab for a different player. An in-memory LRU layer eliminates these redundant Postgres round-trips without changing the schema or DB functions.

---

## Summary of Changes

- **New module:** `src/backend/queryCache.ts` — wraps `lru-cache` v10, exposes `getOrFetch`, `invalidate`, and `invalidatePrefix`.
- **Route changes:** Wrap `getPerformancePercentiles`, global `getChampionStats`, global `getAugmentStats`, `getPlayerStats`, and all item route queries with `cache.getOrFetch(...)`. No other logic changes.
- **Post-sync invalidation:** After each sync, the existing `insertMatches` post-sync hook additionally calls `cache.invalidatePrefix(...)` for affected `(gameVersion, queueId)` pairs.
- **No schema changes.** SQL tables remain the persistent source of truth.

---

## Cache Module

**Location:** `src/backend/queryCache.ts`

**Library:** `lru-cache` v10 (TypeScript-native, supports TTL per entry).

```typescript
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, unknown>({
  max: 200,
  ttl: 30 * 60 * 1000, // 30-minute backstop TTL
})

export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  const value = await fetchFn()
  cache.set(key, value)
  return value
}

export function invalidate(key: string): void {
  cache.delete(key)
}

export function invalidatePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
```

---

## Cache Keys

| Data | Key format |
|------|-----------|
| Champion stats (global) | `champions:{sortedPatchesJoined}:{queueId}` |
| Player list | `players:{sortedPatchesJoined}:{queueId}` |
| Augment stats (global) | `augments:{sortedPatchesJoined}:{queueId}` |
| Performance percentiles | `perf:{puuid}:{sortedPatchesJoined}:{queueId}` |
| Item builds | `item_builds:{championId}:{sortedPatchesJoined}:{sortedAllowedIdsJoined}:{queueId}` |
| Item picks | `item_picks:{championId}:{sortedPatchesJoined}:{queueId}` |
| Item archetypes | `item_archetypes:{championId}:{sortedPatchesJoined}:{queueId}` |

Arrays are sorted and joined with `,` before inclusion in the key. The `allowedIds` list (player-owned items filter for item builds) is also sorted — this is stable within a session since a player's item pool doesn't change between requests.

Per-player routes (`/players/:puuid/stats`, `/players/:puuid/champions`, `/players/:puuid/augments`) are **not** cached — they vary per player and read from pre-computed tables that are already fast.

---

## Route Integration

**`src/backend/routes/stats.ts`** — wrap the DB fetch with `getOrFetch`:

```typescript
const patchKey = (patches: string[] | undefined) => (patches ?? []).slice().sort().join(',')

// Global champion stats  (/champions)
res.json(await getOrFetch(
  `champions:${patchKey(patches)}:${queueId}`,
  () => getChampionStats(undefined, patches, queueId)
))

// Player list  (/players)
res.json(await getOrFetch(
  `players:${patchKey(patches)}:${queueId}`,
  () => getPlayerStats(patches, queueId)
))

// Global augment stats  (/augments, no championId filter)
res.json(await getOrFetch(
  `augments:${patchKey(patches)}:${queueId}`,
  () => getAugmentStats(undefined, undefined, patches, augCache, queueId)
))

// Performance percentiles
const percentiles = await getOrFetch(
  `perf:${puuid}:${patchKey(patches)}:${queueId}`,
  () => getPerformancePercentiles(puuid, patches, queueId)
)

// Item builds
const builds = await getOrFetch(
  `item_builds:${championId}:${patchKey(patches)}:${allowedIds.slice().sort().join(',')}:${queueId}`,
  () => getItemBuilds(championId, patches, allowedIds, queueId)
)

// Item picks
const picks = await getOrFetch(
  `item_picks:${championId}:${patchKey(patches)}:${queueId}`,
  () => getItemPickRates(championId, patches, queueId)
)

// Item archetypes
const archetypes = await getOrFetch(
  `item_archetypes:${championId}:${patchKey(patches)}:${queueId}`,
  () => getOrComputeArchetypes(championId, patches, queueId)
)
```

`getPlayerPerformance` and per-player routes are **not** cached — they read from pre-computed tables that are already fast and their results vary per player.

The `/augments` route with a `championId` filter (per-champion augment breakdown) is also **not** cached — the per-champion result set is less likely to repeat within a session.

---

## Invalidation

**Post-sync** — in `insertMatches` (after the existing `buildPlayerPerformanceCache` calls), call:

```typescript
invalidatePrefix(`champions:`)      // global champion stats may change
invalidatePrefix(`players:`)        // player list and stats may change
invalidatePrefix(`augments:`)       // global augment stats may change
invalidatePrefix(`perf:`)           // all perf percentiles; population may have shifted
invalidatePrefix(`item_builds:`)    // item cache keyed by championId, easier to wipe all
invalidatePrefix(`item_picks:`)
invalidatePrefix(`item_archetypes:`)
```

All prefixes are invalidated globally (not filtered by `gv`/`queueId`) because the invalidation runs only when new games were actually inserted, so the overhead is negligible and the logic stays simple.

**TTL backstop:** 30 minutes. Ensures stale entries don't accumulate if a sync callback is missed.

---

## What Is Not Cached

- `getPlayerPerformance` — fast, player-specific, not worth caching
- Per-player routes (`/players/:puuid/stats`, `/players/:puuid/champions`, `/players/:puuid/augments`) — fast from pre-computed tables, player-specific
- `/augments` with `championId` filter — per-champion result unlikely to repeat within a session
- Any write path

---

## Testing

**New test file:** `src/backend/__tests__/queryCache.test.ts`

No DB required — import the module directly and test cache behavior with mock fetch functions.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOrFetch, invalidate, invalidatePrefix, clearAll } from '../queryCache'

beforeEach(() => clearAll())

describe('getOrFetch', () => {
  it('calls fetchFn on first access', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    const result = await getOrFetch('key1', fetch)
    expect(result).toBe('data')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on second call without re-fetching', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    await getOrFetch('key1', fetch)
    const result = await getOrFetch('key1', fetch)
    expect(result).toBe('data')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches independently for different keys', async () => {
    const fetchA = vi.fn().mockResolvedValue('a')
    const fetchB = vi.fn().mockResolvedValue('b')
    expect(await getOrFetch('keyA', fetchA)).toBe('a')
    expect(await getOrFetch('keyB', fetchB)).toBe('b')
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).toHaveBeenCalledTimes(1)
  })
})

describe('invalidate', () => {
  it('forces re-fetch after invalidation', async () => {
    const fetch = vi.fn().mockResolvedValue('v1')
    await getOrFetch('key1', fetch)
    invalidate('key1')
    fetch.mockResolvedValue('v2')
    const result = await getOrFetch('key1', fetch)
    expect(result).toBe('v2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('invalidatePrefix', () => {
  it('removes all keys matching prefix', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    await getOrFetch('champions:15.12:2400', fetch)
    await getOrFetch('champions:15.11:2400', fetch)
    await getOrFetch('players:15.12:2400', fetch)
    expect(fetch).toHaveBeenCalledTimes(3)

    invalidatePrefix('champions:')
    fetch.mockResolvedValue('fresh')
    await getOrFetch('champions:15.12:2400', fetch)
    await getOrFetch('champions:15.11:2400', fetch)
    await getOrFetch('players:15.12:2400', fetch)   // still cached
    expect(fetch).toHaveBeenCalledTimes(5)          // 3 original + 2 re-fetches
  })
})
```

`clearAll` is an additional export added to `queryCache.ts` for test isolation — calls `cache.clear()`. Not used in production code.

The existing route tests in `src/backend/__tests__/routes.test.ts` cover correctness of the cached routes. No changes to those tests are needed; they continue to pass because `getOrFetch` always returns correct data (cache miss on first call = same behavior as no cache).

---

## Verification

1. `npm test` — all existing tests pass with no regressions; new `queryCache.test.ts` tests pass.
2. Open Items tab, switch between champions — observe no repeated DB queries for same (patch, queueId) in logs.
3. Open Performance tab for multiple players on same patch — second and subsequent players load from cache.
4. Trigger a sync — verify cache is invalidated and next request re-fetches from DB.
5. Wait 30 minutes idle — verify TTL expiry causes next request to re-fetch.

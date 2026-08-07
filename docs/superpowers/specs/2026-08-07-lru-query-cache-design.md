# Design: LRU Read-Through Query Cache

## Context

Several Express routes serve data from pre-computed SQL cache tables (item builds, item picks, item archetypes, performance percentiles). The SQL tables already avoid expensive full-table scans; the remaining overhead is repeated reads of the same (patch, queueId) combo within a session — e.g., every time the user switches champion in the Items tab, or opens the Performance tab for a different player. An in-memory LRU layer eliminates these redundant Postgres round-trips without changing the schema or DB functions.

---

## Summary of Changes

- **New module:** `src/backend/queryCache.ts` — wraps `lru-cache` v10, exposes `getOrFetch`, `invalidate`, and `invalidatePrefix`.
- **Route changes:** Wrap `getPerformancePercentiles` and item route queries with `cache.getOrFetch(...)`. No other logic changes.
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
| Performance percentiles | `perf:{puuid}:{sortedPatchesJoined}:{queueId}` |
| Item builds | `item_builds:{championId}:{sortedPatchesJoined}:{sortedAllowedIdsJoined}:{queueId}` |
| Item picks | `item_picks:{championId}:{sortedPatchesJoined}:{queueId}` |
| Item archetypes | `item_archetypes:{championId}:{patchesKey}:{queueId}` |

Arrays are sorted and joined with `,` before inclusion in the key. The `allowedIds` list (player-owned items filter for item builds) is also sorted — this is stable within a session since a player's item pool doesn't change between requests.

---

## Route Integration

**`src/backend/routes/stats.ts`** — wrap the DB fetch with `getOrFetch`:

```typescript
// Performance percentiles
const percentiles = await getOrFetch(
  `perf:${puuid}:${(patches ?? []).slice().sort().join(',')}:${queueId}`,
  () => getPerformancePercentiles(puuid, patches, queueId)
)

// Item builds
const builds = await getOrFetch(
  `item_builds:${championId}:${(patches ?? []).slice().sort().join(',')}:${allowedIds.slice().sort().join(',')}:${queueId}`,
  () => getItemBuilds(championId, patches, allowedIds, queueId)
)

// Item picks (same pattern, no allowedIds)
const picks = await getOrFetch(
  `item_picks:${championId}:${(patches ?? []).slice().sort().join(',')}:${queueId}`,
  () => getItemPickRates(championId, patches, queueId)
)
```

`getPlayerPerformance` is **not** cached — it is fast (reads `player_champion_stats_cache`, not raw tables) and its result varies per player.

---

## Invalidation

**Post-sync** — in `insertMatches` (after the existing `buildPlayerPerformanceCache` calls), call:

```typescript
invalidatePrefix(`item_builds:${gv}:${qId}`)
invalidatePrefix(`item_picks:${gv}:${qId}`)
invalidatePrefix(`item_archetypes:${gv}:${qId}`)
invalidatePrefix(`perf:`)   // invalidate all perf entries; player list may have changed
```

The performance percentile cache is invalidated globally (all puuids) because a sync may add new players to the population, shifting everyone's rank.

**TTL backstop:** 30 minutes. Ensures stale entries don't accumulate if a sync callback is missed.

---

## What Is Not Cached

- `getPlayerPerformance` — fast, player-specific, not worth caching
- `getPlayerStats`, `getChampionStats`, `getAugmentStats` — already fast from pre-computed tables; no measured pain point
- Any write path

---

## Verification

1. `npm test` — all existing tests pass with no regressions.
2. Open Items tab, switch between champions — observe no repeated DB queries for same (patch, queueId) in logs.
3. Open Performance tab for multiple players on same patch — second and subsequent players load from cache.
4. Trigger a sync — verify cache is invalidated and next request re-fetches from DB.
5. Wait 30 minutes idle — verify TTL expiry causes next request to re-fetch.

# Design: Performance Tab — Percentile Bug and Query Optimization

## Context

Two bugs in the Performance tab:

1. **Percentiles never show** — `getOrFetch` caches `null`. When `getPerformancePercentiles` returns `null` (e.g. on first load before enough games are synced), that null is stored in the LRU cache for 30 minutes. Even after the player population grows past 10 qualifying players, the cached null is served until TTL expires.

2. **Tab loads slowly** — `getPlayerPerformance` runs two expensive raw scans against `participants` on every load:
   - A self-join subquery computing team kills for *all games ever played*, then filtering to the player
   - A join through `participant_augments` for the player's augment picks

   Both are redundant. `player_champion_stats_cache` already stores `total_kills`, `total_assists`, `total_team_kills`, `total_gold`, `total_damage`, `total_duration` per player per champion (added in the performance percentiles feature). `player_augment_stats_cache` stores per-player augment picks. `getPlayerPerformance` was never updated to use them. Additionally, it is not LRU-cached, so every tab load re-runs the expensive queries.

---

## Fix 1: Don't cache null in `getOrFetch`

**File:** `src/backend/queryCache.ts`

```typescript
export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  const value = await fetchFn()
  if (value != null) cache.set(key, value as NonNullable<unknown>)
  return value
}
```

Only non-null results are cached. Null is returned to the caller but not stored, so the next request retries the DB.

---

## Fix 2: Rewrite `getPlayerPerformance` to be cache-only

**File:** `src/backend/db.ts` — `getPlayerPerformance`

**Remove:**
- The `participants` self-join subquery that computes KP% and GPM per champion
- The `participants JOIN participant_augments JOIN matches` query for augment picks

**Replace with:**
- KP%/DPM/GPM computed in-process from `player_champion_stats_cache` rows (already fetched for pool/pick-quality). The columns `total_kills`, `total_assists`, `total_team_kills`, `total_gold`, `total_damage`, `total_duration` are present — use them directly.
- Augment picks read from `player_augment_stats_cache`:

```sql
SELECT "augmentId", SUM(pick_count)::int AS pick_count
FROM player_augment_stats_cache
WHERE puuid = $1 AND "queueId" = $2
  AND ("gameVersion" = ANY($3) OR $3::text[] IS NULL)
GROUP BY "augmentId"
```

The function becomes fully cache-based. Return shape is unchanged. `dpmDelta`/`gpmDelta` are computed the same way as `dpmPct`/`gpmPct` (fractional deltas from expected), since the cache tables store totals rather than pre-computed deltas.

---

## Fix 3: LRU-cache `getPlayerPerformance`

**File:** `src/backend/routes/stats.ts`

Wrap `getPlayerPerformance` with `getOrFetch`:

```typescript
const [perf, percentiles] = await Promise.all([
  getOrFetch(
    `perf_data:${puuid}:${patchKey(patches)}:${queueId}`,
    () => getPlayerPerformance(puuid, championMap, patches, queueId)
  ),
  getOrFetch(
    `perf:${puuid}:${patchKey(patches)}:${queueId}`,
    () => getPerformancePercentiles(puuid, patches, queueId)
  ),
])
```

**File:** `src/backend/db.ts` — `insertMatches` post-sync invalidation block

Add `invalidatePrefix('perf_data:')` alongside the existing invalidation calls.

---

## Tests

**`src/backend/__tests__/queryCache.test.ts`** — new test in `getOrFetch` describe:

```typescript
it('does not cache null — fetchFn is called again on second invocation', async () => {
  const fetch = vi.fn().mockResolvedValue(null)
  await getOrFetch('key1', fetch)
  await getOrFetch('key1', fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
})
```

**`src/backend/__tests__/performance.test.ts`** — new tests verifying behavior is unchanged after the rewrite:

```typescript
it('computes kpDelta from cache tables', async () => {
  await insertMatches(makeGames())
  const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
  expect(Math.abs(result.kpDelta)).toBeLessThan(0.01)
})

it('computes dpmPct and gpmPct from cache tables', async () => {
  await insertMatches(makeGames())
  const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
  expect(Math.abs(result.dpmPct)).toBeLessThan(0.01)
  expect(Math.abs(result.gpmPct)).toBeLessThan(0.01)
})

it('computes augmentPickQuality from player_augment_stats_cache', async () => {
  await insertMatches(makeGames())
  const result = await getPlayerPerformance('p1', championMap, ['15.12'], 2400)
  expect(typeof result.augmentPickQuality).toBe('number')
  expect(Math.abs(result.augmentPickQuality)).toBeLessThan(0.01)
})
```

---

## Verification

1. `npm test` — all tests pass, including new ones
2. Open Performance tab — percentiles show for players with 10+ qualifying players in population
3. Tab loads noticeably faster (no participant self-join)
4. Switch between players — second player loads from LRU cache instantly
5. Trigger a sync — verify `perf_data:` cache invalidates and next load re-fetches

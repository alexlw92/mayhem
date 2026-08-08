# Design: Deferred Elo and Performance Cache Recalculation During Sync

## Context

During an active sync, two expensive operations fire after every player is synced:

1. **`recomputeAffectedElo`** — called in `syncWorker` (`src/main/index.ts`) with all participants from the synced player's games (~200 PUUIDs). Triggers `Promise.all` of ~400 concurrent `recomputePlayerElo` DB calls. Most return 0 immediately (nothing to do), but firing ~400 concurrent DB queries per player sync creates significant connection pressure when hundreds of players are being synced.

2. **`buildPlayerPerformanceCache`** — called fire-and-forget inside `insertMatches` (`src/backend/db.ts`) once per batch. Runs two full-table aggregation queries over all player stats for a `(gameVersion, queueId)` pair. A 50-game sync (5 batches, all same patch/queue) triggers this 5 times for the same pair — each run aggregates the entire table.

The result: DB is competing with itself — sync writes contending with aggregation reads from background recalcs.

Note: champion, augment, player, and player-champion stats caches are all updated **incrementally inside the transaction** via `INSERT ... ON CONFLICT DO UPDATE SET col = table.col + EXCLUDED.col`. They scale with the number of new games, not total DB size, and need no deferral.

---

## Design

### Part 1 — Elo: recalc current player only

**File:** `src/main/index.ts` — `syncWorker`

Replace:
```typescript
apiClient.recomputeAffectedElo(affectedPuuids).catch(() => {})
```
with:
```typescript
await apiClient.recomputeAffectedElo([puuid]).catch(() => {})
```

One PUUID instead of ~200. The existing `/api/players/elo/recompute-affected` endpoint already handles a single-element array — no new routes needed. We await it (2 incremental DB calls, fast for a freshly-synced player whose games were just inserted) before claiming the next job.

Opponents' Elo stays as-is until their own sync turn. This is acceptable: until a player is individually synced, their Elo is based on incomplete game history anyway.

---

### Part 2 — Performance cache: immediate DELETE, deferred rebuild

**File:** `src/backend/db.ts`

Add a module-level dirty set and two functions:

```typescript
const dirtyPerfPairs = new Set<string>()

export function markPerfDirty(gameVersion: string, queueId: number): void {
  dirtyPerfPairs.add(`${gameVersion}:${queueId}`)
}

export async function flushDirtyPerfCache(): Promise<void> {
  if (dirtyPerfPairs.size === 0) return
  const pairs = [...dirtyPerfPairs]
  dirtyPerfPairs.clear()
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':')
    const gv = pair.slice(0, colonIdx)
    const qId = Number(pair.slice(colonIdx + 1))
    try {
      await buildPlayerPerformanceCache(gv, qId)
    } catch (err) {
      console.error('[flushDirtyPerfCache] failed:', gv, qId, err)
    }
  }
}
```

In `insertMatches`, replace the current fire-and-forget IIFE with an immediate DELETE per pair followed by marking it dirty:

```typescript
for (const pair of pairs) {
  const colonIdx = pair.indexOf(':')
  const gv = pair.slice(0, colonIdx)
  const qId = Number(pair.slice(colonIdx + 1))
  await sql_`DELETE FROM player_performance_cache WHERE "gameVersion" = ${gv} AND "queueId" = ${qId}`
  markPerfDirty(gv, qId)
}
```

The DELETE fires immediately so the cache entry is absent. If the server is killed before `flushDirtyPerfCache` runs, the entry stays absent on next startup — and the existing startup backfill in `initDb` already detects missing `(gv, queueId)` pairs and rebuilds them. The rebuild is what's deferred, not the invalidation.

**File:** `src/backend/server-entry.ts`

Import `flushDirtyPerfCache` from `./db` and add inside the existing `.listen` callback (alongside `backfillDetailCaches` and `refreshMetadata`):

```typescript
setInterval(() => { flushDirtyPerfCache().catch(console.error) }, 60_000)
```

---

## Net Effect

| | Before | After |
|---|---|---|
| Elo calls per player sync | ~400 concurrent fire-and-forget | 2 sequential awaited |
| Perf cache rebuilds for 50-game sync | 5× same pair, fire-and-forget | 0 immediate, 1 deferred (≤60s) |
| DB contention during sync | High (writes + aggregation reads competing) | Low (writes only during active sync) |
| Crash recovery | n/a | Startup backfill covers missing pairs |

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/index.ts` | Pass `[puuid]` instead of `affectedPuuids` to `recomputeAffectedElo`; await it |
| `src/backend/db.ts` | Add `dirtyPerfPairs` Set, `markPerfDirty()`, `flushDirtyPerfCache()`; `insertMatches` DELETEs immediately and calls `markPerfDirty` instead of fire-and-forget IIFE |
| `src/backend/server-entry.ts` | Import `flushDirtyPerfCache`; add `setInterval` inside `.listen` callback |

---

## Verification

1. Start a sync — confirm `POST /api/matches/bulk` completes quickly with no perf cache rebuilds during sync (check console: no `[flushDirtyPerfCache]` lines while sync is running)
2. Wait ~60s after sync — confirm Performance tab still shows correct data (flush ran)
3. Confirm Elo updates for the synced player immediately after each sync job completes
4. Confirm `recompute-affected` is called with a single PUUID per player sync (check pino log)
5. Kill the server mid-sync, restart — confirm startup backfill rebuilds the missing performance cache entries
6. Run `npm test` — all tests pass

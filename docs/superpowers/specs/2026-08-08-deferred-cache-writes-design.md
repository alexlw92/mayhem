# Design: Deferred Cache Writes + Startup Warmup

**Date:** 2026-08-08

## Goal

Reduce `POST /api/matches/bulk` from P50 7.5s to ~200ms. Make all GET routes return under 1000ms (and under 10ms after warmup) by ensuring cache tables are populated before the first user request.

---

## Problem

`insertMatches` does too much synchronous work before returning. In one transaction it:
1. Inserts raw data (matches, participants, augments, items, item_sets)
2. Runs a C(n,5) LATERAL unnest Cartesian product → `item_builds_cache` (expensive)
3. UPSERTs 6 more cache tables (player, champion, augment stats — cheap but cumulative)
4. Marks `item_archetypes_cache` rows stale

GET routes are slow on cold LRU because:
- Cache tables (`player_stats_cache`, etc.) have no index on `"queueId"` — only on the compound PK `("gameVersion","queueId",puuid)`. `WHERE "queueId" = X` does a full table scan.
- `GET /api/items/summary` → `_computeArchetypes` runs N synchronous queries on `participant_item_sets` per archetype cluster (N × 1-3s = 27s P50).

---

## Design

### Part 1: `pending_cache_games` table

New DDL in `initDb`:

```sql
CREATE TABLE IF NOT EXISTS pending_cache_games (
  game_id BIGINT PRIMARY KEY
)
```

No data columns needed — the background flush re-derives everything from the raw tables.

---

### Part 2: `insertMatches` — shrink to raw data only

The transaction keeps only:
1. `INSERT INTO matches` (returning new gameIds)
2. `INSERT INTO participants`
3. `INSERT INTO participant_augments`
4. `INSERT INTO participant_items`
5. `INSERT INTO participant_item_sets` (kept: cheap `array_agg`, needed for GIN archetype queries)
6. `INSERT INTO pending_cache_games` (new game IDs)

After the transaction: `enqueueAll(puuids)` (unchanged — sync workers need it immediately).

**Removed from `insertMatches`:**
- All cache table UPSERTs (`player_stats_cache`, `champion_stats_cache`, `augment_stats_cache`, `player_champion_stats_cache`, `augment_champion_stats_cache`, `player_augment_stats_cache`)
- `item_builds_cache` C(n,5) expansion
- `item_picks_cache` UPSERT
- `item_archetypes_cache` stale-timestamp update
- `invalidatePrefix` calls
- `DELETE FROM player_performance_cache` + `markPerfDirty`

**LRU invalidation note:** `invalidatePrefix` must NOT run at insert time. Cache tables haven't been updated yet, so clearing the LRU would cause the next GET to cache stale DB data for 30 minutes. Invalidation moves into `flushPendingCaches`, after UPSERTs complete.

---

### Part 3: `flushPendingCaches()` — new export from `db.ts`

```ts
export async function flushPendingCaches(): Promise<void>
```

Steps:

1. **Claim a batch:** `SELECT game_id FROM pending_cache_games LIMIT 500` — return early if empty.

2. **Run all cache UPSERTs** using pure SQL aggregation (joining `participants` + `matches` + `participant_items` + `participant_augments` WHERE `gameId = ANY(batch)`):

   - `player_stats_cache` — GROUP BY gameVersion, queueId, puuid
   - `player_champion_stats_cache` — GROUP BY gameVersion, queueId, puuid, championId
   - `champion_stats_cache` — GROUP BY gameVersion, queueId, championId
   - `augment_stats_cache` — GROUP BY gameVersion, queueId, augmentId
   - `augment_champion_stats_cache` — GROUP BY gameVersion, queueId, augmentId, championId
   - `player_augment_stats_cache` — GROUP BY gameVersion, queueId, puuid, augmentId
   - `item_builds_cache` — same C(n,5) LATERAL unnest SQL, filtered to batch gameIds
   - `item_picks_cache` — same aggregation SQL, filtered to batch gameIds
   - `item_archetypes_cache` — `UPDATE ... SET computed_at = NOW() - INTERVAL '16 minutes'` for affected championIds

3. **Recompute archetypes for current patch:**
   ```ts
   const currentPatch = maxGameVersion(batch)  // derived from matches in batch
   const affectedChampIds = [...new Set(/* from participants in batch */)]
   for (const queueId of [2400, 2450]) {
     await Promise.all(affectedChampIds.map(id =>
       getOrComputeArchetypes(id, [currentPatch], queueId).catch(console.error)
     ))
   }
   ```
   `getOrComputeArchetypes` writes to the DB-persisted `item_archetypes_cache`. Subsequent `GET /api/items/summary` requests return immediately from that table — the 27s computation never blocks an HTTP request.

4. **Invalidate LRU** (after UPSERTs, so fresh data gets cached):
   ```ts
   invalidatePrefix('champions:')
   invalidatePrefix('players:')
   invalidatePrefix('augments:')
   invalidatePrefix('perf:')
   invalidatePrefix('perf_data:')
   invalidatePrefix('item_builds:')
   invalidatePrefix('item_picks:')
   invalidatePrefix('item_archetypes:')
   ```

5. **Invalidate player_performance_cache** for affected (gameVersion, queueId) pairs:
   ```ts
   await sql_`DELETE FROM player_performance_cache WHERE "gameVersion" = ANY(${affectedVersions}) AND "queueId" = ANY(${affectedQueues})`
   markPerfDirty(gv, qId)  // per pair
   ```

6. **Remove from pending table:**
   ```ts
   await sql_`DELETE FROM pending_cache_games WHERE game_id = ANY(${batch})`
   ```

**Crash recovery:** `pending_cache_games` rows survive restart. On next startup, `flushPendingCaches()` picks them up automatically — no gap detection needed.

---

### Part 4: `warmLruCaches()` — new function in `server-entry.ts`

Runs after `flushPendingCaches()` on startup (sequential — warm with fresh data):

```ts
async function warmLruCaches() {
  const patches = await getPatches()
  const latestPatch = patches[0] ?? null
  const augCache = augRef.value
  await Promise.all([
    getOrFetch('players::2400', () => getPlayerStats(undefined, 2400)),
    getOrFetch('players::2450', () => getPlayerStats(undefined, 2450)),
    getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400)),
    getOrFetch('champions::2450', () => getChampionStats(undefined, undefined, 2450)),
    ...(latestPatch ? [
      getOrFetch(`augments:${latestPatch}:2400`, () => getAugmentStats(undefined, undefined, [latestPatch], augCache, 2400)),
      getOrFetch(`augments:${latestPatch}:2450`, () => getAugmentStats(undefined, undefined, [latestPatch], augCache, 2450)),
    ] : []),
  ])
}
```

Items/summary is champion-specific — too many combinations to pre-warm. But since archetypes are pre-computed by `flushPendingCaches` into `item_archetypes_cache`, the first HTTP request returns immediately.

---

### Part 5: `server-entry.ts` wiring

In the `.listen` callback, after existing startup calls:

```ts
flushPendingCaches()
  .then(() => warmLruCaches())
  .catch(err => console.warn('[cache] startup warmup failed:', (err as Error).message))
setInterval(() => { flushPendingCaches().catch(console.error) }, 30_000)
```

Import additions: `flushPendingCaches`, `warmLruCaches` (or keep warmLruCaches local to server-entry.ts).

---

### Part 6: DB indexes in `initDb`

Add alongside existing indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_player_stats_cache_queueId           ON player_stats_cache ("queueId")
CREATE INDEX IF NOT EXISTS idx_player_champion_stats_cache_queueId  ON player_champion_stats_cache ("queueId")
CREATE INDEX IF NOT EXISTS idx_champion_stats_cache_queueId         ON champion_stats_cache ("queueId")
CREATE INDEX IF NOT EXISTS idx_augment_stats_cache_queueId          ON augment_stats_cache ("queueId")
CREATE INDEX IF NOT EXISTS idx_augment_champion_stats_cache_queueId ON augment_champion_stats_cache ("queueId")
CREATE INDEX IF NOT EXISTS idx_pending_cache_games_game_id          (covered by PRIMARY KEY)
```

Fixes `WHERE "queueId" = X` full-table-scan on all cache tables. Primary beneficiary: `GET /api/players` (P50 15.8s → <100ms cold, <10ms warm).

---

## Files Changed

| File | Change |
|---|---|
| `src/backend/db.ts` | Add `pending_cache_games` DDL; add 5 queueId indexes; shrink `insertMatches`; add `flushPendingCaches()` export |
| `src/backend/server-entry.ts` | Import `flushPendingCaches`; add `warmLruCaches`; wire startup + 30s interval |

---

## Expected Outcomes

| Route | Before | After |
|---|---|---|
| `POST /api/matches/bulk` | P50 7.5s | ~200ms |
| `GET /api/players` | P50 15.8s | <10ms (LRU warm) / <100ms (cold + index) |
| `GET /api/items/summary` | P50 27.5s | <50ms (archetype pre-computed in background) |
| `GET /api/augments` | P95 2.2s | <10ms (LRU warm) / <100ms (cold + index) |
| `GET /api/champions` | P50 506ms | <10ms (LRU warm) / <50ms (cold + index) |
| `POST /api/players/elo/recompute-affected` | P50 6.6s | ~100ms (fixed 2026-08-08) |

---

## What Stays Slow

- `GET /api/players/:puuid/coplayers` (P95 2.1s): raw participant×participant join, no cache. Not addressed here.
- `GET /api/sync/next` / `GET /api/sync/queue` (P95 2-3.7s): likely connection-pool cold-start on first request, not query performance.

# Performance Architecture Design

**Date:** 2026-08-11
**Status:** Approved

---

## Goal

Reduce the worst-case API response time for aggregated stats endpoints from 15s+ down to <1s under steady-state conditions, while also eliminating the cold-start problem where every server deploy causes the first requests to time out.

---

## Context

The current architecture maintains aggregated stats through an incremental cache system: when matches are inserted, a `pending_cache_games` table queues the affected game IDs, and a background flush process (`flushPendingCaches`) reads those rows and updates six cache tables. This works but has several pain points:

1. **Cold LRU**: The in-process LRU cache (30-min TTL) is wiped on every server restart/deploy, so the first requests after any deploy run the expensive DB queries and routinely time out.
2. **Slow per-player routes**: Several per-player endpoints (champions, matches, augments, coplayers) bypass `getOrFetch` entirely and hit the DB on every request.
3. **Flush complexity and deadlock risk**: The incremental flush pipeline has ~8 functions tracking dirty state, pending games, and perf pairs. Two concurrent flush calls deadlocked in production (`augment_champion_stats_cache`, 40P01). A concurrency guard was patched in, but the underlying complexity remains.
4. **No performance observability**: There is no way to measure how long the refresh cycle takes or confirm query performance after changes.

---

## Scope

Three independent improvements, all on the backend:

- **A: LRU disk persistence** — survive server restarts without cold-start penalty
- **B: PostgreSQL MATERIALIZED VIEWs** — replace the incremental flush pipeline with SQL-native aggregation
- **C: Cache uncached per-player routes** — extend `getOrFetch` to the remaining slow routes
- **D: Performance test infrastructure** — `vitest bench` suite + matview timing in `/api/metrics`

Item caches (`item_stats_cache`, `item_meta`) are excluded — they are maintained by different code paths and are not causing latency problems.

---

## A: LRU Disk Persistence

### Motivation

Every deploy clears the in-process LRU. The first `/api/players` or `/api/champions` request after a restart runs the full DB aggregation (15s+) rather than returning the cached result. Disk persistence lets the server restore a warm cache on startup.

### Design

**`src/backend/queryCache.ts`** — add `initLruPersistence(filePath: string): void`

- On init: attempt to read the file; for each entry in the dump, check its TTL — only load entries where `ttl > Date.now()` (2-hour hard cap regardless of remaining TTL, to prevent serving very stale data after a long server outage).
- Save: `cache.dump()` written to `filePath` atomically (write to `.tmp`, then rename) every 60 seconds via `setInterval`, and synchronously on `process.on('exit')`.
- The `lru-cache` library's `dump()` method returns entries with their absolute expiry times, so TTL is preserved exactly.

**`src/backend/server-entry.ts`** — call `initLruPersistence` alongside `initMetricsPersistence`:

```typescript
const logFile = process.env.MAYHEM_LOG_FILE
if (logFile) {
  initMetricsPersistence(logFile.replace(/\.log$/, '-metrics.json'))
  initLruPersistence(logFile.replace(/\.log$/, '-lru-cache.json'))
}
```

**Freshness gate**: Any entry older than 2 hours at load time is skipped. This prevents the server from serving data that is many hours stale after a prolonged outage.

**Failure modes**: If the file is missing, corrupt, or unreadable, `initLruPersistence` logs a warning and starts with an empty cache. It never throws.

### What this does NOT change

- TTL behavior during normal operation is unchanged.
- `invalidate` and `invalidatePrefix` continue to work as before.
- The `inFlight` request-coalescing Map is not persisted (it is transient by definition).

---

## B: PostgreSQL MATERIALIZED VIEWs

### Motivation

The incremental flush pipeline (8+ functions, `pending_cache_games` table, dirty-pair tracking, backfill on startup) is complex, deadlock-prone, and hard to reason about. PostgreSQL MATERIALIZED VIEWs let the DB engine own the aggregation using the same SQL queries that were already hand-written, with `REFRESH MATERIALIZED VIEW CONCURRENTLY` providing non-blocking reads during refresh.

### Matviews replacing the six cache tables

| Old cache table | New matview name |
|---|---|
| `player_stats_cache` | `mv_player_stats` |
| `champion_stats_cache` | `mv_champion_stats` |
| `augment_stats_cache` | `mv_augment_stats` |
| `player_champion_stats_cache` | `mv_player_champion_stats` |
| `player_augment_stats_cache` | `mv_player_augment_stats` |
| `augment_champion_stats_cache` | `mv_augment_champion_stats` |

Each matview is defined with `AS SELECT ... FROM matches JOIN participants ...` — the same aggregation logic currently in the flush functions, moved into SQL DDL.

Each matview gets a UNIQUE index on its natural primary key (required for `REFRESH CONCURRENTLY`). Reads from matviews use the same column names as the current cache tables so that query code above the DB layer is unchanged.

### Refresh pipeline

**`refreshAllMatviews()`** in `db.ts`:

```typescript
async function refreshAllMatviews(): Promise<void> {
  const start = Date.now()
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_stats`
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_champion_stats`
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_augment_stats`
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_champion_stats`
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_augment_stats`
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_augment_champion_stats`
  await rebuildPerformanceCache()  // depends on mv_player_champion_stats + mv_player_augment_stats
  lastRefreshMs = Date.now() - start
}
```

Refreshes run sequentially (each view depends on the same base tables, but sequential avoids contention on the single-vCPU RDS). `rebuildPerformanceCache` (replacement for `flushDirtyPerfCache`) runs at the end of each cycle as it reads from the other matviews.

**Trigger**: Called fire-and-forget from `insertMatches` after the transaction commits:

```typescript
refreshAllMatviews().catch(err => console.warn('[matview] refresh failed:', err.message))
```

There is no periodic background interval for matview refresh — refresh only runs when new data arrives. If the server is idle, the matviews are already fresh. If the server restarts, the matviews already reflect all committed data (matviews are stored in the DB, not in process).

**Freshness**: Under normal match-import load, matviews will be refreshed within 30–60 seconds of any match insertion. The first request after a cold server start will read from the matviews (always fresh) rather than running inline aggregation.

### Deletions

**Code deleted from `db.ts`:**
- `pending_cache_games` table and all code that touches it
- `flushPendingCaches` / `_flushPendingCaches` / `_flushRunning`
- `backfillDetailCaches`
- `markPerfDirty` / `flushDirtyPerfCache` / `dirtyPerfPairs`
- `rebuildMissingPerfPairs`

**Code deleted from `server-entry.ts`:**
- `setInterval(() => { flushPendingCaches() }, 30_000)`
- `flushDirtyPerfCache` interval
- `backfillDetailCaches(sendProgress)` in the 90s startup timeout
- `rebuildMissingPerfPairs()` in the 90s startup timeout
- The 90s startup timeout entirely (nothing expensive to defer anymore)

`flushPendingCaches` export is removed from `db.ts` and any imports in other files.

### Historical data and matviews

The application already prunes raw participant data after 4 patches. Matviews reflect only what is in the base tables — stats for deleted matches will not appear. This is the desired behavior (confirmed by user).

### Schema migration

A migration adds the matviews and their UNIQUE indexes, and drops the six old cache tables and the `pending_cache_games` table. The migration runs as part of `initDb`.

---

## C: Cache Uncached Per-Player Routes

### Affected routes in `src/backend/routes/stats.ts`

| Route | Current | Change |
|---|---|---|
| `GET /players/:puuid/champions` | No cache | `getOrFetch('champ_player:{puuid}:{patches}:{queueId}', ...)` |
| `GET /players/:puuid/matches` | No cache | `getOrFetch('matches_player:{puuid}:{patches}:{queueId}:{limit}', ...)` |
| `GET /players/:puuid/augments` | No cache | `getOrFetch('aug_player:{puuid}:{patches}:{queueId}', ...)` |
| `GET /players/:puuid/coplayers` | No cache | `getOrFetch('coplayers:{puuid}:{patches}:{queueId}', ...)` |
| `GET /sync/queue` | No cache | `getOrFetch('sync_queue', ..., ttl: 10_000)` |

TTL for per-player routes: 30 minutes (inherits LRU default).
TTL for `sync/queue`: 10 seconds (high-frequency poll, short-lived freshness acceptable).

**`getOrFetch` TTL override**: Add an optional `ttl` parameter to `getOrFetch`:

```typescript
export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>, ttl?: number): Promise<T>
```

When `ttl` is provided, pass it to `cache.set(key, value, { ttl })`. This is used only for `sync/queue`; all other callers use the default 30-min TTL.

### Cache invalidation

After `insertMatches`, invalidate affected per-player cache entries using the existing `invalidatePrefix` helper:

```typescript
for (const puuid of affectedPuuids) {
  invalidatePrefix(`champ_player:${puuid}:`)
  invalidatePrefix(`matches_player:${puuid}:`)
  invalidatePrefix(`aug_player:${puuid}:`)
  invalidatePrefix(`coplayers:${puuid}:`)
}
```

`affectedPuuids` is already available in `insertMatches` (the set of puuids from the inserted matches).

---

## D: Performance Test Infrastructure

### Vitest bench suite

**File:** `src/backend/__tests__/perf.bench.ts`

Uses Vitest's native `bench()` primitive. Run with `npm run bench` (separate script, not part of `npm test`).

`package.json` addition:
```json
"bench": "vitest bench src/backend/__tests__/perf.bench.ts"
```

**Benchmarks:**

```typescript
bench('getPlayerStats (cache warm)', async () => {
  await getOrFetch('players::2400', () => getPlayerStats(undefined, 2400))
})

bench('getPlayerStats (cache cold)', async () => {
  invalidate('players::2400')
  await getOrFetch('players::2400', () => getPlayerStats(undefined, 2400))
}, { time: 10_000 })

bench('getChampionStats (cache warm)', async () => {
  await getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400))
})
```

Expected baselines (post-matview):
- Cache warm: <5ms
- Cache cold (matview read): <500ms

### Matview refresh timing in `/api/metrics`

**`src/backend/db.ts`**: export `getLastRefreshMs(): number` reading the module-level `lastRefreshMs` variable.

**`src/backend/metrics.ts`** or **`src/backend/routes/meta.ts`**: expose `lastRefreshMs` as a field in the `/api/metrics` response:

```typescript
{
  uptime: ...,
  totalRequests: ...,
  matviewLastRefreshMs: getLastRefreshMs(),  // -1 if never refreshed since start
  routes: [...]
}
```

This gives operators a visible signal that the matview refresh pipeline is running and how long it takes.

---

## Migration Path

The changes can be deployed as a single release since the matviews read from the same base tables (`matches`, `participants`, etc.) that already exist. The migration will:

1. Create the 6 matviews with UNIQUE indexes
2. Run an initial `REFRESH MATERIALIZED VIEW` for each (synchronous, before server starts accepting traffic)
3. Drop the 6 old cache tables and `pending_cache_games`

The initial refresh on a full dataset may take a few minutes. This is acceptable during a planned deploy.

---

## Out of Scope

- Redis or any additional infrastructure
- RDS instance upgrade
- `item_stats_cache` / `item_meta` (not causing latency problems)
- Frontend changes

---

## Success Criteria

1. `GET /api/players` and `GET /api/champions` respond in <1s under steady state (LRU warm)
2. After server restart, first request still responds in <1s (LRU restored from disk)
3. Per-player champion/match/augment/coplayer routes respond in <1s after first access
4. `npm run bench` passes with warm-cache results <5ms
5. `/api/metrics` shows `matviewLastRefreshMs` updating after each match import
6. No `pending_cache_games` table in schema; no `flushPendingCaches` call in codebase

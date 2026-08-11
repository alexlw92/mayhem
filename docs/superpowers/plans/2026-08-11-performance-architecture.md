# Performance Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cold-start latency and 15s+ API responses by adding LRU disk persistence, replacing the incremental flush pipeline with PostgreSQL materialized views, and caching uncached per-player routes.

**Architecture:** LRU cache survives server restarts via disk dump/load. Six cache tables (player_stats, champion_stats, augment_stats, player_champion_stats, player_augment_stats, augment_champion_stats) become PostgreSQL MATERIALIZED VIEWs refreshed concurrently after each `insertMatches`. The entire incremental flush pipeline (pending_cache_games, flushPendingCaches, flushDirtyPerfCache, rebuildMissingPerfPairs, backfillDetailCaches) is deleted. Per-player routes that previously hit the DB on every request are wrapped in `getOrFetch`.

**Tech Stack:** `lru-cache` v11 (already installed, `dump()`/`load()` API), PostgreSQL MATERIALIZED VIEW + REFRESH CONCURRENTLY, Vitest bench (`vitest bench --run`), existing `getOrFetch` / `invalidatePrefix` in `queryCache.ts`.

---

## File Map

| File | Change |
|---|---|
| `src/backend/queryCache.ts` | Add optional `ttl` param to `getOrFetch`, add `initLruPersistence` |
| `src/backend/server-entry.ts` | Call `initLruPersistence`, remove flush intervals, remove 90s startup timeout |
| `src/backend/routes/stats.ts` | Wrap 4 per-player routes in `getOrFetch` |
| `src/backend/routes/sync.ts` | Wrap `GET /sync/queue` in `getOrFetch` with 10s TTL |
| `src/backend/db.ts` | Add matview DDL + migration, add `refreshAllMatviews`, add `getLastRefreshMs`, delete flush/dirty/backfill machinery, update `insertMatches` |
| `src/backend/metrics.ts` | Add `matviewLastRefreshMs` to `MetricsSnapshot` and `getMetrics()` |
| `src/backend/__tests__/queryCache.test.ts` | Add persistence tests |
| `src/backend/__tests__/performance.test.ts` | Replace `flushPendingCaches` calls with `refreshAllMatviews`, update truncate, remove deleted-function tests |
| `src/backend/__tests__/perf.bench.ts` | Create vitest bench suite |
| `package.json` | Add `"bench"` script |

---

## Task 1: LRU Disk Persistence

**Files:**
- Modify: `src/backend/queryCache.ts`
- Modify: `src/backend/server-entry.ts`
- Modify: `src/backend/__tests__/queryCache.test.ts`

### Background

`queryCache.ts` uses `lru-cache` with a 30-minute TTL. Every server restart clears the cache. `lru-cache` v10+ has `dump()` (returns `[key, LRUCache.Entry<V>][]` preserving TTL info) and `load()` (restores entries with their TTL state). We add `initLruPersistence(filePath)` that loads the dump on startup (skipping entries older than 2 hours) and saves the dump every 60s.

- [ ] **Step 1: Add `ttl` param to `getOrFetch` and add `initLruPersistence` in `queryCache.ts`**

Open `src/backend/queryCache.ts`. Replace the entire file contents with:

```typescript
import fs from 'node:fs'
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, NonNullable<unknown>>({
  max: 200,
  ttl: 30 * 60 * 1000,
})

const inFlight = new Map<string, Promise<unknown>>()

export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>, ttl?: number): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  if (inFlight.has(key)) return inFlight.get(key) as Promise<T>
  const promise = Promise.resolve().then(() => fetchFn()).then(value => {
    inFlight.delete(key)
    if (value != null) cache.set(key, value as NonNullable<unknown>, ttl ? { ttl } : undefined)
    return value
  }).catch(err => {
    inFlight.delete(key)
    throw err
  })
  inFlight.set(key, promise)
  return promise as Promise<T>
}

export function invalidate(key: string): void {
  cache.delete(key)
}

export function invalidatePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

export function clearAll(): void {
  cache.clear()
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

export function initLruPersistence(filePath: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const entries: [string, LRUCache.Entry<NonNullable<unknown>>][] = JSON.parse(raw)
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (entry.start && now - entry.start > TWO_HOURS_MS) continue
      cache.load([[key, entry]])
    }
    console.log(`[cache] restored ${cache.size} LRU entries from ${filePath}`)
  } catch { /* no file or corrupt — start fresh */ }

  const save = () => {
    try {
      const tmp = filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(cache.dump()))
      fs.renameSync(tmp, filePath)
    } catch (err) {
      console.warn('[cache] LRU save failed:', (err as Error).message)
    }
  }

  setInterval(save, 60_000)
  process.on('exit', save)
}
```

- [ ] **Step 2: Wire `initLruPersistence` in `server-entry.ts`**

In `src/backend/server-entry.ts`, find this block near the bottom of the `listen` callback (around line 138):

```typescript
    const logFile = process.env.MAYHEM_LOG_FILE
    if (logFile) initMetricsPersistence(logFile.replace(/\.log$/, '-metrics.json'))
```

Add the import and the call:

At the top of the file, `initLruPersistence` should be imported from `./queryCache`. Add it to the existing import line:

```typescript
import { getOrFetch } from './queryCache'
```
→
```typescript
import { getOrFetch, initLruPersistence } from './queryCache'
```

Then update the logFile block:

```typescript
    const logFile = process.env.MAYHEM_LOG_FILE
    if (logFile) {
      initMetricsPersistence(logFile.replace(/\.log$/, '-metrics.json'))
      initLruPersistence(logFile.replace(/\.log$/, '-lru-cache.json'))
    }
```

- [ ] **Step 3: Write failing tests for `initLruPersistence`**

Open `src/backend/__tests__/queryCache.test.ts`. Add at the top:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getOrFetch, invalidate, invalidatePrefix, clearAll, initLruPersistence } from '../queryCache'
```

(Replace the existing import line, adding `afterEach` and `initLruPersistence`.)

Then add a new describe block at the end of the file:

```typescript
describe('initLruPersistence', () => {
  let tmpFile: string

  beforeEach(() => {
    clearAll()
    tmpFile = path.join(os.tmpdir(), `lru-test-${Date.now()}.json`)
  })

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ok */ }
    try { fs.unlinkSync(tmpFile + '.tmp') } catch { /* ok */ }
  })

  it('restores entries from disk on load', async () => {
    const fetch = vi.fn().mockResolvedValue('persisted')
    await getOrFetch('persist-key', fetch)

    initLruPersistence(tmpFile)
    // trigger save via private interval — access dump directly
    fs.writeFileSync(tmpFile, JSON.stringify((cache as any).dump()))

    clearAll()
    initLruPersistence(tmpFile)
    const fetch2 = vi.fn().mockResolvedValue('should-not-be-called')
    const result = await getOrFetch('persist-key', fetch2)
    expect(result).toBe('persisted')
    expect(fetch2).not.toHaveBeenCalled()
  })

  it('skips entries older than 2 hours', async () => {
    const staleEntry = { value: 'stale', start: Date.now() - 3 * 60 * 60 * 1000, ttl: 30 * 60 * 1000 }
    fs.writeFileSync(tmpFile, JSON.stringify([['stale-key', staleEntry]]))

    clearAll()
    initLruPersistence(tmpFile)
    const fetch = vi.fn().mockResolvedValue('fresh')
    const result = await getOrFetch('stale-key', fetch)
    expect(result).toBe('fresh')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('starts fresh when file is missing', () => {
    expect(() => initLruPersistence('/nonexistent/path/lru.json')).not.toThrow()
  })
})
```

**Note:** The test for "restores entries from disk" directly writes the dump to skip the 60s interval. The `cache` object isn't exported, so this test needs a slightly different approach — instead of testing the internal save mechanism, test the load behavior by writing a valid dump manually.

Replace that first test with one that writes a known-good dump:

```typescript
  it('restores entries from disk on load', async () => {
    const fetch = vi.fn().mockResolvedValue('persisted')
    await getOrFetch('persist-key', fetch)

    // Manually dump current cache to file (simulating what save() does)
    const { LRUCache } = await import('lru-cache')
    const tempCache = new LRUCache<string, unknown>({ max: 200, ttl: 30 * 60 * 1000 })
    tempCache.set('persist-key', 'persisted')
    fs.writeFileSync(tmpFile, JSON.stringify(tempCache.dump()))

    clearAll()
    initLruPersistence(tmpFile)
    const fetch2 = vi.fn().mockResolvedValue('should-not-be-called')
    const result = await getOrFetch('persist-key', fetch2)
    expect(result).toBe('persisted')
    expect(fetch2).not.toHaveBeenCalled()
  })
```

- [ ] **Step 4: Run tests to verify they fail**

```
npx vitest run src/backend/__tests__/queryCache.test.ts
```

Expected: the new describe block's tests fail with "initLruPersistence is not a function" or import errors.

- [ ] **Step 5: Run tests to verify they pass**

The implementation was already written in Step 1. Run:

```
npx vitest run src/backend/__tests__/queryCache.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```
git add src/backend/queryCache.ts src/backend/server-entry.ts src/backend/__tests__/queryCache.test.ts
git commit -m "feat: add LRU disk persistence and per-call TTL to getOrFetch"
```

---

## Task 2: Cache Uncached Per-Player Routes

**Files:**
- Modify: `src/backend/routes/stats.ts`
- Modify: `src/backend/routes/sync.ts`
- Modify: `src/backend/db.ts` (add per-puuid invalidation to `insertMatches`)

### Background

Four per-player routes in `stats.ts` bypass `getOrFetch` and hit the DB on every request:
- `GET /players/:puuid/champions` 
- `GET /players/:puuid/matches`
- `GET /players/:puuid/augments`
- `GET /players/:puuid/coplayers`

`GET /sync/queue` in `sync.ts` is polled frequently and also bypasses the cache.

After wrapping these routes, `insertMatches` must immediately invalidate the affected per-player cache entries so stale data isn't served after new matches arrive.

- [ ] **Step 1: Wrap the 4 per-player routes in `stats.ts`**

In `src/backend/routes/stats.ts`, replace the four handlers:

**`GET /players/:puuid/champions`** (lines 96–100):
```typescript
  router.get('/players/:puuid/champions', async (req, res, next: NextFunction) => {
    try {
      res.json(await getChampionStats(req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })
```
→
```typescript
  router.get('/players/:puuid/champions', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `champ_player:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getChampionStats(puuid, patches, queueId)
      ))
    } catch (err) { next(err) }
  })
```

**`GET /players/:puuid/matches`** (lines 102–107):
```typescript
  router.get('/players/:puuid/matches', async (req, res, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
      res.json(await getRecentMatches(limit, req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })
```
→
```typescript
  router.get('/players/:puuid/matches', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
      res.json(await getOrFetch(
        `matches_player:${puuid}:${patchKey(patches)}:${queueId}:${limit ?? ''}`,
        () => getRecentMatches(limit, puuid, patches, queueId)
      ))
    } catch (err) { next(err) }
  })
```

**`GET /players/:puuid/augments`** (lines 109–114):
```typescript
  router.get('/players/:puuid/augments', async (req, res, next: NextFunction) => {
    try {
      const augCache = opts.getAugments?.() ?? {}
      res.json(await getAugmentStats(req.params.puuid, undefined, parsePatches(req.query.patches), augCache, parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })
```
→
```typescript
  router.get('/players/:puuid/augments', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      const augCache = opts.getAugments?.() ?? {}
      res.json(await getOrFetch(
        `aug_player:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getAugmentStats(puuid, undefined, patches, augCache, queueId)
      ))
    } catch (err) { next(err) }
  })
```

**`GET /players/:puuid/coplayers`** (lines 122–126):
```typescript
  router.get('/players/:puuid/coplayers', async (req, res, next: NextFunction) => {
    try {
      res.json(await getCoplayerStats(req.params.puuid, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
    } catch (err) { next(err) }
  })
```
→
```typescript
  router.get('/players/:puuid/coplayers', async (req, res, next: NextFunction) => {
    try {
      const puuid = req.params.puuid
      const patches = parsePatches(req.query.patches)
      const queueId = parseQueueId(req.query.queueId)
      res.json(await getOrFetch(
        `coplayers:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getCoplayerStats(puuid, patches, queueId)
      ))
    } catch (err) { next(err) }
  })
```

- [ ] **Step 2: Wrap `GET /sync/queue` in `sync.ts`**

In `src/backend/routes/sync.ts`, add the import at the top:

```typescript
import { getOrFetch } from '../queryCache'
```

Replace the `GET /sync/queue` handler (lines 99–103):
```typescript
  router.get('/sync/queue', async (_req, res, next: NextFunction) => {
    try {
      res.json(await getQueueStatus())
    } catch (err) { next(err) }
  })
```
→
```typescript
  router.get('/sync/queue', async (_req, res, next: NextFunction) => {
    try {
      res.json(await getOrFetch('sync_queue', () => getQueueStatus(), 10_000))
    } catch (err) { next(err) }
  })
```

- [ ] **Step 3: Add per-puuid cache invalidation to `insertMatches` in `db.ts`**

In `src/backend/db.ts`, find the end of `insertMatches` (around line 1345–1348). The function currently ends with:

```typescript
  const puuids = [...new Set(matches.flatMap(m => m.participants.map(p => p.puuid).filter(Boolean)))]
  await enqueueAll(puuids)
  return insertedCount
}
```

Replace with:

```typescript
  const puuids = [...new Set(matches.flatMap(m => m.participants.map(p => p.puuid).filter(Boolean)))]
  await enqueueAll(puuids)
  for (const puuid of puuids) {
    invalidatePrefix(`champ_player:${puuid}:`)
    invalidatePrefix(`matches_player:${puuid}:`)
    invalidatePrefix(`aug_player:${puuid}:`)
    invalidatePrefix(`coplayers:${puuid}:`)
  }
  return insertedCount
}
```

- [ ] **Step 4: Run tests**

```
npx vitest run
```

Expected: all tests PASS. No functional changes, just cache wrapping.

- [ ] **Step 5: Commit**

```
git add src/backend/routes/stats.ts src/backend/routes/sync.ts src/backend/db.ts
git commit -m "feat: wrap per-player routes in getOrFetch, add per-puuid cache invalidation"
```

---

## Task 3: Replace Incremental Flush Pipeline with Materialized Views

**Files:**
- Modify: `src/backend/db.ts` (large changes)
- Modify: `src/backend/server-entry.ts`
- Modify: `src/backend/__tests__/performance.test.ts`

### Background

The six cache tables (`player_stats_cache`, `champion_stats_cache`, `augment_stats_cache`, `player_champion_stats_cache`, `player_augment_stats_cache`, `augment_champion_stats_cache`) are replaced by PostgreSQL MATERIALIZED VIEWs with the same names and column schemas, so all existing SELECT queries continue to work without changes. The matviews are defined as the same aggregation SQL that was hand-written in `flushPendingCaches`. `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a UNIQUE index on each matview.

The migration runs inside `initDb`: checks `pg_matviews` to see if matviews already exist, and if not, drops the old tables and creates the matviews. This is a one-time migration.

`refreshAllMatviews()` replaces `flushPendingCaches` + `flushDirtyPerfCache` + `rebuildMissingPerfPairs`. It's called fire-and-forget from `insertMatches` and `upsertMatch`. It ends by rebuilding `player_performance_cache` for all version/queue pairs and invalidating the full LRU.

### Step 1: Add matview migration block and `refreshAllMatviews` to `db.ts`

This is the bulk of the work. Complete the following sub-steps in order.

- [ ] **Step 3.1: Add `let lastRefreshMs = -1` and `refreshAllMatviews` near the top of db.ts**

After the `dirtyPerfPairs` and related declarations (around line 56), add:

```typescript
let lastRefreshMs = -1

export function getLastRefreshMs(): number {
  return lastRefreshMs
}

export async function refreshAllMatviews(): Promise<void> {
  const start = Date.now()
  await sql_`REFRESH MATERIALIZED VIEW CONCURRENTLY player_stats_cache`
  await sql_`REFRESH MATERIALIZED VIEW CONCURRENTLY champion_stats_cache`
  await sql_`REFRESH MATERIALIZED VIEW CONCURRENTLY augment_stats_cache`
  await sql_`REFRESH MATERIALIZED VIEW CONCURRENTLY player_champion_stats_cache`
  await sql_`REFRESH MATERIALIZED VIEW CONCURRENTLY player_augment_stats_cache`
  await sql_`REFRESH MATERIALIZED VIEW CONCURRENTLY augment_champion_stats_cache`

  // Rebuild player_performance_cache for all active version/queue pairs
  const pairs: any[] = await sql_`
    SELECT DISTINCT "gameVersion", "queueId"
    FROM player_champion_stats_cache
    WHERE "gameVersion" IS NOT NULL
  `
  for (const { gameVersion, queueId } of pairs) {
    await buildPlayerPerformanceCache(gameVersion as string, Number(queueId))
  }

  lastRefreshMs = Date.now() - start

  invalidatePrefix('champions:')
  invalidatePrefix('players:')
  invalidatePrefix('augments:')
  invalidatePrefix('perf:')
  invalidatePrefix('perf_data:')
  invalidatePrefix('item_builds:')
  invalidatePrefix('item_picks:')
  invalidatePrefix('item_archetypes:')
  invalidatePrefix('champ_player:')
  invalidatePrefix('matches_player:')
  invalidatePrefix('aug_player:')
  invalidatePrefix('coplayers:')
}
```

`refreshAllMatviews` references `buildPlayerPerformanceCache` which is defined later in the file — this is fine since functions are hoisted in JavaScript.

- [ ] **Step 3.2: Delete the incremental flush machinery**

Delete the following functions and variables from `db.ts`:

- `const dirtyPerfPairs = new Set<string>()` (line 56)
- `export function markPerfDirty(...)` (lines 58–60)
- `export async function flushDirtyPerfCache()` (lines 62–77)
- `export async function rebuildMissingPerfPairs()` (lines 79–91)
- `let _flushRunning = false` (line 93)
- `export async function flushPendingCaches()` (lines 94–98)
- `async function _flushPendingCaches()` (lines 99–337)
- `export async function backfillDetailCaches(...)` (lines 997–1051)

After deletion, the code that was below `rebuildMissingPerfPairs` (the `connectDb` and `initDb` functions) immediately follows the new `refreshAllMatviews` function.

- [ ] **Step 3.3: Add matview migration inside `initDb`**

Inside the `initDb` function, after creating the `pending_cache_games` table (near line 724) and before the `[{ count: champCacheCount }]` check, add the matview migration block. 

Find this sequence:
```typescript
  await sql_`
    CREATE TABLE IF NOT EXISTS pending_cache_games (
      game_id BIGINT PRIMARY KEY
    )
  `

console.log(`[db] indexes done (${Date.now() - _t1}ms)`)
  const [{ count: champCacheCount }] = await sql_`SELECT COUNT(*) FROM champion_stats_cache`
```

Replace with:

```typescript
  console.log(`[db] indexes done (${Date.now() - _t1}ms)`)

  // ─── Matview migration (one-time) ────────────────────────────────────────────
  // Check whether we've already migrated to matviews by checking pg_matviews.
  // If not, drop the old cache tables and create matviews with the same names.
  const [{ count: mvCount }] = await sql_`
    SELECT COUNT(*) FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'player_stats_cache'
  `
  if (Number(mvCount) === 0) {
    console.log('[db] migrating cache tables to materialized views...')
    const _tmv = Date.now()
    onProgress?.('Migrating cache tables to materialized views…')

    await sql_`DROP TABLE IF EXISTS player_stats_cache CASCADE`
    await sql_`DROP TABLE IF EXISTS champion_stats_cache CASCADE`
    await sql_`DROP TABLE IF EXISTS augment_stats_cache CASCADE`
    await sql_`DROP TABLE IF EXISTS player_champion_stats_cache CASCADE`
    await sql_`DROP TABLE IF EXISTS player_augment_stats_cache CASCADE`
    await sql_`DROP TABLE IF EXISTS augment_champion_stats_cache CASCADE`
    await sql_`DROP TABLE IF EXISTS pending_cache_games CASCADE`

    await sql_`
      CREATE MATERIALIZED VIEW player_stats_cache AS
        SELECT p."gameVersion", m."queueId", p.puuid, MAX(p."summonerName") AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS total_kills, SUM(p.deaths)::int AS total_deaths,
          SUM(p.assists)::int AS total_assists,
          SUM(p."damageDealt")::bigint AS total_damage,
          SUM(p."gameDuration")::bigint AS total_duration
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        WHERE p."gameVersion" IS NOT NULL AND p.puuid != ''
        GROUP BY p."gameVersion", m."queueId", p.puuid
      WITH NO DATA
    `
    await sql_`CREATE UNIQUE INDEX idx_player_stats_cache_pk ON player_stats_cache ("gameVersion","queueId",puuid)`

    await sql_`
      CREATE MATERIALIZED VIEW champion_stats_cache AS
        WITH tk AS (
          SELECT "gameId","teamId", SUM(kills)::bigint AS team_kills
          FROM participants GROUP BY "gameId","teamId"
        )
        SELECT p."gameVersion", m."queueId", p."championId",
          MIN(p."championName") AS "championName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS total_kills, SUM(p.deaths)::int AS total_deaths,
          SUM(p.assists)::int AS total_assists,
          SUM(p."damageDealt") AS total_damage,
          SUM(p."gameDuration") AS total_duration,
          SUM(tk.team_kills)::bigint AS total_team_kills,
          SUM(p."goldEarned")::bigint AS total_gold
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN tk ON tk."gameId" = p."gameId" AND tk."teamId" = p."teamId"
        WHERE p."gameVersion" IS NOT NULL
        GROUP BY p."gameVersion", m."queueId", p."championId"
      WITH NO DATA
    `
    await sql_`CREATE UNIQUE INDEX idx_champion_stats_cache_pk ON champion_stats_cache ("gameVersion","queueId","championId")`

    await sql_`
      CREATE MATERIALIZED VIEW augment_stats_cache AS
        SELECT p."gameVersion", m."queueId", pa."augmentId",
          COUNT(*)::int AS pick_count, SUM(p.win::int)::int AS wins,
          SUM(p."damageDealt") AS total_damage,
          SUM(p."gameDuration") AS total_duration
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN participant_augments pa ON pa."participantId" = p.id
        WHERE p."gameVersion" IS NOT NULL
        GROUP BY p."gameVersion", m."queueId", pa."augmentId"
      WITH NO DATA
    `
    await sql_`CREATE UNIQUE INDEX idx_augment_stats_cache_pk ON augment_stats_cache ("gameVersion","queueId","augmentId")`

    await sql_`
      CREATE MATERIALIZED VIEW player_champion_stats_cache AS
        WITH tk AS (
          SELECT "gameId","teamId", SUM(kills)::bigint AS team_kills
          FROM participants GROUP BY "gameId","teamId"
        )
        SELECT p."gameVersion", m."queueId", p.puuid, p."championId",
          MIN(p."championName") AS "championName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS total_kills, SUM(p.deaths)::int AS total_deaths,
          SUM(p.assists)::int AS total_assists,
          SUM(p."damageDealt")::bigint AS total_damage,
          SUM(p."gameDuration")::bigint AS total_duration,
          SUM(p."goldEarned")::bigint AS total_gold,
          SUM(tk.team_kills)::bigint AS total_team_kills
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN tk ON tk."gameId" = p."gameId" AND tk."teamId" = p."teamId"
        WHERE p."gameVersion" IS NOT NULL AND p.puuid != ''
        GROUP BY p."gameVersion", m."queueId", p.puuid, p."championId"
      WITH NO DATA
    `
    await sql_`CREATE UNIQUE INDEX idx_player_champion_stats_cache_pk ON player_champion_stats_cache ("gameVersion","queueId",puuid,"championId")`

    await sql_`
      CREATE MATERIALIZED VIEW player_augment_stats_cache AS
        SELECT p."gameVersion", m."queueId", p.puuid, pa."augmentId",
          COUNT(*)::int AS pick_count
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN participant_augments pa ON pa."participantId" = p.id
        WHERE p."gameVersion" IS NOT NULL AND p.puuid != ''
        GROUP BY p."gameVersion", m."queueId", p.puuid, pa."augmentId"
      WITH NO DATA
    `
    await sql_`CREATE UNIQUE INDEX idx_player_augment_stats_cache_pk ON player_augment_stats_cache ("gameVersion","queueId",puuid,"augmentId")`

    await sql_`
      CREATE MATERIALIZED VIEW augment_champion_stats_cache AS
        SELECT p."gameVersion", m."queueId", pa."augmentId", p."championId",
          MIN(p."championName") AS "championName",
          COUNT(*)::int AS pick_count, SUM(p.win::int)::int AS wins,
          SUM(p."damageDealt") AS total_damage,
          SUM(p."gameDuration") AS total_duration
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN participant_augments pa ON pa."participantId" = p.id
        WHERE p."gameVersion" IS NOT NULL
        GROUP BY p."gameVersion", m."queueId", pa."augmentId", p."championId"
      WITH NO DATA
    `
    await sql_`CREATE UNIQUE INDEX idx_augment_champion_stats_cache_pk ON augment_champion_stats_cache ("gameVersion","queueId","augmentId","championId")`

    // Initial population — synchronous, runs once at migration time
    await sql_`REFRESH MATERIALIZED VIEW player_stats_cache`
    await sql_`REFRESH MATERIALIZED VIEW champion_stats_cache`
    await sql_`REFRESH MATERIALIZED VIEW augment_stats_cache`
    await sql_`REFRESH MATERIALIZED VIEW player_champion_stats_cache`
    await sql_`REFRESH MATERIALIZED VIEW player_augment_stats_cache`
    await sql_`REFRESH MATERIALIZED VIEW augment_champion_stats_cache`

    // Rebuild player_performance_cache from the freshly populated matviews
    const pairs: any[] = await sql_`
      SELECT DISTINCT "gameVersion", "queueId"
      FROM player_champion_stats_cache
      WHERE "gameVersion" IS NOT NULL
    `
    for (const { gameVersion, queueId } of pairs) {
      await buildPlayerPerformanceCache(gameVersion as string, Number(queueId))
    }
    console.log(`[db] matview migration done (${Date.now() - _tmv}ms)`)
  }
```

Also find and **remove** the old startup backfill block that follows (checking `champCacheCount` and doing a full backfill INSERT). This block starts at approximately:

```typescript
  const [{ count: champCacheCount }] = await sql_`SELECT COUNT(*) FROM champion_stats_cache`
  if (Number(champCacheCount) === 0) {
```

This entire block is replaced by the matview migration above. Delete from `const [{ count: champCacheCount }]` through the closing brace and `console.log('[db] summary caches done...')`.

Also delete the `needsChampCacheRebuild`, `needsPCSRebuild` and related TRUNCATE blocks in the CREATE TABLE section — these were workarounds for old schema migrations. With matviews, they're not needed.

Remove the following `CREATE TABLE IF NOT EXISTS` blocks from `initDb` (they are lines ~492–728 in the current file) — these objects are now created as matviews in the migration block above:
- `CREATE TABLE IF NOT EXISTS champion_stats_cache` (and all its `ALTER TABLE` / `if (!hasCol(...))` guards)
- `CREATE TABLE IF NOT EXISTS augment_stats_cache` (and ALTER guards)
- `CREATE TABLE IF NOT EXISTS player_stats_cache` (and ALTER guards, and the `CREATE INDEX IF NOT EXISTS idx_player_stats_cache_puuid`)
- `CREATE TABLE IF NOT EXISTS player_champion_stats_cache` (and ALTER guards, and `CREATE INDEX IF NOT EXISTS idx_player_champion_stats_cache_puuid`)
- `CREATE TABLE IF NOT EXISTS augment_champion_stats_cache` (and ALTER guards)
- The `if (hasCol('player_augment_stats_cache', 'wins'))` drop-and-recreate block
- `CREATE TABLE IF NOT EXISTS player_augment_stats_cache` (and its PRIMARY KEY definition)
- `CREATE TABLE IF NOT EXISTS pending_cache_games`

Also remove the `CREATE INDEX IF NOT EXISTS` lines for the six cache tables' secondary indexes (they reference tables that no longer exist as regular tables). The matviews get their own UNIQUE indexes in the migration block.

Keep everything else: `player_performance_cache`, `item_builds_cache`, `item_picks_cache`, `item_archetypes_cache`, `player_elo`, `elo_history`, `meta_*` tables, and all base table indexes on `participants`, `matches`, etc.

- [ ] **Step 3.4: Update `insertMatches` to call `refreshAllMatviews` fire-and-forget**

In `insertMatches`, remove the `pending_cache_games` insert block:

```typescript
    if (newGameIds.size > 0) {
      await tx`
        INSERT INTO pending_cache_games (game_id)
        SELECT unnest(${[...newGameIds]}::bigint[])
        ON CONFLICT (game_id) DO NOTHING
      `
    }
```

Delete these lines entirely.

After the `await enqueueAll(puuids)` line (and after the per-puuid cache invalidation added in Task 2), add:

```typescript
  if (insertedCount > 0) {
    refreshAllMatviews().catch(err => console.warn('[matview] refresh failed:', (err as Error).message))
  }
```

- [ ] **Step 3.5: Update `upsertMatch` to call `refreshAllMatviews` fire-and-forget**

In `upsertMatch` (around line 1350), at the very end of the function body (after `await tx` completes), add before the closing brace:

```typescript
  refreshAllMatviews().catch(err => console.warn('[matview] refresh failed:', (err as Error).message))
```

- [ ] **Step 3.6: Clean up exports**

Remove from `db.ts` exports (delete the export keyword or the whole function, already done above):
- `markPerfDirty`
- `flushDirtyPerfCache`
- `rebuildMissingPerfPairs`
- `flushPendingCaches`
- `backfillDetailCaches`

Add to exports:
- `refreshAllMatviews` (already has `export async function`)
- `getLastRefreshMs` (already has `export function`)

- [ ] **Step 3.7: Update `server-entry.ts` to remove flush intervals and startup timeout**

In `src/backend/server-entry.ts`:

1. Remove these imports from the db import block:
   - `backfillDetailCaches`
   - `flushDirtyPerfCache`
   - `flushPendingCaches`
   - `rebuildMissingPerfPairs`

2. Remove the `setInterval` for `flushPendingCaches` (fires every 30s).

3. Remove the `setInterval` for `flushDirtyPerfCache` (fires every 60s).

4. Remove the entire `setTimeout(..., 90_000)` block (which contained `backfillDetailCaches`, `rebuildMissingPerfPairs`, `flushPendingCaches().then(() => warmLruCaches())`).

The `warmLruCaches()` call that was inside the 90s timeout is already called immediately after server start. Keep it.

After these removals, the startup sequence inside `listen` should look like:

```typescript
    console.log(`[server] ready — listening on :${PORT}`)
    ;(process as any).parentPort?.postMessage({ type: 'ready' })

    fetchAndStoreItems().catch(err => console.warn('[meta] item seed failed:', (err as Error).message))
    refreshMetadata(champRef, augRef)
    setInterval(() => refreshMetadata(champRef, augRef), REFRESH_INTERVAL_MS)
    warmLruCaches().catch(err => console.warn('[cache] LRU warm failed:', (err as Error).message))
    const logFile = process.env.MAYHEM_LOG_FILE
    if (logFile) {
      initMetricsPersistence(logFile.replace(/\.log$/, '-metrics.json'))
      initLruPersistence(logFile.replace(/\.log$/, '-lru-cache.json'))
    }
```

- [ ] **Step 3.8: Update `performance.test.ts`**

**Update the import line** to remove deleted functions and add `refreshAllMatviews`:

```typescript
import { initDb, insertMatches, Match, getPlayerPerformance, buildPlayerPerformanceCache, getPerformancePercentiles, refreshAllMatviews } from '../db'
```

**Update the `truncate()` function** — cache tables are now matviews and can't be TRUNCATEd. Instead, truncate base tables and then REFRESH the matviews:

```typescript
async function truncate() {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE sync_queue, player_sync_times, participant_augments, participant_items, participants, matches,
    player_performance_cache, item_builds_cache, item_picks_cache,
    item_archetypes_cache, player_elo, elo_history
    RESTART IDENTITY CASCADE`
  await db`REFRESH MATERIALIZED VIEW player_stats_cache`
  await db`REFRESH MATERIALIZED VIEW champion_stats_cache`
  await db`REFRESH MATERIALIZED VIEW augment_stats_cache`
  await db`REFRESH MATERIALIZED VIEW player_champion_stats_cache`
  await db`REFRESH MATERIALIZED VIEW player_augment_stats_cache`
  await db`REFRESH MATERIALIZED VIEW augment_champion_stats_cache`
  await db.end()
}
```

**Replace all `await flushPendingCaches()` calls** with `await refreshAllMatviews()`.

**Replace all `await buildPlayerPerformanceCache('15.12', 2400)` calls that appear after `flushPendingCaches`** — with `refreshAllMatviews` these become redundant since `refreshAllMatviews` already calls `buildPlayerPerformanceCache` internally. Remove the explicit `buildPlayerPerformanceCache` calls.

**Replace the `player_performance_cache / buildPlayerPerformanceCache` describe block** — since `refreshAllMatviews` now handles this:

```typescript
describe('player_performance_cache / buildPlayerPerformanceCache', () => {
  it('populates correct metrics for sole champion representative', async () => {
    await insertMatches(makeGames())
    await refreshAllMatviews()

    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    const [row] = await db`
      SELECT * FROM player_performance_cache
      WHERE puuid = 'p1' AND "gameVersion" = '15.12' AND "queueId" = 2400
    `
    await db.end()

    expect(row.games).toBe(2)
    expect(Number(row.cpq)).toBeCloseTo(0.5)
    expect(Math.abs(Number(row.kp_delta))).toBeLessThan(0.01)
    expect(Math.abs(Number(row.dpm_pct))).toBeLessThan(0.01)
    expect(Math.abs(Number(row.gpm_pct))).toBeLessThan(0.01)
    expect(Math.abs(Number(row.apq))).toBeLessThan(0.01)
  })

  it('populates player_performance_cache after insertMatches + refreshAllMatviews', async () => {
    await insertMatches(makeGames())
    await refreshAllMatviews()
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })
    const rows = await db`SELECT * FROM player_performance_cache WHERE "gameVersion" = '15.12' AND "queueId" = 2400`
    await db.end()
    expect(rows.length).toBeGreaterThan(0)
  })
})
```

**Delete the following describe blocks entirely** (they test deleted functions):
- `describe('dirty perf cache machinery', ...)`
- `describe('flushPendingCaches', ...)`

**Update the `champion_stats_cache total_team_kills and total_gold` test** to use `refreshAllMatviews()`:

```typescript
describe('champion_stats_cache total_team_kills and total_gold', () => {
  it('accumulates correct team kills and gold per champion', async () => {
    await insertMatches([makeGame()])
    await refreshAllMatviews()
    const kayle = await queryChampCache(10)
    expect(Number(kayle.total_team_kills)).toBe(7)
    expect(Number(kayle.total_gold)).toBe(12000)
    const lux = await queryChampCache(20)
    expect(Number(lux.total_team_kills)).toBe(2)
    expect(Number(lux.total_gold)).toBe(7000)
  })
})
```

- [ ] **Step 3.9: Run tests**

```
npx vitest run
```

Expected: all tests PASS. The matview migration will run during `initDb` in the test suite, dropping old tables and creating matviews.

If tests fail with "relation does not exist", it means the matview migration didn't run. Check that the `mvCount` query runs before the CREATE TABLE blocks are removed.

- [ ] **Step 3.10: Commit**

```
git add src/backend/db.ts src/backend/server-entry.ts src/backend/__tests__/performance.test.ts
git commit -m "feat: replace incremental flush pipeline with PostgreSQL materialized views"
```

---

## Task 4: Performance Observability

**Files:**
- Modify: `src/backend/metrics.ts`
- Create: `src/backend/__tests__/perf.bench.ts`
- Modify: `package.json`

### Background

`getLastRefreshMs()` is already exported from `db.ts` (added in Task 3). It returns `-1` before the first refresh completes. We expose it in the `/api/metrics` response so operators can see how long the matview refresh pipeline takes. We also add a Vitest bench suite to measure cache-warm vs cache-cold query times.

- [ ] **Step 4.1: Add `matviewLastRefreshMs` to `MetricsSnapshot` and `getMetrics()`**

In `src/backend/metrics.ts`:

1. Add the import at the top:
```typescript
import { getLastRefreshMs } from './db'
```

2. Add `matviewLastRefreshMs: number` to the `MetricsSnapshot` interface:

```typescript
export interface MetricsSnapshot {
  uptime: number
  totalRequests: number
  totalErrors: number
  globalP50: number
  globalP95: number
  globalP99: number
  matviewLastRefreshMs: number   // -1 if never refreshed since start
  routes: RouteSnapshot[]
}
```

3. Add `matviewLastRefreshMs: getLastRefreshMs()` to the return value in `getMetrics()`:

```typescript
  return {
    uptime: Date.now() - startTime,
    totalRequests: routes.reduce((s, r) => s + r.requests, 0),
    totalErrors: routes.reduce((s, r) => s + r.errors, 0),
    globalP50: percentile(gSample, 50),
    globalP95: percentile(gSample, 95),
    globalP99: percentile(gSample, 99),
    matviewLastRefreshMs: getLastRefreshMs(),
    routes,
  }
```

- [ ] **Step 4.2: Run tests to verify `getMetrics()` still returns correctly**

```
npx vitest run
```

Expected: PASS. The `MetricsSnapshot` type change is additive.

- [ ] **Step 4.3: Create the bench file**

Create `src/backend/__tests__/perf.bench.ts`:

```typescript
import { bench, beforeAll, afterAll } from 'vitest'
import { initDb, getPlayerStats, getChampionStats, refreshAllMatviews } from '../db'
import { getOrFetch, invalidate, clearAll } from '../queryCache'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => {
  await initDb(TEST_URL)
  // Warm caches so bench measures steady-state
  await getOrFetch('players::2400', () => getPlayerStats(undefined, 2400))
  await getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400))
})

afterAll(() => clearAll())

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

bench('getChampionStats (cache cold)', async () => {
  invalidate('champions::2400')
  await getOrFetch('champions::2400', () => getChampionStats(undefined, undefined, 2400))
}, { time: 10_000 })

bench('refreshAllMatviews', async () => {
  await refreshAllMatviews()
}, { time: 10_000 })
```

- [ ] **Step 4.4: Add bench script to `package.json`**

In `package.json`, add to the `"scripts"` block after the `"test"` line:

```json
"bench": "vitest bench --run src/backend/__tests__/perf.bench.ts",
```

- [ ] **Step 4.5: Run the bench to verify it executes**

```
npx cross-env TEST_DATABASE_URL=<your-test-db-url> npm run bench
```

Expected: bench output printed with ops/sec or ms per call. Numbers for warm cache should be <5ms, cold cache <500ms with matviews.

If you don't have TEST_DATABASE_URL available, just verify the script is wired correctly:
```
npm run bench -- --help
```
Expected: vitest help output (no TS errors).

- [ ] **Step 4.6: Run all tests**

```
npx vitest run
```

Expected: all tests PASS (bench file excluded by the `.test.ts` include pattern in vitest.config.ts).

- [ ] **Step 4.7: Commit**

```
git add src/backend/metrics.ts src/backend/__tests__/perf.bench.ts package.json
git commit -m "feat: add matviewLastRefreshMs to metrics, add perf bench suite"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass
- [ ] `npm run staging` — server starts, metrics tab shows `matviewLastRefreshMs` updating after each match import
- [ ] After server restart — check metrics tab loads in <1s (LRU restored from disk)
- [ ] Navigate to a player's champion tab — first load < 1s (hits matview directly via cached route), subsequent loads instant (LRU hit)
- [ ] No `pending_cache_games` table in schema
- [ ] No `flushPendingCaches` calls in codebase: `grep -r "flushPendingCaches" src/` → 0 results
- [ ] `npm run bench` — runs and prints timings (requires TEST_DATABASE_URL)

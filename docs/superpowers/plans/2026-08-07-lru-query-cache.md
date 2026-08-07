# LRU Read-Through Query Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory LRU cache in front of seven high-traffic Express routes to eliminate redundant Postgres reads for the same (patch, queueId) combo within a session.

**Architecture:** A new `queryCache.ts` module wraps `lru-cache` v10 and exposes `getOrFetch`, `invalidate`, `invalidatePrefix`, and `clearAll`. Routes call `getOrFetch(key, fetchFn)` — cache hits return immediately, misses call the existing DB function and store the result. After each sync, `insertMatches` calls `invalidatePrefix` to flush all affected entries.

**Tech Stack:** `lru-cache` v10, Vitest, TypeScript, Express (existing), `postgres.js` (existing).

---

## File Map

| File | Change |
|------|--------|
| `src/backend/queryCache.ts` | **Create** — LRU cache module |
| `src/backend/__tests__/queryCache.test.ts` | **Create** — unit tests for cache module |
| `src/backend/routes/stats.ts` | **Modify** — wrap 7 routes with `getOrFetch` |
| `src/backend/db.ts` | **Modify** — call `invalidatePrefix` variants after sync in `insertMatches` (lines 1305–1316) |

---

## Task 1: Install lru-cache and create the cache module

**Files:**
- Create: `src/backend/queryCache.ts`

- [ ] **Step 1: Install lru-cache**

```bash
npm install lru-cache
```

Expected: `lru-cache` appears in `package.json` dependencies.

- [ ] **Step 2: Create `src/backend/queryCache.ts`**

```typescript
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, unknown>({
  max: 200,
  ttl: 30 * 60 * 1000,
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

export function clearAll(): void {
  cache.clear()
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/backend/queryCache.ts package.json package-lock.json
git commit -m "feat: add LRU query cache module"
```

---

## Task 2: Unit tests for the cache module

**Files:**
- Create: `src/backend/__tests__/queryCache.test.ts`

- [ ] **Step 1: Write the tests**

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
  it('removes all keys matching prefix and leaves others intact', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    await getOrFetch('champions:15.12:2400', fetch)
    await getOrFetch('champions:15.11:2400', fetch)
    await getOrFetch('players:15.12:2400', fetch)
    expect(fetch).toHaveBeenCalledTimes(3)

    invalidatePrefix('champions:')
    fetch.mockResolvedValue('fresh')
    await getOrFetch('champions:15.12:2400', fetch)  // re-fetched
    await getOrFetch('champions:15.11:2400', fetch)  // re-fetched
    await getOrFetch('players:15.12:2400', fetch)    // still cached
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})
```

- [ ] **Step 2: Run the tests and verify they pass**

```bash
npx vitest run src/backend/__tests__/queryCache.test.ts
```

Expected: 5 tests pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add src/backend/__tests__/queryCache.test.ts
git commit -m "test: add unit tests for LRU query cache module"
```

---

## Task 3: Wrap routes in stats.ts with getOrFetch

**Files:**
- Modify: `src/backend/routes/stats.ts`

**Context:** The file is at `src/backend/routes/stats.ts`. It exports `createStatsRouter`. The routes to wrap are `/players`, `/champions`, `/augments` (global only), `/players/:puuid/performance`, `/items/builds`, `/items/picks`, `/items/archetypes`, and `/items/summary`. The `/augments` route with a `championId` query param is **not** cached.

- [ ] **Step 1: Add the import at the top of `src/backend/routes/stats.ts`**

After the existing imports, add:

```typescript
import { getOrFetch, invalidatePrefix } from '../queryCache'
```

- [ ] **Step 2: Add the patchKey helper just inside `createStatsRouter`, before the first route**

```typescript
const patchKey = (patches: string[] | undefined) => (patches ?? []).slice().sort().join(',')
```

Place this immediately after `const router = Router()` on line 44.

- [ ] **Step 3: Wrap the `/players` route**

Replace:
```typescript
  router.get('/players', async (req, res) => {
    res.json(await getPlayerStats(parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })
```

With:
```typescript
  router.get('/players', async (req, res) => {
    const patches = parsePatches(req.query.patches)
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getOrFetch(
      `players:${patchKey(patches)}:${queueId}`,
      () => getPlayerStats(patches, queueId)
    ))
  })
```

- [ ] **Step 4: Wrap the `/champions` route**

Replace:
```typescript
  router.get('/champions', async (req, res) => {
    res.json(await getChampionStats(undefined, parsePatches(req.query.patches), parseQueueId(req.query.queueId)))
  })
```

With:
```typescript
  router.get('/champions', async (req, res) => {
    const patches = parsePatches(req.query.patches)
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getOrFetch(
      `champions:${patchKey(patches)}:${queueId}`,
      () => getChampionStats(undefined, patches, queueId)
    ))
  })
```

- [ ] **Step 5: Wrap the `/augments` route (global only — no championId)**

Replace:
```typescript
  router.get('/augments', async (req, res) => {
    const augCache = opts.getAugments?.() ?? {}
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    res.json(await getAugmentStats(undefined, championId, patches, augCache, parseQueueId(req.query.queueId)))
  })
```

With:
```typescript
  router.get('/augments', async (req, res) => {
    const augCache = opts.getAugments?.() ?? {}
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    const queueId = parseQueueId(req.query.queueId)
    if (championId !== undefined) {
      res.json(await getAugmentStats(undefined, championId, patches, augCache, queueId))
    } else {
      res.json(await getOrFetch(
        `augments:${patchKey(patches)}:${queueId}`,
        () => getAugmentStats(undefined, undefined, patches, augCache, queueId)
      ))
    }
  })
```

- [ ] **Step 6: Wrap the `/items/builds` route**

Replace:
```typescript
  router.get('/items/builds', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const allowedIds = typeof req.query.allowed === 'string' && req.query.allowed
      ? req.query.allowed.split(',').map(Number).filter(Boolean)
      : []
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getItemBuilds(championId, patches, allowedIds, queueId))
  })
```

With:
```typescript
  router.get('/items/builds', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const allowedIds = typeof req.query.allowed === 'string' && req.query.allowed
      ? req.query.allowed.split(',').map(Number).filter(Boolean)
      : []
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getOrFetch(
      `item_builds:${championId}:${patchKey(patches)}:${allowedIds.slice().sort().join(',')}:${queueId}`,
      () => getItemBuilds(championId, patches, allowedIds, queueId)
    ))
  })
```

- [ ] **Step 7: Wrap the `/items/picks` route**

Replace:
```typescript
  router.get('/items/picks', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    res.json(await getItemPickRates(championId, patches, parseQueueId(req.query.queueId)))
  })
```

With:
```typescript
  router.get('/items/picks', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getOrFetch(
      `item_picks:${championId}:${patchKey(patches)}:${queueId}`,
      () => getItemPickRates(championId, patches, queueId)
    ))
  })
```

- [ ] **Step 8: Wrap the `/items/archetypes` route**

Replace:
```typescript
  router.get('/items/archetypes', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    res.json(await getOrComputeArchetypes(championId, patches, parseQueueId(req.query.queueId)))
  })
```

With:
```typescript
  router.get('/items/archetypes', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const queueId = parseQueueId(req.query.queueId)
    res.json(await getOrFetch(
      `item_archetypes:${championId}:${patchKey(patches)}:${queueId}`,
      () => getOrComputeArchetypes(championId, patches, queueId)
    ))
  })
```

- [ ] **Step 9: Wrap the `/items/summary` route**

The `/items/summary` route calls both `getOrComputeArchetypes` and `getItemPickRates` in parallel. Wrap each call individually so they share cache entries with `/items/archetypes` and `/items/picks`.

Replace:
```typescript
  router.get('/items/summary', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const queueId = parseQueueId(req.query.queueId)
    const [archetypes, picks] = await Promise.all([
      getOrComputeArchetypes(championId, patches, queueId),
      getItemPickRates(championId, patches, queueId),
    ])
    res.json({ archetypes, totalGames: picks.totalGames, items: picks.items })
  })
```

With:
```typescript
  router.get('/items/summary', async (req, res) => {
    const championId = req.query.championId ? parseInt(req.query.championId as string) : undefined
    if (!championId) return res.status(400).json({ error: 'championId required' })
    const rawPatches = parsePatches(req.query.patches)
    const patches = rawPatches ?? (opts.latestPatch?.value ? [opts.latestPatch.value] : undefined)
    const queueId = parseQueueId(req.query.queueId)
    const [archetypes, picks] = await Promise.all([
      getOrFetch(
        `item_archetypes:${championId}:${patchKey(patches)}:${queueId}`,
        () => getOrComputeArchetypes(championId, patches, queueId)
      ),
      getOrFetch(
        `item_picks:${championId}:${patchKey(patches)}:${queueId}`,
        () => getItemPickRates(championId, patches, queueId)
      ),
    ])
    res.json({ archetypes, totalGames: picks.totalGames, items: picks.items })
  })
```

- [ ] **Step 10: Wrap the `/players/:puuid/performance` route (percentiles only)**

Replace:
```typescript
  router.get('/players/:puuid/performance', async (req, res) => {
    const puuid = req.params.puuid
    const patches = parsePatches(req.query.patches)
    const queueId = parseQueueId(req.query.queueId)
    const championMap = (opts.getChampions?.() ?? {}) as Record<number, ChampionMeta>
    const [perf, percentiles] = await Promise.all([
      getPlayerPerformance(puuid, championMap, patches, queueId),
      getPerformancePercentiles(puuid, patches, queueId),
    ])
    res.json({ ...perf, percentiles })
  })
```

With:
```typescript
  router.get('/players/:puuid/performance', async (req, res) => {
    const puuid = req.params.puuid
    const patches = parsePatches(req.query.patches)
    const queueId = parseQueueId(req.query.queueId)
    const championMap = (opts.getChampions?.() ?? {}) as Record<number, ChampionMeta>
    const [perf, percentiles] = await Promise.all([
      getPlayerPerformance(puuid, championMap, patches, queueId),
      getOrFetch(
        `perf:${puuid}:${patchKey(patches)}:${queueId}`,
        () => getPerformancePercentiles(puuid, patches, queueId)
      ),
    ])
    res.json({ ...perf, percentiles })
  })
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 12: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests pass (routes tests still pass — cache is transparent on first call).

- [ ] **Step 13: Commit**

```bash
git add src/backend/routes/stats.ts
git commit -m "feat: wrap high-traffic routes with LRU read-through cache"
```

---

## Task 4: Post-sync cache invalidation in db.ts

**Files:**
- Modify: `src/backend/db.ts` (around line 1305)

**Context:** `insertMatches` already rebuilds `player_performance_cache` after a sync (lines 1305–1316). Add `invalidatePrefix` calls immediately after the existing `buildPlayerPerformanceCache` call so the in-memory cache reflects the updated DB state.

- [ ] **Step 1: Add the import at the top of `src/backend/db.ts`**

Find the existing imports near the top of the file (around line 1). Add after the last import:

```typescript
import { invalidatePrefix } from './queryCache'
```

- [ ] **Step 2: Add invalidation calls inside the post-sync block**

The current block (lines 1305–1316) looks like:

```typescript
  if (insertedCount > 0) {
    const pairs = [...new Set(
      matches.filter(m => m.gameVersion).map(m => `${m.gameVersion}:${m.queueId}`)
    )]
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':')
      const gv = pair.slice(0, colonIdx)
      const qId = Number(pair.slice(colonIdx + 1))
      await sql_`DELETE FROM player_performance_cache WHERE "gameVersion" = ${gv} AND "queueId" = ${qId}`
      await buildPlayerPerformanceCache(gv, qId)
    }
  }
  return insertedCount
```

Replace it with:

```typescript
  if (insertedCount > 0) {
    const pairs = [...new Set(
      matches.filter(m => m.gameVersion).map(m => `${m.gameVersion}:${m.queueId}`)
    )]
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':')
      const gv = pair.slice(0, colonIdx)
      const qId = Number(pair.slice(colonIdx + 1))
      await sql_`DELETE FROM player_performance_cache WHERE "gameVersion" = ${gv} AND "queueId" = ${qId}`
      await buildPlayerPerformanceCache(gv, qId)
    }
    invalidatePrefix('champions:')
    invalidatePrefix('players:')
    invalidatePrefix('augments:')
    invalidatePrefix('perf:')
    invalidatePrefix('item_builds:')
    invalidatePrefix('item_picks:')
    invalidatePrefix('item_archetypes:')
  }
  return insertedCount
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass. The `queryCache.test.ts` tests pass. All existing route and DB tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/backend/db.ts
git commit -m "feat: invalidate LRU cache after sync in insertMatches"
```

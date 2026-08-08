# Sync Recalc Deferral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the DB contention caused by concurrent ELO recalcs and redundant performance cache rebuilds firing during an active sync.

**Architecture:** Two independent changes. (1) In `syncWorker`, pass only the current player's PUUID to `recomputeAffectedElo` instead of all ~200 co-participants, and await it. (2) In `insertMatches`, replace the fire-and-forget performance cache rebuild IIFE with an immediate synchronous DELETE plus a `markPerfDirty` call; a 60-second interval in `server-entry.ts` calls `flushDirtyPerfCache` to do the actual rebuild after sync pressure subsides.

**Tech Stack:** TypeScript, postgres tagged-template SQL, Vitest, Electron utility process IPC

---

## File Map

| File | Change |
|---|---|
| `src/backend/db.ts` | Add `dirtyPerfPairs` Set, `markPerfDirty()`, `flushDirtyPerfCache()` exports; replace fire-and-forget IIFE in `insertMatches` with inline DELETE + `markPerfDirty` |
| `src/backend/server-entry.ts` | Import `flushDirtyPerfCache`; add `setInterval` call inside `.listen` callback |
| `src/main/index.ts` | Replace `recomputeAffectedElo(affectedPuuids)` with `await recomputeAffectedElo([puuid])` |
| `src/backend/__tests__/performance.test.ts` | Add tests for new dirty-set behavior and DELETE-on-insert |

---

### Task 1: Add dirty-set machinery to `db.ts` and update `insertMatches`

**Files:**
- Modify: `src/backend/db.ts`
- Test: `src/backend/__tests__/performance.test.ts`

- [ ] **Step 1: Add tests for the new behavior**

Open `src/backend/__tests__/performance.test.ts`. Add these imports at the top of the file alongside the existing ones:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb, insertMatches, Match, getPlayerPerformance, buildPlayerPerformanceCache, getPerformancePercentiles, markPerfDirty, flushDirtyPerfCache } from '../db'
```

Then add this new `describe` block at the bottom of the file:

```ts
describe('dirty perf cache machinery', () => {
  it('insertMatches immediately deletes player_performance_cache for affected pairs', async () => {
    const postgres = (await import('postgres')).default
    const db = postgres(TEST_URL!, { onnotice: () => {} })

    // Pre-populate a perf cache row for ('15.12', 2400)
    await db`
      INSERT INTO player_performance_cache (puuid,"queueId","gameVersion",games,cpq,apq,kp_delta,dpm_pct,gpm_pct)
      VALUES ('p1', 2400, '15.12', 5, 0.1, 0.05, 0.02, 0.1, 0.1)
    `

    // Insert a match for that pair
    await insertMatches([{
      gameId: 99001, queueId: 2400, gameCreation: 1000, gameDuration: 1200, gameVersion: '15.12',
      participants: [
        { puuid: 'p1', summonerName: 'P1', championId: 10, championName: 'Kayle',
          teamId: 100, win: true, kills: 1, deaths: 0, assists: 0,
          damageDealt: 1000, damageTaken: 500, goldEarned: 3000, champLevel: 10, augments: [] },
        { puuid: 'p2', summonerName: 'P2', championId: 20, championName: 'Lux',
          teamId: 200, win: false, kills: 0, deaths: 1, assists: 0,
          damageDealt: 500, damageTaken: 1000, goldEarned: 2000, champLevel: 8, augments: [] },
      ]
    }])

    // Row must be gone immediately — not deferred
    const [row] = await db`SELECT * FROM player_performance_cache WHERE puuid = 'p1' AND "queueId" = 2400 AND "gameVersion" = '15.12'`
    expect(row).toBeUndefined()
    await db.end()
  })

  it('flushDirtyPerfCache is a no-op when nothing is dirty', async () => {
    await expect(flushDirtyPerfCache()).resolves.toBeUndefined()
  })

  it('flushDirtyPerfCache runs and clears the dirty set', async () => {
    markPerfDirty('15.12', 2400)
    // buildPlayerPerformanceCache returns early when no player_champion_stats_cache data exists
    await expect(flushDirtyPerfCache()).resolves.toBeUndefined()
    // Calling again is a no-op (set was cleared)
    await expect(flushDirtyPerfCache()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the new tests and confirm they fail**

```
npx vitest run src/backend/__tests__/performance.test.ts
```

Expected: the three new tests in `dirty perf cache machinery` fail with `markPerfDirty is not a function` or similar — the existing tests should still pass.

- [ ] **Step 3: Add `dirtyPerfPairs`, `markPerfDirty`, and `flushDirtyPerfCache` to `db.ts`**

Near the top of `src/backend/db.ts`, after the `sql_` variable declaration (around line 57), add:

```ts
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

- [ ] **Step 4: Replace the fire-and-forget IIFE in `insertMatches`**

In `src/backend/db.ts`, find the block inside `insertMatches` (around lines 1293–1310) that looks like:

```ts
    // Rebuild performance cache in the background — it aggregates over all player data
    // for the patch and can take >30s; don't block the HTTP response on it
    const pairs = [...new Set(
      matches.filter(m => m.gameVersion).map(m => `${m.gameVersion}:${m.queueId}`)
    )];
    (async () => {
      for (const pair of pairs) {
        const colonIdx = pair.indexOf(':')
        const gv = pair.slice(0, colonIdx)
        const qId = Number(pair.slice(colonIdx + 1))
        try {
          await sql_`DELETE FROM player_performance_cache WHERE "gameVersion" = ${gv} AND "queueId" = ${qId}`
          await buildPlayerPerformanceCache(gv, qId)
        } catch (err) {
          console.error('[insertMatches] perf cache rebuild failed:', gv, qId, err)
        }
      }
    })()
```

Replace it with:

```ts
    const pairs = [...new Set(
      matches.filter(m => m.gameVersion).map(m => `${m.gameVersion}:${m.queueId}`)
    )]
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':')
      const gv = pair.slice(0, colonIdx)
      const qId = Number(pair.slice(colonIdx + 1))
      await sql_`DELETE FROM player_performance_cache WHERE "gameVersion" = ${gv} AND "queueId" = ${qId}`
      markPerfDirty(gv, qId)
    }
```

- [ ] **Step 5: Run the tests and confirm all pass**

```
npx vitest run src/backend/__tests__/performance.test.ts
```

Expected: all tests pass, including the three new ones.

- [ ] **Step 6: Run the full test suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```
git add src/backend/db.ts src/backend/__tests__/performance.test.ts
git commit -m "feat: defer perf cache rebuild — delete immediately, flush on interval"
```

---

### Task 2: Wire `flushDirtyPerfCache` interval in `server-entry.ts`

**Files:**
- Modify: `src/backend/server-entry.ts`

- [ ] **Step 1: Import `flushDirtyPerfCache`**

In `src/backend/server-entry.ts`, find the existing import from `./db`:

```ts
import {
  initDb,
  backfillDetailCaches,
  upsertChampions, upsertAugments,
  getChampionsFromDb, getAugmentsFromDb,
  getPatches,
  upsertItemMeta,
} from './db'
```

Add `flushDirtyPerfCache` to it:

```ts
import {
  initDb,
  backfillDetailCaches,
  upsertChampions, upsertAugments,
  getChampionsFromDb, getAugmentsFromDb,
  getPatches,
  upsertItemMeta,
  flushDirtyPerfCache,
} from './db'
```

(If `backfillDetailCaches` has already been removed by the remove-startup-backfills plan, omit it from the import — just add `flushDirtyPerfCache` alongside the remaining imports.)

- [ ] **Step 2: Add the flush interval inside the `.listen` callback**

Find the `.listen(PORT, () => { ... })` callback. It currently contains (or a subset of, depending on whether remove-startup-backfills has run):

```ts
    ;(process as any).parentPort?.postMessage({ type: 'ready' })

    backfillDetailCaches(sendProgress).catch(err => console.warn('[backfill] failed:', (err as Error).message))
    fetchAndStoreItems().catch(err => console.warn('[meta] item seed failed:', (err as Error).message))
    refreshMetadata(champRef, augRef)
    setInterval(() => refreshMetadata(champRef, augRef), REFRESH_INTERVAL_MS)
```

Add the flush interval line after the existing `setInterval`:

```ts
    ;(process as any).parentPort?.postMessage({ type: 'ready' })

    backfillDetailCaches(sendProgress).catch(err => console.warn('[backfill] failed:', (err as Error).message))
    fetchAndStoreItems().catch(err => console.warn('[meta] item seed failed:', (err as Error).message))
    refreshMetadata(champRef, augRef)
    setInterval(() => refreshMetadata(champRef, augRef), REFRESH_INTERVAL_MS)
    setInterval(() => { flushDirtyPerfCache().catch(console.error) }, 60_000)
```

(If `backfillDetailCaches` and `sendProgress` have already been removed, just add the new `setInterval` line alongside the remaining ones.)

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/backend/server-entry.ts
git commit -m "feat: flush dirty perf cache on 60s interval in server-entry"
```

---

### Task 3: Update `syncWorker` to recalc only the current player's Elo

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Change the `recomputeAffectedElo` call**

In `src/main/index.ts`, find this block inside `syncWorker` (around line 364):

```ts
          await apiClient.completeJob(puuid)
          if (imported > 0 && affectedPuuids.length > 0) {
            apiClient.recomputeAffectedElo(affectedPuuids).catch(() => {})
          }
```

Change it to:

```ts
          await apiClient.completeJob(puuid)
          if (imported > 0) {
            await apiClient.recomputeAffectedElo([puuid]).catch(() => {})
          }
```

Two changes: `affectedPuuids` → `[puuid]` (single player only), and `apiClient...catch(() => {})` is now awaited (no longer fire-and-forget). The `affectedPuuids.length > 0` guard is dropped — if `imported > 0`, there are always games and therefore always a valid puuid.

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors. (`affectedPuuids` is still used elsewhere in `syncWorker` for the `importGamesForPuuid` return value — this change only touches one call site.)

- [ ] **Step 3: Run the full test suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```
git add src/main/index.ts
git commit -m "perf: recompute elo for current player only during sync, await result"
```

---

## Notes

**Crash recovery:** The spec originally noted that startup backfills in `initDb` would recover a missing performance cache after a crash. If the `remove-startup-backfills` plan has been executed, that automatic recovery is gone. After a server crash mid-sync, any `(gameVersion, queueId)` pairs that were marked dirty but not yet flushed will have no cache entry until manually rebuilt:

```
node scripts/rebuild-caches.mjs --caches=performance
```

---

## Self-Review

**Spec coverage:**
- ✅ Elo: single PUUID instead of ~200, awaited → Task 3
- ✅ Perf cache: immediate DELETE on insert → Task 1 Step 4
- ✅ Perf cache: `markPerfDirty` instead of fire-and-forget rebuild → Task 1 Steps 3–4
- ✅ `flushDirtyPerfCache` 60s interval in server-entry → Task 2
- ✅ `dirtyPerfPairs` Set, `markPerfDirty`, `flushDirtyPerfCache` exports → Task 1 Step 3
- ✅ No new routes needed (confirmed: existing `/api/players/elo/recompute-affected` handles single-element arrays)
- ✅ Crash recovery note updated to reflect remove-startup-backfills plan

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:** `markPerfDirty(gameVersion: string, queueId: number)` defined in Task 1 Step 3, called in Task 1 Step 4 with `(gv, qId)` (matching types). `flushDirtyPerfCache()` defined in Task 1 Step 3, imported and used in Task 2 Step 1–2.

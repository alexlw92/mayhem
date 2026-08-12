# Async Match Ingest Design

**Date:** 2026-08-12
**Status:** Approved

---

## Problem

`POST /api/matches/bulk` blocks until `insertMatches()` completes — a full multi-table transaction that takes >30s on EC2 under heavy load (19K-player queue). The Electron worker waits for `{ inserted: N }` before moving to the next player, creating a bottleneck that also triggers axios timeouts.

---

## Goal

Make `POST /api/matches/bulk` ack immediately. Process match data in a background two-queue pipeline that deduplicates cheaply (read-only SELECT) before doing the heavier write transaction.

---

## Design

### Two-queue pipeline

```
POST /api/matches/bulk
  → ingestQueue.push(batch) → { queued: N }   ← instant ack

Queue 1 (ingest) worker — runs serially:
  batch = ingestQueue.shift()
  existingIds = SELECT "gameId" FROM matches WHERE "gameId" = ANY(batch.gameIds)
  newMatches = batch.filter(m => !existingIds.has(m.gameId))
  if newMatches.length > 0: insertQueue.push(...newMatches)
  trigger Queue 2 worker if not running

Queue 2 (insert) worker — runs serially:
  allNew = insertQueue.splice(0, insertQueue.length)   ← drain everything at once
  await insertMatches(allNew)                           ← one transaction
```

**Why drain Queue 2 all at once:** if Queue 1 deduped 3 batches before Queue 2 fires, all their new games merge into one insert transaction instead of three. Fewer round-trips, less lock contention.

**Error handling:** each worker catches and logs per-batch errors, then continues. A failed batch is silently dropped — the Electron worker will re-fetch those games on the next sync cycle.

**Worker self-scheduling:** workers use a `running` boolean flag. A worker sets it on entry, loops while the queue has items, then clears it. A new enqueue triggers a fresh worker run if none is already running.

---

## Response contract change

`{ inserted: N }` → `{ queued: N }` where N = games received (batch.length), not deduped count.

The caller (`sync.ts`) accumulates `imported += queued`. This slightly overestimates for re-syncs (counts dupes that Queue 1 will filter). Accepted trade-off: `recordSyncResult` may show `+5 games` when 2 were dupes; `recomputeAffectedElo` fires even on all-dupe batches (no-op).

---

## Files

### New: `src/backend/matchQueue.ts`

Owns the two queues and both worker functions. Exports one function:

```typescript
export function enqueueMatches(batch: Match[]): number
```

Returns `batch.length` (the `queued` count sent back to the client).

Imports `getExistingMatchIds` and `insertMatches` from `./db`.

### Modify: `src/backend/db.ts`

Add one new exported function (read-only, no transaction):

```typescript
export async function getExistingMatchIds(gameIds: number[]): Promise<Set<number>> {
  if (gameIds.length === 0) return new Set()
  const rows = await sql_<{ gameId: number }[]>`
    SELECT "gameId" FROM matches WHERE "gameId" = ANY(${gameIds})
  `
  return new Set(rows.map(r => Number(r.gameId)))
}
```

No other changes to `db.ts` — `insertMatches`, `pendingMatchCount`, and `refreshAllMatviews` are all unchanged.

### Modify: `src/backend/routes/sync.ts`

`POST /api/matches/bulk` handler:

```typescript
// before
const inserted = await insertMatches(matches)
res.json({ inserted })

// after
import { enqueueMatches } from '../matchQueue'
const queued = enqueueMatches(matches)
res.json({ queued })
```

### Modify: `src/main/apiClient.ts`

```typescript
// before
insertMatches: (matches: Match[]): Promise<{ inserted: number }>
  => http.post('/api/matches/bulk', { matches }, { timeout: 120_000 }).then(r => r.data)

// after
insertMatches: (matches: Match[]): Promise<{ queued: number }>
  => http.post('/api/matches/bulk', { matches }, { timeout: 30_000 }).then(r => r.data)
```

Note: timeout drops back to 30s — the server now acks immediately so 30s is more than enough.

### Modify: `src/main/sync.ts`

```typescript
// before
const { inserted } = await apiClient.insertMatches(toInsert.slice(i, i + BATCH_SIZE))
imported += inserted

// after
const { queued } = await apiClient.insertMatches(toInsert.slice(i, i + BATCH_SIZE))
imported += queued
```

### Modify: `src/main/__tests__/importGames.test.ts`

Update all mock return values and assertions:
- `vi.mocked(apiClient.insertMatches).mockResolvedValue({ inserted: N })` → `{ queued: N }`
- `expect(result.imported).toBe(1)` logic unchanged (queued count = batch size in tests)

---

## Tests

### New: `src/backend/__tests__/matchQueue.test.ts`

Uses a real test DB (same pattern as `queue.test.ts`).

```typescript
describe('enqueueMatches', () => {
  it('returns batch.length immediately', () => {
    const count = enqueueMatches([makeMatch(1)])
    expect(count).toBe(1)
  })
})

describe('Queue 1 worker', () => {
  it('filters out matches already in DB before pushing to insert queue', async () => {
    await insertMatches([makeMatch(1)])       // seed game 1 as existing
    enqueueMatches([makeMatch(1), makeMatch(2)])
    await drainForTest()                      // exported test helper that awaits full drain
    // game 1 was duplicate — only game 2 should have been inserted
    expect(await matchCount()).toBe(2)        // 1 seeded + 1 new
  })

  it('pushes nothing to Queue 2 when all games are duplicates', async () => {
    await insertMatches([makeMatch(1)])
    enqueueMatches([makeMatch(1)])
    await drainForTest()
    expect(await matchCount()).toBe(1)        // no new insert
  })
})

describe('Queue 2 worker', () => {
  it('drains all accumulated new games in one call when Queue 1 enqueues multiple batches', async () => {
    enqueueMatches([makeMatch(1)])
    enqueueMatches([makeMatch(2)])
    enqueueMatches([makeMatch(3)])
    await drainForTest()
    expect(await matchCount()).toBe(3)
  })
})
```

`drainForTest()` is exported only in test environments — returns a Promise that resolves after both queues are empty and workers have stopped. Implemented by polling `ingestQueue.length === 0 && insertQueue.length === 0 && !q1Running && !q2Running` with `setImmediate` yields.

---

## Success Criteria

1. `POST /api/matches/bulk` returns within 50ms regardless of batch size
2. All matches eventually appear in the DB (no silent drops under normal conditions)
3. Duplicate games never produce duplicate rows in `participants`
4. `npm test` passes — including updated `importGames.test.ts` and new `matchQueue.test.ts`
5. Axios timeout on `insertMatches` reduced from 120s back to 30s
6. Sync log `gamesImported` shows count ≥ actual new games (slight overcount for re-syncs is acceptable)

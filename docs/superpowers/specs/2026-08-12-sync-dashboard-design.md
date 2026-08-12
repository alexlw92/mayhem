# Sync Dashboard Design

**Date:** 2026-08-12
**Status:** Approved

---

## Goal

Add a Sync page to the main navigation that gives full visibility into the sync queue, worker activity, matview processing state, and historical sync results — with controls to start/pause sync, clear the queue, and force a matview refresh.

---

## Context

The sync system works as follows:

- Players are enqueued in `sync_queue` (PostgreSQL). Workers claim jobs via `claimNextJob`, fetch match history from the LCU, insert games via `POST /api/matches/bulk`, and report completion via `completeJob` / `failJob`.
- After each insertion, `refreshAllMatviews()` runs fire-and-forget, refreshing 6 materialized views and rebuilding `player_performance_cache`.
- Currently there is no persistent record of completed or failed syncs, and no UI page dedicated to sync management.

---

## Data Layer

### New table: `sync_log`

```sql
CREATE TABLE sync_log (
  id            BIGSERIAL PRIMARY KEY,
  puuid         TEXT NOT NULL,
  summoner_name TEXT NOT NULL DEFAULT '',
  games_imported INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  error         TEXT,        -- NULL = success
  synced_at     BIGINT NOT NULL
)
CREATE INDEX idx_sync_log_synced_at ON sync_log (synced_at DESC)
```

Pruned to the last 1,000 rows on each insert: after inserting a row, delete any rows beyond the most recent 1,000 (ordered by `synced_at DESC`).

### New DB functions in `db.ts`

**`recordSyncResult({ puuid, summonerName, gamesImported, durationMs, error? }): Promise<void>`**
Inserts one row into `sync_log` then prunes old rows. Fire-and-forget safe — never throws.

**`getSyncLog(limit: number): Promise<SyncLogEntry[]>`**
Returns the most recent `limit` rows from `sync_log` ordered by `synced_at DESC`.

**`getNextQueuedPlayers(limit: number): Promise<QueuedPlayer[]>`**
```sql
SELECT sq.puuid, sq.queued_at, sq.priority, sq.claimed_by,
  COALESCE(MAX(psc."summonerName"), sq.puuid) AS name
FROM sync_queue sq
LEFT JOIN player_stats_cache psc ON psc.puuid = sq.puuid
GROUP BY sq.puuid, sq.queued_at, sq.priority, sq.claimed_by
ORDER BY sq.priority DESC, sq.queued_at ASC
LIMIT $limit
```

### New module-level tracking in `db.ts`

```typescript
let pendingMatchCount = 0

export function getPendingMatchCount(): number { return pendingMatchCount }
```

- `pendingMatchCount` increments by `insertedCount` in `insertMatches` after each successful bulk insert.
- Reset to `0` at the end of `refreshAllMatviews` (after all views and caches are rebuilt).

---

## Backend Endpoints

All new routes added to `src/backend/routes/sync.ts`.

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/sync/queue/players?limit=20` | Next N queued players with names. 5s LRU cache. |
| `GET` | `/api/sync/log?limit=100` | Recent sync log entries, newest first. No cache. |
| `POST` | `/api/sync/log` | Record one sync result. Body: `{ puuid, summonerName, gamesImported, durationMs, error? }` |
| `POST` | `/api/sync/refresh` | Trigger `refreshAllMatviews()` fire-and-forget. Returns `{ ok: true }` immediately. |

**Extend `GET /api/metrics`** (in `src/backend/metrics.ts` + `src/backend/db.ts`):

Add to `MetricsSnapshot`:
```typescript
matviewRefreshInProgress: boolean   // _refreshPromise !== null
pendingMatchCount: number            // matches inserted since last refresh
```

Add to `getMetrics()` return value:
```typescript
matviewRefreshInProgress: isRefreshInProgress(),
pendingMatchCount: getPendingMatchCount(),
```

Export `isRefreshInProgress(): boolean` from `db.ts` (returns `_refreshPromise !== null`).

---

## Main Process

### `src/main/apiClient.ts` — new methods

```typescript
recordSyncResult(entry: {
  puuid: string; summonerName: string; gamesImported: number;
  durationMs: number; error?: string
}): Promise<void>
  → POST /api/sync/log

nextQueuedPlayers(limit: number): Promise<QueuedPlayer[]>
  → GET /api/sync/queue/players?limit=N

syncLog(limit: number): Promise<SyncLogEntry[]>
  → GET /api/sync/log?limit=N

forceRefresh(): Promise<{ ok: boolean }>
  → POST /api/sync/refresh
```

### `src/main/index.ts` — record sync results

After each successful player sync (currently calls `completeJob`), add:

```typescript
const durationMs = Date.now() - jobStartTime
apiClient.recordSyncResult({
  puuid, summonerName: name, gamesImported: imported, durationMs
}).catch(() => {})
```

After each failed sync (currently calls `failJob`), add:

```typescript
apiClient.recordSyncResult({
  puuid, summonerName: name ?? '', gamesImported: 0, durationMs: 0,
  error: err.message
}).catch(() => {})
```

`jobStartTime` is recorded when `claimNextJob` returns a puuid.

---

## Preload / IPC

### `src/preload/index.ts` — new `sync` namespace

```typescript
sync: {
  queueStatus:  ()            => ipcRenderer.invoke('sync:queueStatus'),
  nextPlayers:  (limit: number) => ipcRenderer.invoke('sync:nextPlayers', limit),
  log:          (limit: number) => ipcRenderer.invoke('sync:log', limit),
  clearQueue:   ()            => ipcRenderer.invoke('sync:clearQueue'),
  forceRefresh: ()            => ipcRenderer.invoke('sync:forceRefresh'),
}
```

### `src/main/index.ts` — new IPC handlers

```typescript
ipcMain.handle('sync:queueStatus',  () => apiClient.queueStatus())
ipcMain.handle('sync:nextPlayers',  (_, limit) => apiClient.nextQueuedPlayers(limit))
ipcMain.handle('sync:log',          (_, limit) => apiClient.syncLog(limit))
ipcMain.handle('sync:clearQueue',   () => apiClient.clearQueue())
ipcMain.handle('sync:forceRefresh', () => apiClient.forceRefresh())
```

---

## Frontend

### `src/renderer/src/App.tsx`

- Add `'sync'` to the `Page` type union.
- Add nav item: icon `⟳`, label `Sync`.
- Render `<Sync syncing={syncing} stopping={stopping} />` in the content area when `page === 'sync'`. Pass `syncing` and `stopping` as props so the page's Start/Pause buttons reflect the same state as the sidebar controls.

### `src/renderer/src/pages/Sync.tsx` (new file)

Polls every 5 seconds via `setInterval` fetching:
- `api.sync.queueStatus()` → `{ total, claimed }`
- `api.sync.nextPlayers(20)` → queued player list
- `api.sync.log(100)` → recent activity log
- `api.metrics.get()` → `{ matviewLastRefreshMs, matviewRefreshInProgress, pendingMatchCount, ... }`

**Layout:**

```
[▶ Start Sync]  [⏸ Pause Sync]  [✕ Clear Queue]  [↺ Force Refresh]

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ QUEUE            │  │ IN PROGRESS      │  │ MATVIEW REFRESH      │
│ 47 players       │  │ 3 active         │  │ last: 1,243ms        │
│                  │  │                  │  │ ● refreshing         │
│                  │  │                  │  │ 18 unprocessed       │
└──────────────────┘  └──────────────────┘  └──────────────────────┘

NEXT UP
★  Azael#NA1           priority    queued 2m ago
   Doublelift#NA1                  queued 5m ago   ● syncing
   Sneaky#NA1                      queued 8m ago
   ...

RECENT ACTIVITY
✓  Doublelift#NA1    +12 games   823ms    2m ago
✗  Sneaky#NA1        fetch failed          5m ago
✓  Azael#NA1         +0 games    412ms    8m ago
```

**Button states:**
- **Start Sync** — calls `api.lcu.sync()`; disabled when syncing or client offline.
- **Pause Sync** — calls `api.lcu.stopSync()`; disabled when not syncing; shows "Stopping…" while in-flight.
- **Clear Queue** — calls `api.sync.clearQueue()`; disabled when `total === 0`; requires confirm prompt; "Next up" list clears immediately on confirm.
- **Force Refresh** — calls `api.sync.forceRefresh()`; disabled while `matviewRefreshInProgress` is true.

**Unprocessed count color coding:**
- `0` → green (`var(--green)` or accent)
- `1–50` → amber
- `> 50` → red

**Next up list:**
- `★` prefix for `priority > 0` rows
- `● syncing` indicator for rows where `claimedBy` is non-null
- Shows `name` (from LEFT JOIN) or falls back to shortened `puuid` if name unknown

**Recent activity log:**
- Success rows: `✓` green, shows player name, `+N games`, duration, time ago
- Error rows: `✗` red, shows player name, error message, time ago (no duration)

---

## Success Criteria

1. Sync page appears in the nav and renders without errors
2. Queue count, in-progress count, and next-up list update every 5 seconds
3. Recent activity log persists across backend restarts
4. Start Sync / Pause Sync buttons match sidebar sync state
5. Clear Queue empties the next-up list immediately and resets queue count to 0
6. Force Refresh triggers a matview refresh; `matviewRefreshInProgress` shows true while running, `lastRefreshMs` updates when done
7. `pendingMatchCount` increments after `insertMatches`, resets to 0 after refresh
8. Sync errors appear in the activity log with the error message

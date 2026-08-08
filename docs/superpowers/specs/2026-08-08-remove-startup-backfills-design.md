# Remove Startup Backfills

**Date:** 2026-08-08

## Goal

Remove all data backfills from server startup and the Electron main process. All historical cache rebuilds become opt-in scripts. The app starts faster and startup behavior is predictable. Dead code from the progress-reporting pipeline is deleted.

## What Stays on Startup

- All DDL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`) in `initDb` — required for fresh installs and schema migrations on upgrade
- `fetchAndStoreItems()` in `server-entry.ts` — live metadata sync from CDragon, not a historical backfill
- `refreshMetadata()` in `server-entry.ts` — live champion/augment metadata sync
- `repairIncompleteMatches()` in `main/index.ts` — requires LCU client, can't be a standalone script

## What Gets Removed from Startup

### `src/backend/db.ts` — `initDb`

Remove `onProgress` parameter. Remove six data-fill blocks (DDL untouched):

1. `participant_item_sets` fill — gated on `!hasCol('participant_item_sets', 'itemIds')`
2. `champion_stats_cache` + `augment_stats_cache` rebuild — gated on `COUNT(*) = 0`
3. `player_stats_cache` per-patch fill — fills missing patches
4. `player_champion_stats_cache` per-patch fill — fills missing patches
5. `player_performance_cache` per-patch fill — fills missing patch-queue pairs
6. `item_builds_cache` + `item_picks_cache` async IIFE — fills missing patches

Delete the `backfillDetailCaches` export — its logic moves to the script.

The `needsChampCacheRebuild` and `needsPCSRebuild` TRUNCATE blocks stay in `initDb` — they're schema-migration guards (truncate on column addition), not data backfills.

### `src/backend/server-entry.ts`

- Remove `backfillDetailCaches` import
- Remove `sendProgress` function
- Remove `backfillDetailCaches(sendProgress)` call after server ready
- Remove `sendProgress` argument from `initDb(undefined, sendProgress)` call

### `src/main/index.ts`

- Remove the `backfill-progress` branch in `backendProcess.on('message')` handler

### `src/renderer/src/App.tsx` + `App.css`

- Remove `backfillPhase` state, its IPC listener (`api.on('backfill-progress', ...)`), and `unsubBackfill` from cleanup
- Remove `backfillPhase` label in loading screen
- Remove `<div className="sidebar-backfill">` widget in sidebar
- Remove `.sidebar-backfill` and `.sidebar-backfill-dot` CSS rules

## New Script: `scripts/rebuild-caches.mjs`

Single script following the existing `.mjs` pattern (createRequire + dotenv + postgres). Covers all cache types from the removed startup blocks plus `backfillDetailCaches`.

### Usage

```
node scripts/rebuild-caches.mjs
node scripts/rebuild-caches.mjs --caches=summary,players
node scripts/rebuild-caches.mjs --caches=items
```

### Cache targets (run in this order by default)

| Flag value | Cache tables |
|---|---|
| `summary` | `champion_stats_cache`, `augment_stats_cache` |
| `players` | `player_stats_cache` |
| `player-champions` | `player_champion_stats_cache` |
| `performance` | `player_performance_cache` |
| `items` | `item_builds_cache`, `item_picks_cache` |
| `augment-champions` | `augment_champion_stats_cache` |

Each section is idempotent — checks existing patches before inserting, safe to re-run. The `participant_item_sets` one-time fill is also included (gated on missing rows, consistent with the old column-detection gate).

### Dependency order

`summary` and `players` have no dependencies. `player-champions` must run before `performance` (performance cache reads from player_champion_stats_cache). `items` and `augment-champions` are independent of each other but both depend on raw participant data existing.

## Files Changed

| File | Change |
|---|---|
| `src/backend/db.ts` | Remove 6 data-fill blocks + `backfillDetailCaches` fn + `onProgress` param |
| `src/backend/server-entry.ts` | Remove `sendProgress`, `backfillDetailCaches` import/call |
| `src/main/index.ts` | Remove `backfill-progress` IPC branch |
| `src/renderer/src/App.tsx` | Remove `backfillPhase` state, listener, two render sites |
| `src/renderer/src/App.css` | Remove `.sidebar-backfill` + `.sidebar-backfill-dot` rules |
| `scripts/rebuild-caches.mjs` | New file |

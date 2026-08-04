# Design: Elo K-Factor Increase + Sync-All Button

**Date:** 2026-08-03
**Branch:** feature/multi-mode-tracking

---

## Overview

Two small, independent changes:

1. Raise the elo K-factor from 32 to 128 so ratings converge faster and reflect recent performance more strongly.
2. Add a context-aware "Sync Visible" button to the Players page that queues the currently displayed player list for priority sync.

---

## 1. Elo K-Factor Change

### Change

In `src/backend/db.ts`, update the module-level constant:

```ts
const ELO_K = 128  // was 32
```

`ELO_K` is used in both `updateElo` and `recomputePlayerElo`. No other code changes are needed.

### Post-deploy step

Because existing `elo_history` and `player_elo` rows were computed with K=32, they are on an incompatible scale. After the code change is deployed, run:

```
npm run db:recalculate-elo
```

This wipes `elo_history` and `player_elo` for queues 2400 and 2450, then recomputes from all historical games using K=128.

---

## 2. Sync-All Button

### Location

Players page (`src/renderer/src/pages/Players.tsx`), in the toolbar next to the "Recent / Leaderboard" tab switcher.

### Label

Adapts to the active tab:
- Leaderboard tab active → **"Sync Leaderboard"**
- Recent tab active → **"Sync Recent Players"**

### Behavior

On click:
1. Collect all `puuid` values from the currently loaded player list (leaderboard rows or recent rows, whichever is active).
2. Call the existing `lcu:syncCurrentGame` IPC handler with that puuid array.
   - This calls `enqueuePriority(puuids)` on the backend, which pushes them to the front of the sync queue.
   - If the sync worker is idle, it starts processing immediately.

### Disabled state

The button is disabled when `syncStatus.syncing === true` (a sync is already in progress), preventing double-clicks mid-sync.

### No new backend routes or IPC handlers

Fully reuses the existing `lcu:syncCurrentGame` → `enqueuePriority` → sync worker path.

---

## Testing

- **K-factor**: No unit tests needed — the constant change is covered by existing elo tests which verify the formula, not a specific K value. Run `npm run db:recalculate-elo` manually on the real DB after deploy.
- **Sync-all button**: Manual verification — click button on leaderboard tab, confirm players enter sync queue and sync worker starts. Verify button is disabled while sync runs.

---

## Out of Scope

- Dynamic K-factor (e.g. higher K for new players) — not needed
- Button that syncs both lists simultaneously — user prefers view-scoped sync
- Progress indicator specific to this button — existing sync progress UI covers it

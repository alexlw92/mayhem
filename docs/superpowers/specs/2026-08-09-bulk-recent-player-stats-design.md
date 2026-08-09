# Design: Bulk fetch stats for Recent Players list

## Context

The Recent Players page mounts one `RecentPlayerCard` per entry (up to 10). Each card fires its own `api.db.playerOneStats` call on mount and on every patch/mode filter change — so a filter change triggers up to 10 simultaneous IPC → HTTP → DB round-trips. `getBulkPlayerStats` / `POST /api/players/bulk-stats` already exists and uses a single `WHERE puuid = ANY(...)` query; `CurrentGame.tsx` already uses it. The fix is to lift the fetch to `PlayerList` and pass stats down as props.

---

## Design

### DB layer — `src/backend/db.ts`

`getBulkPlayerStats` currently hardcodes `syncedAt: 0`. The Recent Player cards show "synced Xh ago", so we need real values.

Add to both SQL variants (patches and no-patches):
- `LEFT JOIN player_sync_times pst ON pst.puuid = pc.puuid`
- `COALESCE(MAX(pst."syncedAt"), 0) AS "syncedAt"` in the SELECT

Update result mapping: `syncedAt: Number(r.syncedAt ?? 0)` (replacing hardcoded `0`).

No route change — `POST /players/bulk-stats` passes through unchanged.

### Frontend — `src/renderer/src/pages/Players.tsx`

**`PlayerList`:**

Add `statsMap: Record<string, PlayerStats>` state (initially `{}`).

Add a `useEffect` dependent on `[recents, selectedPatches, selectedMode]`:
- Skip if `recents.length === 0` or `selectedPatches === null`
- Call `api.db.playerBulkStats(recents.map(r => r.puuid), selectedPatches, selectedMode ?? 2400)`
- Store result in `statsMap`

Pass `stats={statsMap[r.puuid] ?? null}` to each `RecentPlayerCard`.

**`RecentPlayerCard`:**

- Remove the `useEffect` that calls `playerOneStats` on mount — no longer needed
- Add `stats: PlayerStats | null` prop
- Keep internal `[localStats, setLocalStats]` state; initialize from `stats` prop
- Add `useEffect([stats prop])` to sync local state when the prop updates (patch/mode changes)
- Post-sync path unchanged: calls `playerOneStats` individually and calls `setLocalStats` with the fresh result

**UX:** all cards transition from "Loading…" to loaded simultaneously (one response) instead of staggering per-card. Slightly better than the current behaviour.

---

## Files changed

| File | Change |
|------|--------|
| `src/backend/db.ts` | Add `syncedAt` join to both `getBulkPlayerStats` SQL variants; update result mapping |
| `src/renderer/src/pages/Players.tsx` | Lift fetch to `PlayerList`; `RecentPlayerCard` receives stats as prop |

---

## Verification

1. Open the Recent Players page with 10 recents and a patch filter — confirm one network call instead of 10 (check DevTools or metrics panel)
2. Change the patch/mode filter — confirm cards refresh together and "synced Xh ago" displays correctly
3. Manually sync a card — confirm it refreshes individually and shows updated stats
4. Run `npm test` — all tests pass

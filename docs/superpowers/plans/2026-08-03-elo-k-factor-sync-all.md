# Elo K-Factor Increase + Sync-All Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise elo K from 32 to 128 and add a context-aware "Sync Visible" button to the Players page that queues the currently displayed list for priority sync.

**Architecture:** Two independent changes — a one-line constant change in the backend plus a UI addition in the renderer. The sync-all button lifts leaderboard puuids up from `EloLeaderboard` to `PlayerList` via a callback prop, then calls the existing `lcu:syncCurrentGame` IPC handler (which calls `enqueuePriority` + starts the sync worker).

**Tech Stack:** TypeScript, React (renderer), postgres.js (backend), Electron IPC

---

## File Map

| File | Change |
|------|--------|
| `src/backend/db.ts` | Change `ELO_K` constant from 32 to 128 |
| `src/renderer/src/pages/Players.tsx` | Add `onDataLoaded` prop to `EloLeaderboard`; add sync-all button + state to `PlayerList` |

---

### Task 1: Change ELO_K to 128

**Files:**
- Modify: `src/backend/db.ts` (line ~2189)

- [ ] **Step 1: Change the constant**

In `src/backend/db.ts`, find:
```typescript
const ELO_K = 32
```
Replace with:
```typescript
const ELO_K = 128
```

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
npx vitest run
```
Expected: all tests pass (elo tests verify formula shape, not a specific K value).

- [ ] **Step 3: Commit**

```bash
git add src/backend/db.ts
git commit -m "feat: raise elo K-factor from 32 to 128"
```

- [ ] **Step 4: Run the recompute script**

After deploying this change to the running app, run:
```bash
npm run db:recalculate-elo
```
This wipes `elo_history` and `player_elo` for queues 2400 and 2450, then recomputes all historical elo at K=128. Takes ~15 minutes on the remote DB.

---

### Task 2: Add sync-all button to Players page

**Files:**
- Modify: `src/renderer/src/pages/Players.tsx`

#### Step 1: Add `onDataLoaded` prop to `EloLeaderboard`

- [ ] **Update the `EloLeaderboard` function signature**

Find (line ~538):
```typescript
function EloLeaderboard({ selectedMode, onPlayerSelect }: { selectedMode?: number; onPlayerSelect: (puuid: string, name: string) => void }) {
  const [data, setData] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.db.eloLeaderboard(selectedMode ?? 2400)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [selectedMode])
```

Replace with:
```typescript
function EloLeaderboard({ selectedMode, onPlayerSelect, onDataLoaded }: {
  selectedMode?: number
  onPlayerSelect: (puuid: string, name: string) => void
  onDataLoaded?: (puuids: string[]) => void
}) {
  const [data, setData] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.db.eloLeaderboard(selectedMode ?? 2400)
      .then(rows => { setData(rows); onDataLoaded?.(rows.map(r => r.puuid)) })
      .catch(() => { setData([]); onDataLoaded?.([]) })
      .finally(() => setLoading(false))
  }, [selectedMode])
```

#### Step 2: Add state and handler to `PlayerList`

- [ ] **Add `leaderboardPuuids` and `syncingAll` state**

In the `PlayerList` function body (after the existing state declarations around line ~303), add:
```typescript
const [leaderboardPuuids, setLeaderboardPuuids] = useState<string[]>([])
const [syncingAll, setSyncingAll] = useState(false)
```

- [ ] **Add `handleSyncAll` callback**

After `handleAddPlayer` (around line ~374), add:
```typescript
const handleSyncAll = useCallback(async () => {
  const puuids = view === 'leaderboard' ? leaderboardPuuids : recents.map(r => r.puuid)
  if (puuids.length === 0) return
  setSyncingAll(true)
  try {
    await api.lcu.syncCurrentGame(puuids)
  } finally {
    setSyncingAll(false)
  }
}, [view, leaderboardPuuids, recents])
```

#### Step 3: Add the button to the toolbar

- [ ] **Update the tab switcher div**

Find (line ~387):
```typescript
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <button className={`mode-btn${view === 'recent' ? ' active' : ''}`} onClick={() => setView('recent')}>Recent</button>
        <button className={`mode-btn${view === 'leaderboard' ? ' active' : ''}`} onClick={() => setView('leaderboard')}>Leaderboard</button>
      </div>
```

Replace with:
```typescript
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, alignItems: 'center' }}>
        <button className={`mode-btn${view === 'recent' ? ' active' : ''}`} onClick={() => setView('recent')}>Recent</button>
        <button className={`mode-btn${view === 'leaderboard' ? ' active' : ''}`} onClick={() => setView('leaderboard')}>Leaderboard</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSyncAll}
          disabled={syncingAll || (view === 'leaderboard' ? leaderboardPuuids.length === 0 : recents.length === 0)}
          style={{ padding: '4px 12px', background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: syncingAll ? 0.5 : 1 }}
        >
          {syncingAll ? 'Queued…' : view === 'leaderboard' ? 'Sync Leaderboard' : 'Sync Recent Players'}
        </button>
      </div>
```

#### Step 4: Wire `onDataLoaded` into `EloLeaderboard`

- [ ] **Pass the callback**

Find (line ~392):
```typescript
      {view === 'leaderboard' ? (
        <EloLeaderboard selectedMode={selectedMode} onPlayerSelect={(puuid, name) => {
```

Replace with:
```typescript
      {view === 'leaderboard' ? (
        <EloLeaderboard selectedMode={selectedMode} onDataLoaded={setLeaderboardPuuids} onPlayerSelect={(puuid, name) => {
```

#### Step 5: Type-check and commit

- [ ] **Run type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Commit**

```bash
git add src/renderer/src/pages/Players.tsx
git commit -m "feat: add sync-all button to Players page leaderboard and recent views"
```

#### Step 6: Manual verification

- [ ] Open the app and navigate to the Players page
- [ ] Switch to **Leaderboard** tab — confirm "Sync Leaderboard" button appears on the right of the toolbar, disabled until data loads
- [ ] Click "Sync Leaderboard" — button shows "Queued…" briefly, then returns to normal; sync worker starts in the background
- [ ] Switch to **Recent Players** tab — confirm button label changes to "Sync Recent Players"
- [ ] Click "Sync Recent Players" — same behavior
- [ ] Confirm button is disabled when the list is empty (no recents / no leaderboard data)

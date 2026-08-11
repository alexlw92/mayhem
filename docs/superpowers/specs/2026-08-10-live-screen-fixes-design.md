# Design: Live Screen fixes — stale state between games + OCR toggle

## Context

`CurrentGame.tsx` has three bugs that all share the same root cause: game-specific state is never reset when a new game starts. State only resets when `selectedPatches` changes. Additionally, `selectedMode` is missing from the main polling `useEffect`'s dependency array, so mode changes don't take effect until patches change.

Bug 1 — **wrong item builds**: `myChampId` briefly shows the previous game's champion during the transition into a new ChampSelect (LCU returns stale participant data for 1–2 polls). Items renders with the wrong champion ID.

Bug 2 — **OCR augments not showing stats**: `champAugStats` is stale from the previous game when OCR scans during the new game's InProgress, causing `find(s => s.augmentId === id)` to return undefined → `—` for all stat columns.

Bug 3 — **player cards outdated**: `fetchedPuuidsRef` gates player stat fetches to "first time seen per session". Returning players in game 2 are already in the ref → `newPuuids` is empty → `playerBulkStats` is never called → cards show game 1's stats.

Additionally, OCR runs unconditionally during InProgress and is CPU-intensive. Users need a way to disable it per session.

---

## Design

### Bug fixes — `src/renderer/src/pages/CurrentGame.tsx`

**State reset on new ChampSelect entry:**

Inside the polling `async function poll()`, immediately after the existing ChampSelect sync block (the `hasSyncedChampSelectRef` guard), add:

```typescript
if (prevPhase !== 'ChampSelect' && currentPhase === 'ChampSelect') {
  fetchedPuuidsRef.current = new Set()
  setPlayerStats({})
  setChampionStats({})
  setChampAugStats(null)
}
```

This fires exactly once per new game. Co-located with the existing ChampSelect sync logic. The reset happens before the `newPuuids` detection block in the same poll, so all current participants are immediately re-added to `fetchedPuuidsRef` and a fresh `playerBulkStats` call fires. By the time `sync-progress` events arrive, the puuids are already in the ref — no race condition.

**Fix missing `selectedMode` dep:**

- Main polling `useEffect`: change `}, [selectedPatches])` → `}, [selectedPatches, selectedMode])`
- `sync-progress` handler `useEffect`: same change — `}, [selectedPatches])` → `}, [selectedPatches, selectedMode])`

### OCR toggle — `src/renderer/src/pages/CurrentGame.tsx`

Add state:
```typescript
const [ocrEnabled, setOcrEnabled] = useState(false)
```

Update the OCR `useEffect`: add `ocrEnabled` as a second early-exit condition alongside `phase !== 'InProgress'`. When `ocrEnabled` is false, run the same cleanup already done for the non-InProgress case (clear `scannedAugIds`, `ocrDebugText`, `ocrScreenshot`) and return. Add `ocrEnabled` to the effect's deps array.

Add a toggle button inline with the "Augments on Screen" header, visible only during InProgress:
- Off state: "Enable OCR" 
- On state: "Disable OCR"

---

## Files changed

| File | Change |
|------|--------|
| `src/renderer/src/pages/CurrentGame.tsx` | Reset game state on ChampSelect entry; fix `selectedMode` deps; add OCR toggle |

---

## Verification

1. Play game 1 (champion X). After it ends, start game 2 (champion Y) — confirm item builds immediately show Y's data, not X's
2. Player cards in game 2 show fresh stats (not game 1's stats) for returning players
3. OCR augment stat columns populate correctly during InProgress (not all `—`)
4. Change mode filter mid-session — confirm player cards refresh with correct mode data
5. Toggle OCR off during InProgress — confirm scanning stops and CPU drops; toggle on — confirm scanning resumes
6. Run `npm test` — all tests pass

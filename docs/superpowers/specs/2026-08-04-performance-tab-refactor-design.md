# Design: Performance Tab Refactor

## Context

The `PerformancePanel` component currently renders inline above the tab buttons on the player detail page. This makes it awkward to scan — it's always visible and competes with the tab content below. The radar/spider chart for champion role win rate is also hard to read at a glance.

This refactor moves Performance into its own tab (alongside Matches, Champions, Augments, Coplayers, Elo) and replaces the radar chart with a horizontal stacked bar chart — wins segment over total games, win rate as a text label.

---

## Changes

### `src/renderer/src/pages/Players.tsx`

- Add `'performance'` to the `Tab` union type (line 91):
  ```typescript
  type Tab = 'matches' | 'champions' | 'augments' | 'coplayers' | 'elo' | 'performance'
  ```
- Add a "Performance" button to the tab row (alongside the existing 5 tabs).
- Add tab content block: `{tab === 'performance' && <PerformancePanel puuid={puuid} patches={selectedPatches} queueId={selectedMode ?? 2400} />}`
- Remove the existing inline `<PerformancePanel>` currently rendered above the tab buttons (around line 771).

### `src/renderer/src/pages/PerformancePanel.tsx`

**Remove:**
- `RadarChart` component (the SVG radar/spider chart)
- `ROLES` constant array (was used only for spoke ordering)
- The "Performance" section header `<div>` (redundant as a tab)

**Add:**
- `RoleBarChart` component. Renders one row per role class with data, sorted by games descending:
  - Left column: role name label (e.g. "Fighter"), fixed width
  - Middle: horizontal stacked bar
    - Wins segment: accent color, width = `(wins / maxGames) * 100%` where `maxGames` is the games count of the highest role
    - Losses segment: muted gray, width = `((games - wins) / maxGames) * 100%`
    - The total bar width for a role = `(games / maxGames) * 100%`
  - Right column: win rate label (e.g. "67%"), fixed width, right-aligned

**Keep unchanged:** `DeltaCard`, `PoolCard`, `PoolDepth`, the `useEffect` fetch logic, patch/queueId props.

---

## Patch Filtering

No change needed. `PerformancePanel` already receives `patches` as a prop and passes it to `api.db.playerPerformance`. Rendering it conditionally inside `{tab === 'performance' && ...}` means it remounts when the user switches to the tab, guaranteeing a fresh fetch for the active patch filter — identical behavior to the other tabs.

---

## No Backend Changes

Data model, API route, IPC bridge, and DB function are all untouched.

---

## Verification

1. Run `npm test` — 283 tests should pass with no regressions.
2. Start the app, select a synced player with game history.
3. Confirm "Performance" tab appears in the tab row and the inline panel above is gone.
4. Switch to Performance tab — 6 metric cards render, role bar chart renders below with stacked bars and win rate labels.
5. Switch patches — switch away from Performance tab, change patch filter, switch back. Data should reflect the new patch.
6. Player with only one role played — one bar row renders, no errors.
7. Player with no data — tab shows nothing (returns null on `poolUniqueChampions === 0`).

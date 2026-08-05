# Design: Performance Tab Updates

## Context

Three small improvements to the Performance tab on the player detail page:
1. Make Performance the landing tab instead of Matches
2. Show all 6 champion classes in the role bar chart, even with 0 games, with richer labels
3. Remove the "Top Champions" pool depth section (redundant noise)

---

## Changes

### `src/renderer/src/pages/Players.tsx`

Change the default tab state from `'matches'` to `'performance'`:

```typescript
// before
const [tab, setTab] = useState<Tab>('matches')

// after
const [tab, setTab] = useState<Tab>('performance')
```

Move `'performance'` to the front of the tab button array so it renders as the leftmost tab:

```typescript
// before
{(['matches', 'champions', 'augments', 'coplayers', 'elo', 'performance'] as Tab[]).map(...)}

// after
{(['performance', 'matches', 'champions', 'augments', 'coplayers', 'elo'] as Tab[]).map(...)}
```

### `src/renderer/src/pages/PerformancePanel.tsx`

**`RoleBarChart` — three updates:**

1. **Always render all 6 roles in fixed order**, regardless of whether the player has games on that class. The fixed order is `['Fighter', 'Mage', 'Assassin', 'Tank', 'Marksman', 'Support']`. For roles with 0 games: empty bar (no fill segments), `—` for rate, `0/0` for games count (both dimmed at 35% opacity).

2. **Label format (Option A):** right side of each row shows two columns — win rate (bold, right-aligned, 34px wide) and wins/games count (muted, 28px wide). Example: `67%  4/6`. Zero-game rows show `—` and `0/0`.

3. **Bar colors:** wins segment = `#4ecdc4` (teal), losses segment = `#7a3a40` (muted rose). The track background stays `var(--bg-tertiary, #1a1a2a)`.

The `buckets` prop still comes from `data.classBuckets` (unchanged backend). The component merges the fixed 6-role list with whatever buckets the API returns — roles with no bucket entry get `{ games: 0, wins: 0, winRate: 0 }`.

The `if (buckets.length === 0) return null` guard is removed — we always render the 6 rows.

**`PoolDepth` component — remove entirely:**

- Delete the `PoolDepth` function component
- Remove `<PoolDepth champions={data.poolTopChampions} />` from the return
- Remove the flex wrapper `<div style={{ display: 'flex', gap: 24, ... }}>` that grouped `RoleBarChart` and `PoolDepth` — replace with a plain `<div>`

The `poolTopChampions` field still comes back from the API (no backend change needed — unused fields are harmless).

---

## No Backend Changes

`getPlayerPerformance` is untouched. The `classBuckets` array continues to contain only roles the player has actually played — the frontend fills in the missing roles client-side.

---

## Verification

1. `npm test` — 283 tests pass.
2. Start the app, select a synced player. The Performance tab is active by default.
3. Performance tab shows 6 role rows always — zero-game roles show an empty bar with dimmed `—` and `0/0`.
4. Win segment is teal (`#4ecdc4`), loss segment is muted rose (`#7a3a40`).
5. "Top Champions" pool section is gone.
6. Switch to another tab and back — no regressions.

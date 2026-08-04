# Design: Player Performance Metrics

## Context

The player detail page currently shows aggregate stats (KDA, DPM, ELO history, champion table, augment table) but gives no sense of *how well* a player performs relative to expectations. This feature adds a Performance panel that answers: are they picking strong options, and are they executing those picks effectively? It surfaces signal that isn't visible from raw win rate or KDA alone.

---

## UI

A `PerformancePanel` component is added to the player detail view in `Players.tsx`, rendered when a player is selected. It has two rows.

**Row 1 — 6 metric cards:**

| Card | What it shows |
|------|--------------|
| Champion Pick Quality | Weighted avg global WR of champions they play, delta from 50% |
| Augment Pick Quality | Weighted avg global WR of augments they pick, delta from avg augment WR |
| KP% vs Expected | Player's kill participation % minus champion-weighted expected KP% |
| DPM vs Expected | Player's DPM minus champion-weighted expected DPM |
| GPM vs Expected | Player's gold/min minus champion-weighted expected GPM |
| Champion Pool | Unique champions played + top-3 concentration % (profile card, no delta) |

Delta cards show a +/− value. Positive deltas styled in green, negative in red, near-zero neutral.

**Row 2 — two panels:**

- **Radar / spider chart** — 6 spokes, one per champion class (Fighter, Mage, Assassin, Tank, Marksman, Support). Distance from center = win rate. Reference ring at 50%. Node size reflects games played on that class. Only classes with ≥1 game are shown; missing classes collapse the spoke to center. Implemented as inline SVG — no external chart library.

- **Pool depth detail** — Top 5 champions by games played, each with a thin bar showing their share of total games (e.g. Lux: ████░░ 18%). Complements the pool card.

---

## Data Model Changes

### 1. Champion tags in meta cache

`getChampionData()` in `src/main/lcu.ts` currently fetches Data Dragon `champion.json` and discards `tags`. Extend it to return `Record<number, { name: string; tags: string[] }>`. Update `src/main/meta.ts`:
- `MetaCache.champions` type changes from `Record<number, string>` to `Record<number, { name: string; tags: string[] }>`
- `getChampionCache()` return type updates accordingly
- Bump `META_VERSION` to invalidate stale caches

All consumers of `getChampionCache()` (primarily `meta.ts` route and `db.ts` display logic) updated to use `.name` where they previously used the string directly.

### 2. `champion_stats_cache` — two new columns

Add `total_team_kills BIGINT NOT NULL DEFAULT 0` and `total_gold BIGINT NOT NULL DEFAULT 0`.

These are needed for global champion KP% and GPM baselines. Without them, every performance page load would scan all 156K games.

`buildCacheForGames()` in `src/backend/db.ts` already accumulates kills/damage/duration per champion in a batch loop. Extend it to also accumulate:
- `total_team_kills`: for each game, compute team kills (sum of all 5 teammates' kills for that teamId), add to each champion's accumulator
- `total_gold`: sum of `goldEarned` for participants on that champion

One-time migration: drop and rebuild `champion_stats_cache` from raw. Same pattern as the ELO recompute flow — wipe the table, re-run the build loop over all games. Expected to be much faster than the ELO rebuild (simple aggregation, no iterative per-game computation).

`player_champion_stats_cache` is **not** extended — the player's raw KP%/GPM is computed on demand (see below).

---

## Backend

### New DB function: `getPlayerPerformance(puuid, patches, queueId)`

Location: `src/backend/db.ts`

Return type:
```typescript
interface PlayerPerformance {
  championPickQuality: number       // delta from 50% (e.g. +0.04 means avg 54% WR picks)
  augmentPickQuality: number        // delta from avg augment WR
  kpDelta: number                   // player KP% - expected KP%
  dpmDelta: number                  // player DPM - expected DPM
  gpmDelta: number                  // player GPM - expected GPM
  poolUniqueChampions: number
  poolTop3Concentration: number     // 0–1
  poolTopChampions: {
    championId: number
    championName: string
    games: number
    share: number                   // fraction of total games
  }[]
  classBuckets: {
    class: string
    games: number
    wins: number
    winRate: number
  }[]
}
```

Three queries, run sequentially:

**Query 1 — cache reads (fast)**
- `player_champion_stats_cache` for this player + patches + queueId → pool depth, DPM baseline denominator, pick quality numerator
- `champion_stats_cache` for same patches + queueId → global DPM, KP%, GPM baselines per champion; pick quality denominator
- existing `getAugmentStats(puuid, patches, queueId)` → player's per-augment pick counts; joined in-process with `augment_stats_cache` global win rates to compute augment pick quality (weighted avg global WR of picked augments vs. unweighted avg WR across all augments)

**Query 2 — raw pass (bounded by player's game count)**
Single query over `participants` for this puuid, joining a subquery for team kills:
```sql
SELECT
  p.championId,
  SUM(p.kills + p.assists)::int AS kp_num,
  SUM(tk.team_kills)::int        AS kp_den,
  SUM(p."goldEarned")::bigint    AS total_gold,
  SUM(p."gameDuration")::bigint  AS total_duration,
  COUNT(*)::int                  AS games
FROM participants p
JOIN (
  SELECT "gameId", "teamId", SUM(kills)::int AS team_kills
  FROM participants
  GROUP BY "gameId", "teamId"
) tk ON p."gameId" = tk."gameId" AND p."teamId" = tk."teamId"
JOIN matches m ON p."gameId" = m."gameId"
WHERE p.puuid = $puuid
  AND m."queueId" = $queueId
  AND ($patches IS NULL OR m."gameVersion" = ANY($patches))
GROUP BY p."championId"
```

**Query 3 — champion role breakdown (in-process, no DB query)**
Champion role lookup uses `getChampionCache()` to get `tags` for each championId in the player's champion stats. Each champion's primary role is its first tag (e.g. Lux → `["Mage", "Support"]` → "Mage"). Aggregate wins/games per role to produce `classBuckets`. Roles used: Fighter, Mage, Assassin, Tank, Marksman, Support.

### New route

`GET /api/players/:puuid/performance?patches=...&queueId=...` in `src/backend/routes/stats.ts`. Calls `getPlayerPerformance()` and returns the result as JSON.

### New API client method

`playerPerformance(puuid, patches?, queueId?)` in `src/main/apiClient.ts`. Returns `Promise<PlayerPerformance>`.

---

## Frontend

### `PerformancePanel` component

Location: `src/renderer/src/pages/PerformancePanel.tsx` — its own file, imported and rendered by `Players.tsx` when a player is selected.

- Fetches via `api.db.playerPerformance(puuid, patches, queueId)` when a player is selected (exposed through the preload IPC bridge, same pattern as `api.db.playerStats()`)
- Shows a loading state while fetching
- Renders the 6 metric cards + radar chart + pool list

**Radar chart implementation** — pure inline SVG, no library:
- Compute 6 evenly-spaced spoke angles
- For each class with data: plot a point at `center + winRate * radius` along its spoke
- Connect points with a `<polygon>`
- Draw a reference hexagon at `0.5 * radius` (50% ring)
- Missing classes: spoke and label are still drawn, but the class is excluded from the polygon (not connected). This avoids distorting the shape with zero-data points.
- Node circles sized by `log(games + 1)` to avoid zero-size nodes for single-game classes

---

## Verification

1. Run existing test suite: `npm test` — should pass with no regressions
2. Manually select a player in the app → Performance panel appears with plausible numbers
3. Check KP%/DPM/GPM deltas: a high-performing player should show positive values; an underperformer negative
4. Check radar chart renders correctly for players with games on fewer than 6 classes
5. Verify champion tags appear after a meta refresh (or wipe `mayhem-meta.json` and restart)
6. Verify `champion_stats_cache` rebuild completes and KP%/GPM baselines are non-zero after rebuild

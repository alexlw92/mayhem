# Design: Performance Percentile Rankings

## Context

The Performance tab currently shows five metric cards as raw deltas (e.g. `+4.1%` champion pick quality, `+23` DPM). These numbers are hard to interpret in isolation — a `+4.1%` pick quality delta only means something if you know the typical range across players. This feature converts the cards to percentile rankings against all tracked players, with the raw delta retained as secondary text.

---

## Summary of Changes

- **Schema extension:** Add `total_gold BIGINT` and `total_team_kills BIGINT` to `player_champion_stats_cache`. Backfill via truncate + rebuild. Enables KP% and GPM to be computed from cache, matching DPM.
- **New DB table:** `player_augment_stats_cache` — per-player per-patch per-augment pick counts. Populated by `buildCacheForGames`. Enables APQ to be computed from cache.
- **New DB table:** `player_performance_cache` — stores pre-computed metric values per player per patch per queue. Built incrementally in `initDb`, updated after each sync. All five metrics are now fully cache-based (no raw participants scans).
- **New DB function:** `buildPlayerPerformanceCache(gameVersion, queueId)` — single-pass join across all player caches.
- **New DB function:** `getPerformancePercentiles(puuid, patches, queueId)` — reads from cache, aggregates across patches, returns five 0–100 percentile ranks.
- **Route change:** `GET /players/:puuid/performance` response gains a `percentiles` field.
- **Frontend:** `DeltaCard` → `PercentileCard` (big ordinal on top, small delta below); `PoolCard` removed; DPM/GPM formatted as relative `%` deltas.

---

## Schema

```sql
CREATE TABLE IF NOT EXISTS player_performance_cache (
  puuid         TEXT    NOT NULL,
  "queueId"     INTEGER NOT NULL,
  "gameVersion" TEXT    NOT NULL,
  games         INTEGER NOT NULL DEFAULT 0,
  cpq           FLOAT   NOT NULL DEFAULT 0,
  apq           FLOAT   NOT NULL DEFAULT 0,
  kp_delta      FLOAT   NOT NULL DEFAULT 0,
  dpm_pct       FLOAT   NOT NULL DEFAULT 0,
  gpm_pct       FLOAT   NOT NULL DEFAULT 0,
  PRIMARY KEY (puuid, "queueId", "gameVersion")
)
```

All metric columns store fractional deltas (e.g. `0.084` for `+8.4%`). `dpm_pct` = `(playerDPM − expectedDPM) / expectedDPM`. `gpm_pct` follows the same pattern. `cpq`, `apq`, `kp_delta` are unchanged from the existing `getPlayerPerformance` computation.

---

## Schema Extension: `player_champion_stats_cache`

Add two columns (using the `hasCol` migration pattern, triggering a truncate + rebuild backfill):

- `total_gold BIGINT NOT NULL DEFAULT 0` — sum of `goldEarned` across all games for this player × champion
- `total_team_kills BIGINT NOT NULL DEFAULT 0` — sum of team kills (all 5 teammates) across all games for this player × champion

`buildCacheForGames` already accumulates per-player-per-champion stats in a batch loop. Extend it to also accumulate `total_gold` (from `p.goldEarned`) and `total_team_kills` (from the team-kills subquery already computed for `champion_stats_cache`).

With `total_kills` and `total_assists` already present, KP% numerator = `total_kills + total_assists`, denominator = `total_team_kills`. GPM = `total_gold × 60 / total_duration`. Both now computable from cache with no raw scan.

---

## New Table: `player_augment_stats_cache`

```sql
CREATE TABLE IF NOT EXISTS player_augment_stats_cache (
  puuid         TEXT    NOT NULL,
  "queueId"     INTEGER NOT NULL,
  "gameVersion" TEXT    NOT NULL,
  "augmentId"   INTEGER NOT NULL,
  pick_count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (puuid, "queueId", "gameVersion", "augmentId")
)
```

`buildCacheForGames` already iterates each game's participants and their augments to build `augment_stats_cache`. Extend it to also accumulate per-player augment picks into `player_augment_stats_cache` using the same batch-upsert pattern.

Backfill: add a missing-patch loop in `initDb` (same pattern as `player_champion_stats_cache`) that computes all players' augment picks per patch from raw `participant_augments` for any patches not yet cached.

---

## Build Process

`buildPlayerPerformanceCache(gameVersion: string, queueId: number)` is a single all-cache pass — no raw table scans. It runs two joins, both cache-only, and combines the results by `puuid`:

**Join A — CPQ + DPM% + KP% + GPM%:**
`player_champion_stats_cache` × `champion_stats_cache` on `(championId, queueId, gameVersion)`, grouped by `puuid`. Compute:
- `cpq` = `SUM(pcs.games × globalWR) / SUM(pcs.games) − 0.5`
- `dpm_pct` = `(playerDPM − expectedDPM) / expectedDPM` (playerDPM from `pcs.total_damage / pcs.total_duration`; expectedDPM champion-weighted from `cs`)
- `kp_delta` = `SUM(pcs.total_kills + pcs.total_assists) / SUM(pcs.total_team_kills) − expectedKP%` (expectedKP champion-weighted from `cs.total_kp_num / cs.total_team_kills`)
- `gpm_pct` = `(playerGPM − expectedGPM) / expectedGPM` (playerGPM from `pcs.total_gold / pcs.total_duration`; expectedGPM champion-weighted from `cs`)

**Join B — APQ:**
`player_augment_stats_cache` × `augment_stats_cache` on `(augmentId, queueId, gameVersion)`, grouped by `puuid`. Compute:
- `apq` = `SUM(pick_count × globalAugWR) / SUM(pick_count) − avgAugWR`

Results from both joins are merged by `puuid` and upserted into `player_performance_cache`. Players absent from one join get 0 for those columns.

**Integration into `initDb`:** After the existing `player_champion_stats_cache` backfill loop, add a similar loop that checks which `(gameVersion, queueId)` pairs are missing from `player_performance_cache` and runs `buildPlayerPerformanceCache` for each. Progress reported via `onProgress`.

**Post-sync rebuild:** The `player_performance_cache` uses the same missing-patch detection pattern as the other caches: after `buildCacheForGames` runs, delete all `player_performance_cache` rows for any `(gameVersion, queueId)` pair that received new games in this sync, then rebuild those pairs via `buildPlayerPerformanceCache`. The game versions affected by a sync batch are already known from the games being processed.

---

## Percentile Query

`getPerformancePercentiles(puuid: string, patches: string[] | undefined, queueId: number): Promise<Percentiles>`

Where `Percentiles = { cpq: number; apq: number; kpDelta: number; dpmPct: number; gpmPct: number }` (each 0–100, or `null` if not enough data).

Steps:
1. Read all rows from `player_performance_cache` for the given `queueId` (and patches if specified).
2. For each player, aggregate their rows with a weighted average by `games`:
   - `metric = SUM(row.metric × row.games) / SUM(row.games)`
   - `totalGames = SUM(row.games)`
3. Filter to players with `totalGames ≥ 5`.
4. If fewer than 10 qualifying players, return `null` for all percentiles (not enough population).
5. For each metric, sort all players' values ascending. Find the current player's rank. Percentile = `rank / (n − 1) × 100`, clamped to [0, 100].
6. Return five percentile values.

This runs entirely from the pre-computed cache — no raw table scans at display time.

---

## Route

`GET /players/:puuid/performance` returns the existing `PlayerPerformance` shape plus:

```typescript
interface PlayerPerformance {
  // ... existing fields unchanged ...
  percentiles: {
    cpq: number | null
    apq: number | null
    kpDelta: number | null
    dpmPct: number | null
    gpmPct: number | null
  } | null  // null = not enough population data
}
```

The route calls `getPlayerPerformance` and `getPerformancePercentiles` in parallel, then merges.

---

## Frontend

**`PercentileCard` component** replaces `DeltaCard`:
- Top: ordinal percentile (e.g. `73rd`) in large font, colored green above 66, red below 33, neutral in between.
- Bottom: raw delta in small secondary text (e.g. `+4.1%`).
- If `percentile === null`: show only the raw delta at full size (fallback to current DeltaCard behavior).

**Ordinal suffix:** 1→`1st`, 2→`2nd`, 3→`3rd`, 4–20→`th`, 21→`21st`, etc. Standard English ordinal rules.

**DPM / GPM format:** Change `fmtNum` (absolute) to `fmtPct` (relative percent) for these two cards. The raw delta shown in the card reads e.g. `+8.4%` instead of `+23`.

**`PoolCard` removed:** Delete the `PoolCard` component and its usage. The `poolUniqueChampions` field remains in the API response (no backend change), so the existing null-data guard in `PerformancePanel` (`data.poolUniqueChampions === 0`) continues to work unchanged.

**Five-card layout:** `Champ Picks`, `Aug Picks`, `KP% Δ`, `DPM Δ`, `GPM Δ` — each a `PercentileCard`.

---

## Minimum Games

Players with fewer than 5 total games (across the active patch filter) are excluded from the percentile population. The viewed player is always shown their own metrics, but their percentile rank is computed only if they also qualify (≥ 5 games). If they don't qualify, percentile shows `null` (raw delta only).

---

## No Changes To

- `getPlayerPerformance` logic (raw deltas unchanged)
- Role bar chart
- Patch filtering on raw delta display
- IPC bridge shape (just passes through the extended JSON)

---

## Verification

1. `npm test` — all 283+ tests pass.
2. Start app, select a player with 10+ games. Performance tab shows 5 PercentileCards with ordinal ranks + small delta below.
3. DPM and GPM deltas display as `+8.4%` style, not absolute.
4. Champion Pool card is gone.
5. Change patch filter — percentiles update to reflect the filtered population.
6. Player with < 5 games — cards fall back to raw delta display (no percentile shown).
7. Population < 10 qualifying players — all cards fall back to raw delta.
8. Check ordinal suffixes: 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, 23rd.

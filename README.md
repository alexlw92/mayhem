# Mayhem Stats Tracker

A desktop app for tracking ARAM Mayhem stats across a friend group, built with Electron + React. Pulls match history directly from the League Client (LCU API) — no Riot API key required.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Process Model](#process-model)
- [Backend Server](#backend-server)
  - [API Routes](#api-routes)
  - [Database Schema](#database-schema)
  - [Caching System](#caching-system)
- [LCU Integration](#lcu-integration)
- [Sync Pipeline](#sync-pipeline)
- [Frontend Pages](#frontend-pages)
- [IPC Bridge](#ipc-bridge)
- [Item Build Generation](#item-build-generation)
- [OCR Overlay](#ocr-overlay)
- [Startup Sequence](#startup-sequence)
- [Configuration](#configuration)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Electron App                          │
│                                                          │
│  ┌─────────────┐   IPC    ┌─────────────┐                │
│  │  Renderer   │◄────────►│    Main     │                │
│  │  (React)    │          │  Process    │                │
│  └─────────────┘          └──────┬──────┘                │
│                                  │ HTTP / utility proc   │
│                           ┌──────▼──────┐                │
│                           │   Backend   │                │
│                           │  (Express)  │                │
│                           └──────┬──────┘                │
│                                  │                       │
│                           ┌──────▼──────┐                │
│                           │ PostgreSQL  │                │
│                           └─────────────┘                │
│                                                          │
│  Main Process also talks to:                             │
│    - League Client (LCU API, HTTPS localhost)            │
│    - CommunityDragon / DDragon (metadata, CDN)           │
└──────────────────────────────────────────────────────────┘
```

---

## Process Model

The app uses three Electron processes plus an embedded Express server:

| Process | Entry Point | Role |
|---|---|---|
| **Main** | `src/main/index.ts` | Electron lifecycle, LCU polling, sync worker, IPC handlers, metadata cache |
| **Renderer** | `src/renderer/src/App.tsx` | React UI, routing, all user-facing pages |
| **Preload** | `src/preload/index.ts` | Secure IPC bridge, exposes `window.api` to renderer |
| **Backend** | `src/backend/server-entry.ts` | Express server, PostgreSQL queries, all data aggregation |

The backend runs as an Electron utility process (forked from `dist-server/server-entry.js`) and listens on localhost. The main process communicates with it over HTTP via `apiClient.ts`. If the environment variable `BACKEND_URL` is set to a non-localhost value, the embedded server is skipped and all requests go to that remote URL instead.

---

## Backend Server

### API Routes

All routes are prefixed with `/api`.

#### Stats (`src/backend/routes/stats.ts`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/patches` | All patches with recorded data |
| `GET` | `/players` | Full leaderboard, ranked by games played |
| `GET` | `/players/search?q=` | Summoner name search (trigram index, fuzzy) |
| `GET` | `/players/:puuid/stats` | Aggregate stats for a single player |
| `POST` | `/players/bulk-stats` | Batch stats for multiple PUUIDs |
| `GET` | `/players/:puuid/champions` | Per-champion breakdown for a player |
| `GET` | `/players/:puuid/matches` | Recent match list (default 20) |
| `GET` | `/players/:puuid/augments` | Augments picked by a player |
| `GET` | `/players/:puuid/trend` | Win rate trend over recent days |
| `GET` | `/players/:puuid/name` | Resolve latest summoner display name |
| `GET` | `/players/:puuid/coplayers` | Frequent teammates (min 2 shared games) |
| `GET` | `/group` | Summary stats across all tracked players |
| `GET` | `/champions` | Champion meta stats (global or filtered by patch) |
| `GET` | `/augments` | Augment stats (pick count, win rate, DPM) |
| `GET` | `/augments/:augmentId/champions` | Champions that synergize with an augment |
| `GET` | `/items/picks?championId=` | Per-item pick rates and win rates for a champion |
| `GET` | `/items/archetypes?championId=` | Computed build archetypes (openings, cores, boots) |
| `GET` | `/items/summary?championId=` | Combined archetypes + pick rates in one response |
| `GET` | `/items/boots-by-opener?championId=&openers=&boots=` | Boot synergy with specific opener items |
| `POST` | `/meta/items` | Upsert item metadata from CommunityDragon |

#### Sync (`src/backend/routes/sync.ts`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/matches/bulk` | Batch insert matches with full participant data |
| `GET` | `/matches/:gameId/exists` | Check if a game is already recorded |
| `PUT` | `/matches/:gameId` | Upsert a single match |
| `GET` | `/incomplete-games` | Games with fewer than 10 participants (need repair) |
| `DELETE` | `/synctimes` | Invalidate all sync timestamps (triggers full re-sync) |
| `GET` | `/sync/next?clientId=` | Claim next player job from queue (with lease) |
| `POST` | `/sync/done/:puuid` | Mark job complete, update sync timestamp |
| `POST` | `/sync/fail/:puuid` | Release job lease on failure |
| `POST` | `/sync/enqueue` | Queue a player for sync |
| `POST` | `/sync/enqueue-priority` | Priority-queue players (used for current game) |
| `GET` | `/sync/queue` | Queue status: total pending, claimed count |
| `DELETE` | `/sync/queue` | Clear the entire job queue |

#### Meta (`src/backend/routes/meta.ts`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/meta/champions` | Champion ID → name mapping |
| `GET` | `/meta/augments` | Augment metadata (name, rarity, icon path) |

---

### Database Schema

All data is stored in PostgreSQL. The connection string comes from `DATABASE_URL`.

#### Core Tables

**`matches`**
- `gameId` (PK), `queueId`, `gameCreation`, `gameDuration`, `gameVersion`

**`participants`**
- `id` (PK), `gameId` (FK), `puuid`, `summonerName`, `championId`, `teamId`, `win`
- Stats: `kills`, `deaths`, `assists`, `totalDamageDealtToChampions`, `goldEarned`, `totalMinionsKilled`
- `gameVersion` (denormalized for efficient patch filtering)

**`participant_augments`**
- `participantId` (FK), `augmentId` — one row per augment picked

**`participant_items`**
- `participantId` (FK), `itemId`, `slot` (0–6)

**`participant_item_sets`**
- `participantId` (PK), `itemIds` (int[], GIN indexed) — denormalized array for fast set operations

#### Metadata Tables

| Table | Columns |
|---|---|
| `meta_champions` | `id` (PK), `name` |
| `meta_augments` | `id` (PK), `name`, `rarity` (0=Silver, 1=Gold, 2=Prismatic), `icon_path` |
| `meta_items` | `id` (PK), `name`, `iconPath`, `category`, `is_component` |

#### Pre-Aggregated Cache Tables

These are the primary query targets. All raw-row aggregation happens at write time.

| Table | Dimensions | Contents |
|---|---|---|
| `champion_stats_cache` | gameVersion, queueId, championId | games, wins, damage sums |
| `augment_stats_cache` | gameVersion, queueId, augmentId | games, wins, damage sums |
| `player_stats_cache` | gameVersion, queueId, puuid | games, wins, damage sums |
| `player_champion_stats_cache` | gameVersion, queueId, puuid, championId | per-champion player breakdown |
| `augment_champion_stats_cache` | gameVersion, queueId, augmentId, championId | synergy stats |
| `item_builds_cache` | gameVersion, queueId, championId, build (int[]) | 5-item build frequency |
| `item_picks_cache` | gameVersion, queueId, championId, itemId | pick counts, win rates, slot emptiness |
| `item_archetypes_cache` | championId, patches_key | computed archetype clusters (jsonb), `computed_at` |

#### System Tables

**`player_sync_times`** — `puuid` (PK), `syncedAt` — tracks when each player was last synced.

**`sync_queue`** — Distributed job queue with leasing: `puuid`, `queuedAt`, `claimedAt`, `claimedBy`, `priority`.

#### Patch Inference

Game creation timestamps are mapped to patch versions using a hard-coded `PATCH_DATES` table (covering 14.1 through 26.15). There is no dependency on external APIs for patch boundaries.

#### Key Indexes

- `idx_participants_puuid` — primary filter for all player queries
- `idx_participants_championId` — champion stats lookups
- `idx_participants_gameVersion` — patch filtering
- `idx_participants_summonerName_trgm` — trigram index for fuzzy name search (requires `pg_trgm`)
- `idx_item_picks_cache_champ_gv` — item query optimization
- `idx_item_builds_cache_build` — GIN array index for build set matching
- `idx_sync_queue_queued_at` — FIFO job ordering

---

### Caching System

Caching operates at two levels: in-memory in the main process, and pre-aggregated tables in PostgreSQL.

#### In-Memory Caches (Main Process)

| Cache | Key | TTL | Invalidation |
|---|---|---|---|
| Champion names | `championId → name` | Refreshed on startup + every 60 min | `meta:refresh` IPC |
| Augment info | `augmentId → { name, rarity, iconPath }` | Same | Same |
| Item info | `itemId → { name, iconPath, category }` | Same | Same |
| Item query results | `picks:${championId}:${patches}` | 5 minutes | Time-based expiry |
| Archetype results | `archetypes:${championId}:${patches}` | 5 minutes | Time-based expiry |

#### Database-Level Caches

All stat cache tables (`champion_stats_cache`, `augment_stats_cache`, etc.) are updated **within the same transaction** as the match insert — the cache is always consistent immediately after a commit.

The `item_archetypes_cache` is an exception: archetype clustering is expensive, so after a match insert the row's `computed_at` is backdated by 16 minutes to mark it stale. The archetype is recomputed lazily on the next query.

#### Cache Invalidation Rules

- **On insert**: All affected stat caches updated in-transaction.
- **On prune**: Matches older than 4 patches are deleted; cache rows for those patches are deleted with them.
- **On full re-sync** (`DELETE /synctimes`): All `player_sync_times` cleared, forcing every player to be re-fetched on next sync.
- **Metadata**: Re-downloaded from CommunityDragon/DDragon every 60 minutes or on `api.meta.refresh()`.

#### Backfill

On first run (or after schema migrations add new cache tables), the backend backfills all cache tables from raw match data. Progress is streamed to the renderer via the `backfill-progress` IPC event.

---

## LCU Integration

The LCU (League Client Update) API is a private HTTPS REST API served by the running League of Legends client on localhost. All LCU code lives in `src/main/lcu.ts`.

### Connection

1. Scans known lockfile paths across common League install locations (`C:\Riot Games\...`, `D:\Riot Games\...`, etc.)
2. Parses the lockfile format: `name:PID:port:password:protocol`
3. Creates an Axios instance with basic auth (`user: "riot"`, password from lockfile) and TLS verification disabled (the client uses a self-signed cert)
4. Uses exponential backoff (1s → 2s → 4s… up to 15s total) for all requests

### Endpoints Used

| LCU Endpoint | Purpose |
|---|---|
| `/lol-summoner/v1/current-summoner` | Get logged-in player's puuid and display name |
| `/lol-match-history/v1/products/lol/{puuid}/matches` | Paginated match history |
| `/lol-match-history/v1/games/{gameId}` | Full match data with all participants |
| `/lol-gameflow/v1/session` | Current game phase (Lobby, ChampSelect, InProgress, EndOfGame) |
| `/lol-champ-select/v1/session` | Team compositions during champion select |
| `/lol-summoner/v1/summoners?name=` | Resolve Riot ID to summoner object |

### Queue Filtering

Only ARAM Mayhem queues are tracked: queue IDs `2400` (Mayhem) and `2450` (Classic Mayhem).

### Live Game Detection

The main process polls `isClientRunning()` every 10 seconds. When the game phase transitions to `InProgress` or `EndOfGame`, all participants are fetched and priority-queued for immediate sync.

---

## Sync Pipeline

Match data flows from the League client to the database through a distributed job queue.

```
User clicks Sync
       │
       ▼
main: lcu:sync IPC handler
  └─ getCurrentSummoner() via LCU
  └─ apiClient.enqueuePlayer(puuid)
  └─ start syncWorker() loop
       │
       ▼
syncWorker() loop  [src/main/sync.ts]
  ├─ polls isClientRunning() every 5s — stops if client goes offline
  ├─ apiClient.claimNextJob(CLIENT_ID) → claim a puuid from sync_queue
  │
  └─ importGamesForPuuid(puuid):
       ├─ getMatchHistory(puuid, 0–49) via LCU  [up to 50 games]
       ├─ for each unseen gameId:
       │    └─ getGameDetails(gameId) via LCU
       │    └─ mapGame() → normalize to internal Match shape
       │         (infers gameVersion from PATCH_DATES table)
       ├─ apiClient.insertMatches(batch)  [CONCURRENCY=5, BATCH_SIZE=10]
       └─ apiClient.completeJob(puuid)
            └─ enqueues all participant PUUIDs for cascade sync
       │
       ▼
backend: insertMatches()  [src/backend/db.ts]
  ├─ BEGIN TRANSACTION
  ├─ INSERT INTO matches (ON CONFLICT DO NOTHING)
  ├─ INSERT participants for new matches only
  ├─ INSERT participant_augments
  ├─ INSERT participant_items (with slot numbers)
  ├─ UPSERT participant_item_sets (array_agg)
  ├─ UPDATE all stat caches (champion, augment, player, item)
  ├─ Mark item_archetypes_cache stale
  └─ COMMIT
```

**Sync constants:**

| Constant | Value | Meaning |
|---|---|---|
| `SYNC_STALE_THRESHOLD_MS` | 12 hours | Players older than this are re-queued on next sync |
| `SYNC_LEASE_MS` | 5 minutes | Job lease duration; expired leases can be reclaimed |
| `CONCURRENCY` | 5 | Parallel LCU game-detail requests |
| `BATCH_SIZE` | 10 | Matches per DB insert batch |

---

## Frontend Pages

All pages live in `src/renderer/src/pages/`. Patch filtering is global state managed in `App.tsx` and applied to every data query.

| Page | Description |
|---|---|
| **Players** | Leaderboard sorted by games/wins; click any player to see their champion breakdown, recent matches, co-player stats, and win rate trend |
| **Champions** | Champion win rates, pick rates, and DPM across all tracked games |
| **Augments** | Augment pick counts, win rates, and DPM; icons color-coded by rarity (Silver / Gold / Prismatic) |
| **AugmentDetail** | Which champions pair best with a given augment |
| **ChampionDetail** | Item builds, per-item pick rates, and augment breakdown for one champion |
| **Items** | Build archetype browser: opener → core items → boots, with win rates per archetype |
| **CurrentGame** | Live overlay showing each participant's historical stats and OCR-detected augments |

---

## IPC Bridge

The preload script (`src/preload/index.ts`) exposes a typed `window.api` object to the renderer via Electron's `contextBridge`. All channels are either `ipcRenderer.invoke` (request/response) or `ipcRenderer.on` (server push).

### `api.lcu`

```typescript
api.lcu.status()                          // → { running: boolean }
api.lcu.sync()                            // Start sync for current summoner
api.lcu.fullSync()                        // Invalidate all sync times, re-sync everyone
api.lcu.syncStatus()                      // → { syncing: boolean }
api.lcu.stopSync()                        // Cancel ongoing sync
api.lcu.syncPlayer(puuid)                 // Sync a single player manually
api.lcu.lookupPlayer(gameName, tagLine)   // Riot ID → summoner info
api.lcu.currentGame()                     // Current game state (phase + participants)
api.lcu.syncCurrentGame(puuids[])         // Priority-queue current game participants
api.lcu.currentSummoner()                 // Logged-in player's puuid + name
api.lcu.captureScreen()                   // Desktop screenshot
api.lcu.ocrScreen()                       // Screenshot + Tesseract OCR → augment IDs
```

### `api.db`

```typescript
api.db.patches()
api.db.playerStats(patches?, queueId?)
api.db.playerOneStats(puuid, patches?, queueId?)
api.db.playerBulkStats(puuids[], patches?, queueId?)
api.db.championStats(puuid?, patches?, queueId?)
api.db.recentMatches(limit?, puuid?, patches?)
api.db.winRateTrend(puuid?, days?)
api.db.groupSummary()
api.db.championCache()              // → { [championId]: string }
api.db.augmentCache()               // → { [augmentId]: AugmentInfo }
api.db.itemCache()                  // → { [itemId]: ItemInfo }
api.db.augmentStats(puuid?, championId?, patches?, queueId?)
api.db.augmentChampionStats(augmentId, puuid?, patches?, queueId?)
api.db.searchPlayers(query)
api.db.coplayerStats(puuid, patches?)
api.db.itemBuilds(championId, patches?)
api.db.itemPickRates(championId, patches?)
api.db.itemArchetypes(championId, patches?)
api.db.itemSummary(championId, patches?, queueId?)
```

### `api.meta` / `api.recents` / `api.app`

```typescript
api.meta.refresh()         // Re-download all metadata from external CDNs
api.recents.load()         // → RecentEntry[] from persisted storage
api.recents.save(entries)  // Persist the recent players list
api.app.reload()           // Reload the renderer window
```

### Push Events (`api.on(channel, callback)`)

| Channel | Payload |
|---|---|
| `db-ready` | DB is initialized and ready |
| `assets-ready` | All metadata icons downloaded |
| `assets-progress` | `{ done: number, total: number }` |
| `db-error` | Error string from DB layer |
| `meta-refreshed` | Metadata has been updated |
| `backfill-progress` | `{ phase: string }` — cache rebuild status |
| `sync-started` | Sync worker has started |
| `sync-progress` | `{ playerName, gamesAdded, playersChecked, queueRemaining }` |
| `sync-complete` | `{ imported, playersSynced, reason? }` |
| `main-log` | Relay of main process log lines |

---

## Item Build Generation

Item builds are presented as **archetypes** — named build patterns with an opener item, three core items, recommended boots, and flex fifth-item options. Generating them is a three-stage pipeline: data collection at match-insert time, clustering on query, and a stale-while-revalidate cache layer.

### Stage 1: Data Collection (at insert time)

Every time a batch of matches is inserted, two cache tables are updated within the same transaction:

**`item_builds_cache`** — 5-item combinations

For each new participant with ≥ 5 items, every ordered subset of 5 items is generated in SQL via five self-joins on the item array. Each 5-item combination is stored as a sorted integer array alongside a game and win count. This means a participant with 6 items generates C(6,5) = 6 rows. The inflation is real but bounded and corrected later during clustering.

**`item_picks_cache`** — per-item pick rates with slot emptiness

For each item a participant bought, the cache records:
- `picks` and `wins` — raw counts
- `slot_emptiness_sum` / `slot_emptiness_count` — the number of empty inventory slots (out of 6) in the participant's final inventory, summed and counted across all games where that item appeared. A higher average slot emptiness means the item was present when the inventory was mostly empty — a proxy for "bought early."

### Stage 2: Archetype Clustering (`_computeArchetypes`)

Clustering is done in TypeScript (`src/backend/itemArchetypes.ts`) and triggered lazily per champion. It runs in four phases:

**Phase 0 — Load & filter**

All 5-item build rows for the champion are loaded from `item_builds_cache`. Each row is enriched with item metadata. Boots and component items are identified from `meta_items` and excluded from the core clustering logic (but carried along for enrichment later). Rows with fewer than 4 non-boot, non-component items are dropped.

**Phase 1 — Enumerate quads and pairs**

For each enriched build, every C(n,4) combination of its non-boot, non-component items is generated. These are called *quads* — candidate 4-item cores. At the same time, every pair of items in the build is tracked with its co-occurrence game count.

**Phase 2 — Greedy quad selection**

Pairs are sorted descending by total games. For each high-frequency pair, the top quads containing that pair are considered. A quad is accepted if:
- Its game count exceeds the significance threshold (`max(1% of total games, 2)`)
- None of its six constituent pairs has already been claimed by a previously accepted quad (enforces non-overlap between archetypes)

Accepted quads claim their pairs so no item pair can appear in two different archetypes. Up to 8 candidates are collected and sorted by game count.

**Phase 3 — Enrich with boots and flex items**

For each of the top 8 quads:
- **Boots**: all builds containing that quad are scanned for boot items; boots are ranked by pick count and pick rate.
- **Fifth items**: all non-quad, non-boot, non-component items in those builds are collected and ranked by pick count.
- **Item ordering within the quad**: items are sorted by their `slot_emptiness` ratio (from `item_picks_cache`) descending. The item with the highest ratio — i.e., most often present when inventory is nearly empty — is designated the *opener*; the remaining three are *core* items.

**Phase 4 — Count correction**

`item_builds_cache` is C(n,5) inflated, so the game counts on quads are overstated. After clustering, each archetype's true game and win counts are looked up directly from `participant_item_sets` using a PostgreSQL array containment query (`@> {item1, item2, item3, item4}`). The average inventory slot of each core item (from `participant_items`) is also computed here and used as a secondary ordering signal, overriding the slot-emptiness estimate when slot data is available.

### Stage 3: Stale-While-Revalidate Cache

Archetype computation is expensive (several hundred milliseconds per champion). Results are stored in `item_archetypes_cache` as a `jsonb` column keyed by `(championId, patches_key)`.

- On a cache **miss**: computation runs synchronously and the result is cached.
- On a cache **hit that is < 15 minutes old**: the cached value is returned immediately.
- On a cache **hit that is ≥ 15 minutes old**: the stale value is returned immediately to the caller while recomputation runs in the background. The next request gets the fresh result.
- **Invalidation**: whenever new matches are inserted for a champion, that champion's `computed_at` is backdated by 16 minutes, marking it stale for the next query. A concurrent request for the same champion is deduplicated using an in-flight `Map` so the heavy SQL only runs once even under parallel load.
- **Metadata refresh**: calling `api.meta.refresh()` truncates `item_archetypes_cache` entirely, forcing a full recompute on next access.

---

## OCR Overlay

The current game overlay (`CurrentGame.tsx`) can detect which augments players have selected using Tesseract.js OCR.

**Flow:**
1. `api.lcu.ocrScreen()` is called from the renderer
2. The main process captures a screenshot of the League window via Electron's `desktopCapturer`
3. The image is preprocessed in the renderer: converted to grayscale, then binary-thresholded at 160 (optimized for white text on dark augment tooltip backgrounds at 1920×1080)
4. A Tesseract.js worker (initialized lazily on first use, loaded from disk for offline reliability) runs text recognition on the preprocessed image
5. `matchAugments(text, cache)` in `ocrUtils.ts` scans the OCR output for augment names from the metadata cache, using exact substring match first and ordered word proximity as a fallback
6. Up to 3 augments per player are identified and displayed in the overlay

---

## Startup Sequence

When the app launches:

1. **Fork backend server** — utility process is started; main process waits for a `ready` message
2. **Init DB** — creates all tables and indexes; applies schema migrations via `ALTER COLUMN` fallbacks for existing installs
3. **Backfill caches** — for any patch with raw match data but empty cache tables, all stat caches are computed from scratch; progress emitted as `backfill-progress` events
4. **Fetch metadata** — downloads champion/augment/item data from DDragon and CommunityDragon; icons are cached in `userData/image-cache`; repeats every 60 minutes
5. **Emit `db-ready` and `assets-ready`** to the renderer so the UI unlocks
6. **Repair incomplete matches** — finds games stored with fewer than 10 participants and re-fetches their details via LCU
7. **Begin LCU polling** — checks `isClientRunning()` every 10 seconds to gate the sync button

---

## Configuration

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `BACKEND_URL` | Override to use a remote backend server instead of the embedded one |

Runtime constants (in source):

| Constant | Value | Location |
|---|---|---|
| `MAYHEM_QUEUE_IDS` | `[2400, 2450]` | `src/main/lcu.ts` |
| `SYNC_STALE_THRESHOLD_MS` | 12 hours | `src/main/sync.ts` |
| `SYNC_LEASE_MS` | 5 minutes | `src/backend/routes/sync.ts` |
| `ITEM_CACHE_TTL_MS` | 5 minutes | `src/main/index.ts` |
| `REFRESH_INTERVAL_MS` | 60 minutes | `src/backend/server-entry.ts` |
| `PATCH_HISTORY_LIMIT` | 4 patches | `src/backend/db.ts` |

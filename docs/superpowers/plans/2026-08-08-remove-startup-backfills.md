# Remove Startup Backfills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all data backfills from server startup, clean up the dead progress-reporting pipeline, and consolidate all cache rebuilds into a single opt-in script.

**Architecture:** Strip six data-fill blocks from `initDb` (leaving all DDL intact), remove `backfillDetailCaches` from `server-entry.ts`, delete the `sendProgress`/`backfill-progress` IPC chain from both processes and the renderer, then create `scripts/rebuild-caches.mjs` containing all the extracted SQL with idempotent per-patch checks and a `--caches` flag for selective rebuilds.

**Tech Stack:** TypeScript (Electron main + backend), React (renderer), Node.js `.mjs` scripts, `postgres` tagged-template SQL library, dotenv

---

## File Map

| File | Change |
|---|---|
| `src/backend/db.ts` | Remove `onProgress` param from `initDb`, remove 6 data-fill blocks, delete `backfillDetailCaches` export |
| `src/backend/server-entry.ts` | Remove `backfillDetailCaches` import, `sendProgress` fn, and both call sites |
| `src/main/index.ts` | Remove `backfill-progress` branch in `backendProcess.on('message')` |
| `src/renderer/src/App.tsx` | Remove `backfillPhase` state, IPC listener, and two render sites |
| `src/renderer/src/App.css` | Remove `.sidebar-backfill` and `.sidebar-backfill-dot` rules |
| `scripts/rebuild-caches.mjs` | New file — all cache rebuild logic |

---

### Task 1: Strip data-fill blocks from `initDb` in `db.ts`

**Files:**
- Modify: `src/backend/db.ts`

The DDL blocks (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`) all stay. The `needsChampCacheRebuild` and `needsPCSRebuild` TRUNCATE guards stay too — they're schema-migration guards, not data backfills. Remove only the INSERT/fill blocks and the `onProgress` parameter.

- [ ] **Step 1: Remove the `onProgress` parameter from `initDb`**

Change the signature at line 60 from:
```ts
export async function initDb(url?: string, onProgress?: (phase: string) => void): Promise<void> {
```
to:
```ts
export async function initDb(url?: string): Promise<void> {
```

- [ ] **Step 2: Remove the `participant_item_sets` data fill block**

Find and delete this block (around line 136–148). It appears immediately after the `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_participant_item_sets_gin` line:
```ts
  if (!hasCol('participant_item_sets', 'itemIds')) {
    // one-time backfill: participant_item_sets is kept up-to-date incrementally on new inserts
    console.log('[db] backfilling participant_item_sets...')
    const _tpis = Date.now()
    await sql_`
      INSERT INTO participant_item_sets ("participantId", "itemIds")
      SELECT "participantId", array_agg("itemId" ORDER BY "itemId")
      FROM participant_items
      GROUP BY "participantId"
      ON CONFLICT ("participantId") DO NOTHING
    `
    console.log(`[db] participant_item_sets backfill done (${Date.now() - _tpis}ms)`)
  }
```

- [ ] **Step 3: Remove the champion/augment summary cache fill block**

Find and delete this block (around line 435–476). It starts right after `console.log(\`[db] indexes done...\`)`:
```ts
  const [{ count: champCacheCount }] = await sql_`SELECT COUNT(*) FROM champion_stats_cache`
  if (Number(champCacheCount) === 0) {
    console.log('[db] backfilling summary caches...')
    const _t2 = Date.now()
    onProgress?.('Rebuilding champion & augment cache…')
    await sql_`
      WITH team_kills AS (
        SELECT "gameId", "teamId", SUM(kills)::bigint AS team_kills
        FROM participants
        GROUP BY "gameId", "teamId"
      )
      INSERT INTO champion_stats_cache
        ("gameVersion","queueId","championId","championName",games,wins,
         total_kills,total_deaths,total_assists,total_damage,total_duration,
         total_team_kills,total_gold)
      SELECT p."gameVersion", m."queueId", p."championId", MIN(p."championName"),
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration"),
        SUM(tk.team_kills)::bigint, SUM(p."goldEarned")::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN team_kills tk ON tk."gameId" = p."gameId" AND tk."teamId" = p."teamId"
      WHERE p."gameVersion" IS NOT NULL
      GROUP BY p."gameVersion", m."queueId", p."championId"
      ON CONFLICT DO NOTHING
    `
    await sql_`
      INSERT INTO augment_stats_cache ("gameVersion","queueId","augmentId",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion", m."queueId", pa."augmentId",
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration")
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN participant_augments pa ON pa."participantId" = p.id
      WHERE p."gameVersion" IS NOT NULL
      GROUP BY p."gameVersion", m."queueId", pa."augmentId"
      ON CONFLICT DO NOTHING
    `
    console.log(`[db] summary cache backfill done (${Date.now() - _t2}ms)`)
  }
```

- [ ] **Step 4: Remove the player stats / player-champion / performance cache fill block**

Find and delete the entire `{ ... }` block that starts with:
```ts
  {
    // Per-patch backfill for player caches — avoids huge hash aggregates that spill to disk
    const pvRows = await sql_`SELECT DISTINCT "gameVersion" FROM participants WHERE "gameVersion" IS NOT NULL ORDER BY 1`
```
...and ends after the closing `}` of the inner performance-cache block (around line 558). The block covers `player_stats_cache`, `player_champion_stats_cache`, and `player_performance_cache` fills. All `onProgress?.()` calls inside are deleted along with it.

- [ ] **Step 5: Remove the item builds/picks async IIFE**

Find and delete the fire-and-forget IIFE (around lines 560–640):
```ts
  ;(async () => {
    try {
      const patches = await getPatches()
      ...
      onProgress?.('')
    } catch (e) {
      console.warn('[item-builds/picks] backfill failed:', (e as Error).message)
    }
  })()
```
Delete everything from `;(async () => {` through the closing `})()`

- [ ] **Step 6: Delete the `backfillDetailCaches` export function**

Find and delete the entire function (lines 702–756):
```ts
export async function backfillDetailCaches(onProgress?: (phase: string) => void): Promise<void> {
  ...
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 8: Commit**

```
git add src/backend/db.ts
git commit -m "refactor: remove data backfills from initDb, delete backfillDetailCaches"
```

---

### Task 2: Strip backfill wiring from `server-entry.ts`

**Files:**
- Modify: `src/backend/server-entry.ts`

- [ ] **Step 1: Remove `backfillDetailCaches` from the import**

Change:
```ts
import {
  initDb,
  backfillDetailCaches,
  upsertChampions, upsertAugments,
  getChampionsFromDb, getAugmentsFromDb,
  getPatches,
  upsertItemMeta,
} from './db'
```
to:
```ts
import {
  initDb,
  upsertChampions, upsertAugments,
  getChampionsFromDb, getAugmentsFromDb,
  getPatches,
  upsertItemMeta,
} from './db'
```

- [ ] **Step 2: Delete the `sendProgress` function**

Remove:
```ts
function sendProgress(phase: string): void {
  ;(process as any).parentPort?.postMessage({ type: 'backfill-progress', phase })
}
```

- [ ] **Step 3: Remove `sendProgress` argument from `initDb` call**

Change:
```ts
  await initDb(undefined, sendProgress)
```
to:
```ts
  await initDb()
```

- [ ] **Step 4: Remove `backfillDetailCaches` call after server ready**

Remove this line from inside `.listen(PORT, () => { ... })`:
```ts
    backfillDetailCaches(sendProgress).catch(err => console.warn('[backfill] failed:', (err as Error).message))
```

- [ ] **Step 5: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/backend/server-entry.ts
git commit -m "refactor: remove sendProgress and backfillDetailCaches from server-entry"
```

---

### Task 3: Strip `backfill-progress` IPC from `main/index.ts`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Remove the `backfill-progress` branch**

In `spawnLocalBackend()`, find the `backendProcess.on('message', ...)` handler:
```ts
  backendProcess.on('message', (msg: unknown) => {
    if ((msg as any)?.type === 'ready') { backendReady = true; maybeSignalReady() }
    if ((msg as any)?.type === 'backfill-progress') sendToWindow('backfill-progress', (msg as any).phase)
  })
```

Remove only the `backfill-progress` line, leaving:
```ts
  backendProcess.on('message', (msg: unknown) => {
    if ((msg as any)?.type === 'ready') { backendReady = true; maybeSignalReady() }
  })
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/main/index.ts
git commit -m "refactor: remove backfill-progress IPC forwarding from main process"
```

---

### Task 4: Strip backfill UI from renderer

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.css`

- [ ] **Step 1: Remove `backfillPhase` state**

In `App.tsx`, remove:
```ts
  const [backfillPhase, setBackfillPhase] = useState('')
```

- [ ] **Step 2: Remove IPC listener and cleanup**

In the `useEffect` that subscribes to IPC events, find:
```ts
    const unsubBackfill = api.on('backfill-progress', (phase: string) => setBackfillPhase(phase))
    return () => { unsubReady(); unsubAssetsReady(); unsubAssetsProgress(); unsubDbError(); unsubMeta(); unsubBackfill() }
```

Change to (remove `unsubBackfill` declaration and its call in the return):
```ts
    return () => { unsubReady(); unsubAssetsReady(); unsubAssetsProgress(); unsubDbError(); unsubMeta() }
```

- [ ] **Step 3: Remove `backfillPhase` from the loading screen**

Find the loading screen render block. Remove:
```tsx
        {backfillPhase && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{backfillPhase}</div>
        )}
```

- [ ] **Step 4: Remove `backfillPhase` sidebar widget**

Find and remove:
```tsx
        {backfillPhase && (
          <div className="sidebar-backfill">
            <span className="sidebar-backfill-dot" />
            {backfillPhase}
          </div>
        )}
```

- [ ] **Step 5: Remove dead CSS rules from `App.css`**

Find and delete both rules:
```css
.sidebar-backfill {
  display: flex;
  align-items: center;
  gap: 6px;
  ...
  border-top: 1px solid var(--border);
}
.sidebar-backfill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  ...
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```
git add src/renderer/src/App.tsx src/renderer/src/App.css
git commit -m "refactor: remove backfill progress UI from renderer"
```

---

### Task 5: Create `scripts/rebuild-caches.mjs`

**Files:**
- Create: `scripts/rebuild-caches.mjs`

This script consolidates all SQL that was removed from `initDb` and `backfillDetailCaches`. It is idempotent: each section checks which patches are missing before inserting. The `--caches` flag selects which caches to rebuild; omitting it runs all in dependency order.

Usage:
```
node scripts/rebuild-caches.mjs                         # rebuild everything missing
node scripts/rebuild-caches.mjs --caches=summary        # just champion + augment stats
node scripts/rebuild-caches.mjs --caches=players,player-champions,performance
node scripts/rebuild-caches.mjs --caches=items
node scripts/rebuild-caches.mjs --caches=augment-champions
```

Dependency order: `summary` → `players` → `player-champions` → `performance`. `items` and `augment-champions` are independent.

- [ ] **Step 1: Create the file**

Create `scripts/rebuild-caches.mjs` with the full content below:

```js
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: path.resolve(__dirname, '../.env.dev') })
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false })

const postgres = require('postgres')

const ALL_TARGETS = ['summary', 'players', 'player-champions', 'performance', 'items', 'augment-champions']
const arg = process.argv.find(a => a.startsWith('--caches='))
const targets = new Set(arg ? arg.replace('--caches=', '').split(',') : ALL_TARGETS)

for (const t of targets) {
  if (!ALL_TARGETS.includes(t)) {
    console.error(`Unknown cache target: "${t}". Valid: ${ALL_TARGETS.join(', ')}`)
    process.exit(1)
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set — check your .env.dev or .env file')
    process.exit(1)
  }

  const sql = postgres(url, { onnotice: () => {} })

  try {
    if (targets.has('summary'))          await rebuildSummary(sql)
    if (targets.has('players'))          await rebuildPlayers(sql)
    if (targets.has('player-champions')) await rebuildPlayerChampions(sql)
    if (targets.has('performance'))      await rebuildPerformance(sql)
    if (targets.has('items'))            await rebuildItems(sql)
    if (targets.has('augment-champions')) await rebuildAugmentChampions(sql)

    console.log('\nDone.')
  } finally {
    await sql.end()
  }
}

async function getPatches(sql) {
  const rows = await sql`SELECT DISTINCT "gameVersion" FROM participants WHERE "gameVersion" IS NOT NULL ORDER BY 1`
  return rows.map(r => r.gameVersion)
}

async function rebuildSummary(sql) {
  const pvList = await getPatches(sql)
  if (pvList.length === 0) { console.log('[summary] no patches found, skipping'); return }

  const existingChampRows = await sql`SELECT DISTINCT "gameVersion" FROM champion_stats_cache`
  const existingChamp = new Set(existingChampRows.map(r => r.gameVersion))
  const missingChamp = pvList.filter(gv => !existingChamp.has(gv))

  if (missingChamp.length === 0) {
    console.log('[summary] champion_stats_cache up to date')
  } else {
    console.log(`[summary] backfilling champion_stats_cache (${missingChamp.length} patches)...`)
    for (const gv of missingChamp) {
      const t = Date.now()
      process.stdout.write(`[summary] champion ${gv}... `)
      await sql`
        WITH team_kills AS (
          SELECT "gameId", "teamId", SUM(kills)::bigint AS team_kills
          FROM participants
          GROUP BY "gameId", "teamId"
        )
        INSERT INTO champion_stats_cache
          ("gameVersion","queueId","championId","championName",games,wins,
           total_kills,total_deaths,total_assists,total_damage,total_duration,
           total_team_kills,total_gold)
        SELECT p."gameVersion", m."queueId", p."championId", MIN(p."championName"),
          COUNT(*)::int, SUM(p.win::int)::int,
          SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
          SUM(p."damageDealt"), SUM(p."gameDuration"),
          SUM(tk.team_kills)::bigint, SUM(p."goldEarned")::bigint
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN team_kills tk ON tk."gameId" = p."gameId" AND tk."teamId" = p."teamId"
        WHERE p."gameVersion" = ${gv}
        GROUP BY p."gameVersion", m."queueId", p."championId"
        ON CONFLICT DO NOTHING
      `
      console.log(`done (${Date.now() - t}ms)`)
    }
  }

  const existingAugRows = await sql`SELECT DISTINCT "gameVersion" FROM augment_stats_cache`
  const existingAug = new Set(existingAugRows.map(r => r.gameVersion))
  const missingAug = pvList.filter(gv => !existingAug.has(gv))

  if (missingAug.length === 0) {
    console.log('[summary] augment_stats_cache up to date')
  } else {
    console.log(`[summary] backfilling augment_stats_cache (${missingAug.length} patches)...`)
    for (const gv of missingAug) {
      const t = Date.now()
      process.stdout.write(`[summary] augment ${gv}... `)
      await sql`
        INSERT INTO augment_stats_cache ("gameVersion","queueId","augmentId",pick_count,wins,total_damage,total_duration)
        SELECT p."gameVersion", m."queueId", pa."augmentId",
          COUNT(*)::int, SUM(p.win::int)::int,
          SUM(p."damageDealt"), SUM(p."gameDuration")
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN participant_augments pa ON pa."participantId" = p.id
        WHERE p."gameVersion" = ${gv}
        GROUP BY p."gameVersion", m."queueId", pa."augmentId"
        ON CONFLICT DO NOTHING
      `
      console.log(`done (${Date.now() - t}ms)`)
    }
  }
}

async function rebuildPlayers(sql) {
  const pvList = await getPatches(sql)
  if (pvList.length === 0) { console.log('[players] no patches found, skipping'); return }

  const existingRows = await sql`SELECT DISTINCT "gameVersion" FROM player_stats_cache`
  const existing = new Set(existingRows.map(r => r.gameVersion))
  const missing = pvList.filter(gv => !existing.has(gv))

  if (missing.length === 0) {
    console.log('[players] player_stats_cache up to date')
    return
  }

  console.log(`[players] backfilling player_stats_cache (${missing.length} patches)...`)
  for (let i = 0; i < missing.length; i++) {
    const gv = missing[i]
    const t = Date.now()
    process.stdout.write(`[players] ${gv} (${i + 1}/${missing.length})... `)
    await sql`
      INSERT INTO player_stats_cache ("gameVersion","queueId",puuid,"summonerName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion", m."queueId", p.puuid, MAX(p."summonerName"),
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
        SUM(p."damageDealt")::bigint, SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p."gameVersion" = ${gv} AND p.puuid != ''
      GROUP BY p."gameVersion", m."queueId", p.puuid
      ON CONFLICT DO NOTHING
    `
    console.log(`done (${Date.now() - t}ms)`)
  }
  console.log('[players] player_stats_cache complete')
}

async function rebuildPlayerChampions(sql) {
  const pvList = await getPatches(sql)
  if (pvList.length === 0) { console.log('[player-champions] no patches found, skipping'); return }

  const existingRows = await sql`SELECT DISTINCT "gameVersion" FROM player_champion_stats_cache`
  const existing = new Set(existingRows.map(r => r.gameVersion))
  const missing = pvList.filter(gv => !existing.has(gv))

  if (missing.length === 0) {
    console.log('[player-champions] player_champion_stats_cache up to date')
    return
  }

  console.log(`[player-champions] backfilling player_champion_stats_cache (${missing.length} patches)...`)
  for (let i = 0; i < missing.length; i++) {
    const gv = missing[i]
    const t = Date.now()
    process.stdout.write(`[player-champions] ${gv} (${i + 1}/${missing.length})... `)
    await sql`
      INSERT INTO player_champion_stats_cache
        ("gameVersion","queueId",puuid,"championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration,total_gold,total_team_kills)
      SELECT p."gameVersion",m."queueId",p.puuid,p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p.kills)::int,SUM(p.deaths)::int,SUM(p.assists)::int,
        SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint,
        SUM(p."goldEarned")::bigint,
        SUM(tk.team_kills)::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN (
        SELECT "gameId","teamId",SUM(kills)::bigint AS team_kills
        FROM participants GROUP BY "gameId","teamId"
      ) tk ON tk."gameId" = p."gameId" AND tk."teamId" = p."teamId"
      WHERE p."gameVersion" = ${gv} AND p.puuid != ''
      GROUP BY p."gameVersion",m."queueId",p.puuid,p."championId"
      ON CONFLICT DO NOTHING
    `
    console.log(`done (${Date.now() - t}ms)`)
  }
  console.log('[player-champions] player_champion_stats_cache complete')
}

async function rebuildPerformance(sql) {
  const existingPerfRows = await sql`SELECT DISTINCT "gameVersion","queueId" FROM player_performance_cache`
  const existingPerf = new Set(existingPerfRows.map(r => `${r.gameVersion}:${r.queueId}`))
  const pcsRows = await sql`SELECT DISTINCT "gameVersion","queueId" FROM player_champion_stats_cache`
  const missing = pcsRows.filter(r => !existingPerf.has(`${r.gameVersion}:${r.queueId}`))

  if (missing.length === 0) {
    console.log('[performance] player_performance_cache up to date')
    return
  }

  console.log(`[performance] backfilling player_performance_cache (${missing.length} patch-queue pairs)...`)
  for (const { gameVersion: gv, queueId: qId } of missing) {
    const t = Date.now()
    process.stdout.write(`[performance] ${gv}:${qId}... `)
    await buildPerformanceCache(sql, gv, Number(qId))
    console.log(`done (${Date.now() - t}ms)`)
  }
  console.log('[performance] player_performance_cache complete')
}

async function buildPerformanceCache(sql, gameVersion, queueId) {
  const champRows = await sql`
    SELECT
      pcs.puuid,
      SUM(pcs.games)::int AS games,
      COALESCE(
        SUM(pcs.games * cs.wins::float / NULLIF(cs.games, 0)) / NULLIF(SUM(pcs.games)::float, 0) - 0.5,
        0
      ) AS cpq,
      COALESCE(
        SUM(pcs.total_kills + pcs.total_assists)::float / NULLIF(SUM(pcs.total_team_kills)::float, 0)
        - SUM((cs.total_kills + cs.total_assists)::float / NULLIF(cs.total_team_kills::float, 0) * pcs.total_team_kills::float)
          / NULLIF(SUM(pcs.total_team_kills)::float, 0),
        0
      ) AS kp_delta,
      COALESCE(
        SUM(pcs.total_damage)::float
        / NULLIF(SUM(cs.total_damage::float * pcs.total_duration::float / NULLIF(cs.total_duration::float, 0)), 0)
        - 1,
        0
      ) AS dpm_pct,
      COALESCE(
        SUM(pcs.total_gold)::float
        / NULLIF(SUM(cs.total_gold::float * pcs.total_duration::float / NULLIF(cs.total_duration::float, 0)), 0)
        - 1,
        0
      ) AS gpm_pct
    FROM player_champion_stats_cache pcs
    JOIN champion_stats_cache cs
      ON cs."championId" = pcs."championId"
      AND cs."queueId" = pcs."queueId"
      AND cs."gameVersion" = pcs."gameVersion"
    WHERE pcs."queueId" = ${queueId} AND pcs."gameVersion" = ${gameVersion}
    GROUP BY pcs.puuid
  `
  if (champRows.length === 0) return

  const augRows = await sql`
    WITH aug_wr AS (
      SELECT "augmentId",
        SUM(wins)::float / NULLIF(SUM(pick_count)::float, 0) AS wr
      FROM augment_stats_cache
      WHERE "queueId" = ${queueId} AND "gameVersion" = ${gameVersion}
      GROUP BY "augmentId"
    ),
    avg_aug AS (SELECT COALESCE(AVG(wr), 0.5) AS avg_wr FROM aug_wr)
    SELECT
      pas.puuid,
      COALESCE(
        SUM(pas.pick_count * COALESCE(aw.wr, (SELECT avg_wr FROM avg_aug))) / NULLIF(SUM(pas.pick_count)::float, 0)
        - (SELECT avg_wr FROM avg_aug),
        0
      ) AS apq
    FROM player_augment_stats_cache pas
    LEFT JOIN aug_wr aw ON aw."augmentId" = pas."augmentId"
    WHERE pas."queueId" = ${queueId} AND pas."gameVersion" = ${gameVersion}
    GROUP BY pas.puuid
  `

  const apqMap = new Map(augRows.map(r => [r.puuid, Number(r.apq)]))
  const rows = champRows.map(r => [
    r.puuid, queueId, gameVersion,
    Number(r.games),
    Number(r.cpq),
    apqMap.get(r.puuid) ?? 0,
    Number(r.kp_delta),
    Number(r.dpm_pct),
    Number(r.gpm_pct),
  ])

  const CHUNK = 5000
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    await sql`
      INSERT INTO player_performance_cache (puuid,"queueId","gameVersion",games,cpq,apq,kp_delta,dpm_pct,gpm_pct)
      VALUES ${sql(chunk)}
      ON CONFLICT (puuid,"queueId","gameVersion") DO UPDATE SET
        games    = EXCLUDED.games,
        cpq      = EXCLUDED.cpq,
        apq      = EXCLUDED.apq,
        kp_delta = EXCLUDED.kp_delta,
        dpm_pct  = EXCLUDED.dpm_pct,
        gpm_pct  = EXCLUDED.gpm_pct
    `
  }
}

async function rebuildItems(sql) {
  const pvList = await getPatches(sql)
  if (pvList.length === 0) { console.log('[items] no patches found, skipping'); return }

  const todoBuilds = []
  const todoPicks = []
  for (const gv of pvList) {
    const [{ count: bc }] = await sql`SELECT COUNT(*) FROM item_builds_cache WHERE "gameVersion" = ${gv}`
    if (Number(bc) === 0) todoBuilds.push(gv)
    const [{ count: pc }] = await sql`SELECT COUNT(*) FROM item_picks_cache WHERE "gameVersion" = ${gv}`
    if (Number(pc) === 0) todoPicks.push(gv)
  }

  if (todoBuilds.length === 0 && todoPicks.length === 0) {
    console.log('[items] item_builds_cache and item_picks_cache up to date')
    return
  }

  for (let i = 0; i < todoBuilds.length; i++) {
    const gv = todoBuilds[i]
    const t = Date.now()
    process.stdout.write(`[item-builds] ${gv} (${i + 1}/${todoBuilds.length})... `)
    await sql`
      WITH agg AS (
        SELECT p."gameVersion", m."queueId", p."championId", p.win::int AS win,
          array_agg(pi."itemId" ORDER BY pi."itemId") AS items
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN participant_items pi ON pi."participantId" = p.id
        WHERE p."gameVersion" = ${gv}
        GROUP BY p."gameVersion", m."queueId", p.id, p."championId", p.win
        HAVING count(*) >= 5
      ),
      combos AS (
        SELECT agg."gameVersion", agg."queueId", agg."championId", agg.win,
          ARRAY[ua.item, ub.item, uc.item, ud.item, ue.item] AS build
        FROM agg,
          LATERAL unnest(agg.items) WITH ORDINALITY AS ua(item, pa),
          LATERAL unnest(agg.items) WITH ORDINALITY AS ub(item, pb),
          LATERAL unnest(agg.items) WITH ORDINALITY AS uc(item, pc),
          LATERAL unnest(agg.items) WITH ORDINALITY AS ud(item, pd),
          LATERAL unnest(agg.items) WITH ORDINALITY AS ue(item, pe)
        WHERE ub.pb > ua.pa AND uc.pc > ub.pb AND ud.pd > uc.pc AND ue.pe > ud.pd
      )
      INSERT INTO item_builds_cache ("gameVersion","queueId","championId",build,games,wins)
      SELECT "gameVersion","queueId","championId",build,COUNT(*)::int,SUM(win)::int
      FROM combos GROUP BY "gameVersion","queueId","championId",build
      ON CONFLICT DO NOTHING
    `
    console.log(`done (${Date.now() - t}ms)`)
  }

  for (let i = 0; i < todoPicks.length; i++) {
    const gv = todoPicks[i]
    const t = Date.now()
    process.stdout.write(`[item-picks] ${gv} (${i + 1}/${todoPicks.length})... `)
    await sql`
      INSERT INTO item_picks_cache ("gameVersion","queueId","championId","itemId",picks,wins,slot_emptiness_sum,slot_emptiness_count)
      SELECT p."gameVersion", m."queueId", p."championId", pi."itemId",
             COUNT(*)::int,
             SUM(p.win::int)::int,
             SUM(COALESCE(6 - array_length(pis."itemIds", 1), 0))::float,
             COUNT(*)::int
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN participant_items pi ON pi."participantId" = p.id
      LEFT JOIN participant_item_sets pis ON pis."participantId" = p.id
      WHERE p."gameVersion" = ${gv}
      GROUP BY p."gameVersion", m."queueId", p."championId", pi."itemId"
      ON CONFLICT DO NOTHING
    `
    console.log(`done (${Date.now() - t}ms)`)
  }

  if (todoBuilds.length > 0) console.log('[item-builds] complete')
  if (todoPicks.length > 0) console.log('[item-picks] complete')
}

async function rebuildAugmentChampions(sql) {
  const pvList = await getPatches(sql)
  if (pvList.length === 0) { console.log('[augment-champions] no patches found, skipping'); return }

  let anyWork = false
  for (const gv of pvList) {
    const [{ count }] = await sql`SELECT COUNT(*) FROM augment_champion_stats_cache WHERE "gameVersion" = ${gv}`
    if (Number(count) > 0) continue

    if (!anyWork) {
      console.log('[augment-champions] backfilling augment_champion_stats_cache...')
      anyWork = true
    }
    const t = Date.now()
    process.stdout.write(`[augment-champions] ${gv}... `)
    await sql`
      INSERT INTO augment_champion_stats_cache
        ("gameVersion","queueId","augmentId","championId","championName",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion",m."queueId",pa."augmentId",p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN participant_augments pa ON pa."participantId"=p.id
      WHERE p."gameVersion" = ${gv}
      GROUP BY p."gameVersion",m."queueId",pa."augmentId",p."championId"
      ON CONFLICT DO NOTHING
    `
    console.log(`done (${Date.now() - t}ms)`)
  }

  // Fix slot_emptiness on item_picks_cache rows that were inserted before the column existed
  for (const gv of pvList) {
    const [{ count: zc }] = await sql`SELECT COUNT(*) FROM item_picks_cache WHERE "gameVersion" = ${gv} AND slot_emptiness_count = 0`
    if (Number(zc) === 0) continue
    process.stdout.write(`[augment-champions] fixing slot_emptiness for ${gv}... `)
    const t = Date.now()
    await sql`
      UPDATE item_picks_cache ipc
      SET slot_emptiness_sum   = sub.es,
          slot_emptiness_count = sub.ec
      FROM (
        SELECT p."gameVersion", m."queueId", p."championId", pi."itemId",
          SUM(COALESCE(6 - array_length(pis."itemIds", 1), 0))::float AS es,
          COUNT(*)::int AS ec
        FROM participants p
        JOIN matches m ON m."gameId" = p."gameId"
        JOIN participant_items pi ON pi."participantId" = p.id
        LEFT JOIN participant_item_sets pis ON pis."participantId" = p.id
        WHERE p."gameVersion" = ${gv}
        GROUP BY p."gameVersion", m."queueId", p."championId", pi."itemId"
      ) sub
      WHERE ipc."gameVersion" = sub."gameVersion"
        AND ipc."queueId" = sub."queueId"
        AND ipc."championId" = sub."championId"
        AND ipc."itemId" = sub."itemId"
        AND ipc.slot_emptiness_count = 0
    `
    console.log(`done (${Date.now() - t}ms)`)
  }

  if (!anyWork) console.log('[augment-champions] augment_champion_stats_cache up to date')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify the script runs without errors against dev DB**

```
node scripts/rebuild-caches.mjs --caches=summary
```
Expected output (example — actual patch versions will vary):
```
[summary] champion_stats_cache up to date
[summary] augment_stats_cache up to date
```
(If caches are already populated from startup, both will show "up to date". That confirms the idempotency check works.)

- [ ] **Step 3: Commit**

```
git add scripts/rebuild-caches.mjs
git commit -m "feat: add rebuild-caches.mjs script for all cache backfills"
```

---

## Self-Review

**Spec coverage:**
- ✅ Strip 6 data-fill blocks from `initDb` → Task 1
- ✅ Remove `onProgress` param → Task 1 Step 1
- ✅ Keep DDL + TRUNCATE migration guards in `initDb` → Task 1 note
- ✅ Delete `backfillDetailCaches` export → Task 1 Step 6
- ✅ Strip `server-entry.ts` wiring → Task 2
- ✅ Strip `backfill-progress` IPC → Task 3
- ✅ Strip renderer state + UI + CSS → Task 4
- ✅ New `rebuild-caches.mjs` with `--caches` flag → Task 5
- ✅ `augment-champions` target includes slot_emptiness fix (was in `backfillDetailCaches`) → Task 5

**Placeholder scan:** No TBDs, no "similar to above", all code blocks are complete.

**Type consistency:** The `buildPerformanceCache(sql, gameVersion, queueId)` function defined in Task 5 is called only once in `rebuildPerformance` with matching argument types.

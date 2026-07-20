import path from 'path'
import dotenv from 'dotenv'
const envFile = process.env.NODE_ENV !== 'production' ? '.env.dev' : '.env'
dotenv.config({ path: path.resolve(__dirname, '../../', envFile), override: true })
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: false })
import postgres from 'postgres'

const SYNC_LEASE_MS = 5 * 60 * 1000
const ARCHETYPE_CACHE_VERSION = 7

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AugmentInfo {
  id: number
  name: string
  desc: string
  iconPath: string
  rarity: number
}

export interface Participant {
  puuid: string
  summonerName: string
  championId: number
  championName: string
  teamId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  damageDealt: number
  damageTaken: number
  goldEarned: number
  champLevel: number
  augments: number[]
  items?: Array<{ id: number; slot: number }>
}

export interface Match {
  gameId: number
  queueId: number
  gameCreation: number
  gameDuration: number
  gameVersion?: string
  participants: Participant[]
}

// ─── DB init ─────────────────────────────────────────────────────────────────

let sql_: ReturnType<typeof postgres>

export async function initDb(url?: string, onProgress?: (phase: string) => void): Promise<void> {
  const connectionUrl = url ?? process.env.DATABASE_URL
  if (!connectionUrl) throw new Error('DATABASE_URL is not set')

  sql_ = postgres(connectionUrl, { onnotice: () => {} })

  console.log('[db] creating tables...')
  await sql_`
    CREATE TABLE IF NOT EXISTS matches (
      "gameId"       BIGINT PRIMARY KEY,
      "queueId"      INTEGER NOT NULL,
      "gameCreation" BIGINT NOT NULL,
      "gameDuration" INTEGER NOT NULL,
      "gameVersion"  TEXT
    )
  `
  await sql_`ALTER TABLE matches ADD COLUMN IF NOT EXISTS "gameVersion" TEXT`
  await sql_`
    CREATE TABLE IF NOT EXISTS participants (
      id             SERIAL PRIMARY KEY,
      "gameId"       BIGINT NOT NULL REFERENCES matches("gameId"),
      puuid          TEXT NOT NULL,
      "summonerName" TEXT NOT NULL,
      "championId"   INTEGER NOT NULL,
      "championName" TEXT NOT NULL,
      "teamId"       INTEGER NOT NULL,
      win            BOOLEAN NOT NULL,
      kills          INTEGER NOT NULL,
      deaths         INTEGER NOT NULL,
      assists        INTEGER NOT NULL,
      "damageDealt"  INTEGER NOT NULL,
      "damageTaken"  INTEGER NOT NULL,
      "goldEarned"   INTEGER NOT NULL,
      "champLevel"   INTEGER NOT NULL,
      "gameVersion"  TEXT,
      "gameDuration" INTEGER
    )
  `
  await sql_`ALTER TABLE participants ADD COLUMN IF NOT EXISTS "gameVersion" TEXT`
  await sql_`ALTER TABLE participants ADD COLUMN IF NOT EXISTS "gameDuration" INTEGER`
  await sql_`
    CREATE TABLE IF NOT EXISTS participant_augments (
      "participantId" INTEGER NOT NULL REFERENCES participants(id),
      "augmentId"     INTEGER NOT NULL
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS participant_items (
      "participantId" INTEGER NOT NULL REFERENCES participants(id),
      "itemId"        INTEGER NOT NULL
    )
  `
  await sql_`ALTER TABLE participant_items ADD COLUMN IF NOT EXISTS "slot" INTEGER`
  await sql_`
    CREATE TABLE IF NOT EXISTS participant_item_sets (
      "participantId" INTEGER NOT NULL UNIQUE REFERENCES participants(id),
      "itemIds"       INTEGER[] NOT NULL
    )
  `
  await sql_`CREATE INDEX IF NOT EXISTS idx_participant_item_sets_gin ON participant_item_sets USING GIN ("itemIds")`
  await sql_`
    INSERT INTO participant_item_sets ("participantId", "itemIds")
    SELECT "participantId", array_agg("itemId" ORDER BY "itemId")
    FROM participant_items
    GROUP BY "participantId"
    ON CONFLICT ("participantId") DO NOTHING
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS player_sync_times (
      puuid     TEXT PRIMARY KEY,
      "syncedAt" BIGINT NOT NULL
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS sync_queue (
      puuid            TEXT PRIMARY KEY,
      queued_at        BIGINT NOT NULL,
      claimed_at       BIGINT,
      claimed_by       TEXT,
      lease_expires_at BIGINT,
      priority         INT NOT NULL DEFAULT 0
    )
  `

  console.log('[db] creating indexes...')
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_gameId       ON participants("gameId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_puuid        ON participants(puuid)`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_puuid_id     ON participants(puuid, id DESC)`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_championId   ON participants("championId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_puuid_gameid ON participants(puuid, "gameId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_puuid_champ  ON participants(puuid, "championId", "gameId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_puuid_gameVersion ON participants(puuid, "gameVersion")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_matches_gameVersion       ON matches("gameVersion")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_matches_gameCreation      ON matches("gameCreation")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_augments_participantId           ON participant_augments("participantId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_augments_participantId_augmentId ON participant_augments("participantId", "augmentId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_items_participantId ON participant_items("participantId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_items_itemId        ON participant_items("itemId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_champid_gameid ON participants("championId", "gameId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_gameVersion        ON participants("gameVersion")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_gameVersion_champ  ON participants("gameVersion", "championId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_gameVersion_puuid  ON participants("gameVersion", puuid)`
  await sql_`CREATE INDEX IF NOT EXISTS idx_sync_queue_queued_at            ON sync_queue(queued_at)`
  await sql_`CREATE EXTENSION IF NOT EXISTS pg_trgm`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_summonerName_trgm ON participants USING gin ("summonerName" gin_trgm_ops)`

  await sql_`
    CREATE TABLE IF NOT EXISTS meta_champions (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS meta_augments (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      rarity     INTEGER NOT NULL DEFAULT 0,
      icon_path  TEXT NOT NULL DEFAULT ''
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS champion_stats_cache (
      "gameVersion"  TEXT NOT NULL,
      "championId"   INTEGER NOT NULL,
      "championName" TEXT NOT NULL DEFAULT '',
      games          INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      total_kills    INTEGER NOT NULL DEFAULT 0,
      total_deaths   INTEGER NOT NULL DEFAULT 0,
      total_assists  INTEGER NOT NULL DEFAULT 0,
      total_damage   BIGINT NOT NULL DEFAULT 0,
      total_duration BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", "championId")
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS augment_stats_cache (
      "gameVersion"  TEXT NOT NULL,
      "augmentId"    INTEGER NOT NULL,
      pick_count     INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      total_damage   BIGINT NOT NULL DEFAULT 0,
      total_duration BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", "augmentId")
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS player_stats_cache (
      "gameVersion"   TEXT    NOT NULL,
      puuid           TEXT    NOT NULL,
      "summonerName"  TEXT    NOT NULL DEFAULT '',
      games           INTEGER NOT NULL DEFAULT 0,
      wins            INTEGER NOT NULL DEFAULT 0,
      total_kills     INTEGER NOT NULL DEFAULT 0,
      total_deaths    INTEGER NOT NULL DEFAULT 0,
      total_assists   INTEGER NOT NULL DEFAULT 0,
      total_damage    BIGINT  NOT NULL DEFAULT 0,
      total_duration  BIGINT  NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", puuid)
    )
  `
  await sql_`CREATE INDEX IF NOT EXISTS idx_player_stats_cache_puuid ON player_stats_cache (puuid)`
  await sql_`
    CREATE TABLE IF NOT EXISTS player_champion_stats_cache (
      "gameVersion"  TEXT    NOT NULL,
      puuid          TEXT    NOT NULL,
      "championId"   INTEGER NOT NULL,
      "championName" TEXT    NOT NULL DEFAULT '',
      games          INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      total_kills    INTEGER NOT NULL DEFAULT 0,
      total_deaths   INTEGER NOT NULL DEFAULT 0,
      total_assists  INTEGER NOT NULL DEFAULT 0,
      total_damage   BIGINT  NOT NULL DEFAULT 0,
      total_duration BIGINT  NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", puuid, "championId")
    )
  `
  await sql_`CREATE INDEX IF NOT EXISTS idx_player_champion_stats_cache_puuid ON player_champion_stats_cache (puuid)`
  await sql_`
    CREATE TABLE IF NOT EXISTS augment_champion_stats_cache (
      "gameVersion"  TEXT    NOT NULL,
      "augmentId"    INTEGER NOT NULL,
      "championId"   INTEGER NOT NULL,
      "championName" TEXT    NOT NULL DEFAULT '',
      pick_count     INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      total_damage   BIGINT  NOT NULL DEFAULT 0,
      total_duration BIGINT  NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", "augmentId", "championId")
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS item_builds_cache (
      "gameVersion"  TEXT      NOT NULL,
      "championId"   INTEGER   NOT NULL,
      build          INTEGER[] NOT NULL,
      games          INTEGER   NOT NULL DEFAULT 0,
      wins           INTEGER   NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", "championId", build)
    )
  `
  await sql_`CREATE INDEX IF NOT EXISTS idx_item_builds_cache_champ_gv ON item_builds_cache ("championId", "gameVersion")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_item_builds_cache_build ON item_builds_cache USING gin(build)`
  await sql_`
    CREATE TABLE IF NOT EXISTS item_quads_cache (
      "gameVersion"  TEXT      NOT NULL,
      "championId"   INTEGER   NOT NULL,
      quad           INTEGER[] NOT NULL,
      games          INTEGER   NOT NULL DEFAULT 0,
      wins           INTEGER   NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", "championId", quad)
    )
  `
  await sql_`ALTER TABLE item_quads_cache DROP COLUMN IF EXISTS slot_sums`
  await sql_`ALTER TABLE item_quads_cache DROP COLUMN IF EXISTS slot_counts`
  await sql_`CREATE INDEX IF NOT EXISTS idx_item_quads_cache_champ_gv ON item_quads_cache ("championId", "gameVersion")`
  await sql_`
    CREATE TABLE IF NOT EXISTS meta_items (
      id           int  PRIMARY KEY,
      name         text NOT NULL,
      "iconPath"   text,
      category     text,
      is_component boolean DEFAULT false
    )
  `
  await sql_`ALTER TABLE meta_items ADD COLUMN IF NOT EXISTS is_component boolean DEFAULT false`
  await sql_`
    CREATE TABLE IF NOT EXISTS item_archetypes_cache (
      "championId"  int  NOT NULL,
      patches_key   text NOT NULL,
      archetypes    jsonb NOT NULL,
      computed_at   timestamptz DEFAULT now(),
      PRIMARY KEY ("championId", patches_key)
    )
  `
const [{ count: champCacheCount }] = await sql_`SELECT COUNT(*) FROM champion_stats_cache`
  if (Number(champCacheCount) === 0) {
    console.log('[db] backfilling summary caches...')
    onProgress?.('Rebuilding champion & augment cache…')
    await sql_`
      INSERT INTO champion_stats_cache ("gameVersion","championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion", p."championId", MIN(p."championName"),
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration")
      FROM participants p
      WHERE p."gameVersion" IS NOT NULL
      GROUP BY p."gameVersion", p."championId"
      ON CONFLICT DO NOTHING
    `
    await sql_`
      INSERT INTO augment_stats_cache ("gameVersion","augmentId",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion", pa."augmentId",
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration")
      FROM participants p
      JOIN participant_augments pa ON pa."participantId" = p.id
      WHERE p."gameVersion" IS NOT NULL
      GROUP BY p."gameVersion", pa."augmentId"
      ON CONFLICT DO NOTHING
    `
    console.log('[db] backfill complete')
  }

  {
    // Per-patch backfill for player caches — avoids huge hash aggregates that spill to disk
    const pvRows = await sql_`SELECT DISTINCT "gameVersion" FROM participants WHERE "gameVersion" IS NOT NULL ORDER BY 1`
    const pvList = pvRows.map((r: any) => r.gameVersion as string)
    const existingPlayerRows = await sql_`SELECT DISTINCT "gameVersion" FROM player_stats_cache`
    const existingPlayer = new Set(existingPlayerRows.map((r: any) => r.gameVersion as string))
    const missingPlayer = pvList.filter(gv => !existingPlayer.has(gv))
    if (missingPlayer.length > 0) {
      console.log(`[db] backfilling player stats cache (${missingPlayer.length} patches)...`)
      for (let i = 0; i < missingPlayer.length; i++) {
        const gv = missingPlayer[i]
        console.log(`[db] player stats ${gv} (${i + 1}/${missingPlayer.length})...`)
        onProgress?.(`Rebuilding player cache: ${gv} (${i + 1}/${missingPlayer.length})…`)
        await sql_`
          INSERT INTO player_stats_cache ("gameVersion",puuid,"summonerName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
          SELECT ${gv}, p.puuid, MAX(p."summonerName"),
            COUNT(*)::int, SUM(p.win::int)::int,
            SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
            SUM(p."damageDealt")::bigint, SUM(p."gameDuration")::bigint
          FROM participants p
          WHERE p."gameVersion" = ${gv} AND p.puuid != ''
          GROUP BY p.puuid
          ON CONFLICT DO NOTHING
        `
      }
      console.log('[db] player stats cache backfill complete')
    }
    const existingPCRows = await sql_`SELECT DISTINCT "gameVersion" FROM player_champion_stats_cache`
    const existingPC = new Set(existingPCRows.map((r: any) => r.gameVersion as string))
    const missingPC = pvList.filter(gv => !existingPC.has(gv))
    if (missingPC.length > 0) {
      console.log(`[db] backfilling player_champion_stats_cache (${missingPC.length} patches)...`)
      for (let i = 0; i < missingPC.length; i++) {
        const gv = missingPC[i]
        console.log(`[db] player_champion_stats ${gv} (${i + 1}/${missingPC.length})...`)
        onProgress?.(`Rebuilding player/champion cache: ${gv} (${i + 1}/${missingPC.length})…`)
        await sql_`
          INSERT INTO player_champion_stats_cache
            ("gameVersion",puuid,"championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
          SELECT ${gv},p.puuid,p."championId",MIN(p."championName"),
            COUNT(*)::int,SUM(p.win::int)::int,SUM(p.kills)::int,SUM(p.deaths)::int,SUM(p.assists)::int,
            SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
          FROM participants p
          WHERE p."gameVersion" = ${gv} AND p.puuid != ''
          GROUP BY p.puuid,p."championId"
          ON CONFLICT DO NOTHING
        `
      }
      console.log('[db] player_champion_stats_cache backfill complete')
    }
  }

  ;(async () => {
    try {
      const patches = await getPatches()
      const todoBuilds: string[] = []
      const todoQuads: string[] = []
      for (const gv of patches) {
        const [{ count: bc }] = await sql_`SELECT COUNT(*) FROM item_builds_cache WHERE "gameVersion" = ${gv}`
        if (Number(bc) === 0) todoBuilds.push(gv)
        const [{ count: qc }] = await sql_`SELECT COUNT(*) FROM item_quads_cache WHERE "gameVersion" = ${gv}`
        if (Number(qc) === 0) todoQuads.push(gv)
      }
      if (todoBuilds.length === 0 && todoQuads.length === 0) return
      if (todoBuilds.length > 0) {
        console.log(`[item-builds] backfilling ${todoBuilds.length} patch(es)...`)
        onProgress?.('Building item builds cache…')
        for (let i = 0; i < todoBuilds.length; i++) {
          const gv = todoBuilds[i]
          console.log(`[item-builds] ${gv} (${i + 1}/${todoBuilds.length})...`)
          onProgress?.(`Building item builds: ${gv} (${i + 1}/${todoBuilds.length})…`)
          await sql_`
            WITH agg AS (
              SELECT p."gameVersion", p."championId", p.win::int AS win,
                array_agg(pi."itemId" ORDER BY pi."itemId") AS items
              FROM participants p JOIN participant_items pi ON pi."participantId" = p.id
              WHERE p."gameVersion" = ${gv}
              GROUP BY p."gameVersion", p.id, p."championId", p.win
              HAVING count(*) >= 5
            ),
            combos AS (
              SELECT agg."gameVersion", agg."championId", agg.win,
                ARRAY[ua.item, ub.item, uc.item, ud.item, ue.item] AS build
              FROM agg,
                LATERAL unnest(agg.items) WITH ORDINALITY AS ua(item, pa),
                LATERAL unnest(agg.items) WITH ORDINALITY AS ub(item, pb),
                LATERAL unnest(agg.items) WITH ORDINALITY AS uc(item, pc),
                LATERAL unnest(agg.items) WITH ORDINALITY AS ud(item, pd),
                LATERAL unnest(agg.items) WITH ORDINALITY AS ue(item, pe)
              WHERE ub.pb > ua.pa AND uc.pc > ub.pb AND ud.pd > uc.pc AND ue.pe > ud.pd
            )
            INSERT INTO item_builds_cache ("gameVersion","championId",build,games,wins)
            SELECT "gameVersion","championId",build,COUNT(*)::int,SUM(win)::int
            FROM combos GROUP BY "gameVersion","championId",build
            ON CONFLICT DO NOTHING
          `
          console.log(`[item-builds] ${gv} done`)
        }
        console.log('[item-builds] backfill complete')
      }
      if (todoQuads.length > 0) {
        console.log(`[item-quads] backfilling ${todoQuads.length} patch(es)...`)
        onProgress?.('Building item quads cache…')
        for (let i = 0; i < todoQuads.length; i++) {
          const gv = todoQuads[i]
          console.log(`[item-quads] ${gv} (${i + 1}/${todoQuads.length})...`)
          onProgress?.(`Building item quads: ${gv} (${i + 1}/${todoQuads.length})…`)
          await sql_`
            WITH agg AS (
              SELECT p."gameVersion", p."championId", p.win::int AS win,
                pis."itemIds"
              FROM participants p
              JOIN participant_item_sets pis ON pis."participantId" = p.id
              WHERE p."gameVersion" = ${gv}
                AND array_length(pis."itemIds", 1) >= 4
            ),
            quads AS (
              SELECT a."gameVersion", a."championId", a.win,
                ARRAY[ua.item, ub.item, uc.item, ud.item] AS quad
              FROM agg a,
                LATERAL unnest(a."itemIds") WITH ORDINALITY AS ua(item, pa),
                LATERAL unnest(a."itemIds") WITH ORDINALITY AS ub(item, pb),
                LATERAL unnest(a."itemIds") WITH ORDINALITY AS uc(item, pc),
                LATERAL unnest(a."itemIds") WITH ORDINALITY AS ud(item, pd)
              WHERE ub.pb > ua.pa AND uc.pc > ub.pb AND ud.pd > uc.pc
            )
            INSERT INTO item_quads_cache ("gameVersion","championId",quad,games,wins)
            SELECT "gameVersion","championId",quad,COUNT(*)::int,SUM(win)::int
            FROM quads
            GROUP BY "gameVersion","championId",quad
            ON CONFLICT DO NOTHING
          `
          console.log(`[item-quads] ${gv} done`)
        }
        console.log('[item-quads] backfill complete')
        // Wipe archetype cache so next request recomputes with fresh quad data
        await sql_`DELETE FROM item_archetypes_cache`
      }
      onProgress?.('')
    } catch (e) {
      console.warn('[item-builds/quads] backfill failed:', (e as Error).message)
    }
  })()

  // Prune raw match data older than the 4 most recent patches.
  // Aggregate stats are preserved in cache tables so nothing is lost analytically.
  const allPatchRows = await sql_`
    SELECT DISTINCT "gameVersion" FROM matches WHERE "gameVersion" IS NOT NULL
  `
  const allPatches = allPatchRows
    .map((r: any) => r.gameVersion as string)
    .sort((a: string, b: string) => {
      const [aMaj, aMin] = a.split('.').map(Number)
      const [bMaj, bMin] = b.split('.').map(Number)
      return bMaj !== aMaj ? bMaj - aMaj : bMin - aMin
    })
  const keepPatches = allPatches.slice(0, 4)
  if (keepPatches.length === 4) {
    const pruned = await deleteOldMatches(keepPatches)
    if (pruned > 0) console.log(`[db] pruned ${pruned} old matches (keeping: ${keepPatches.join(', ')})`)
  }
}

export async function deleteOldMatches(keepPatches: string[]): Promise<number> {
  const oldIds = (await sql_`
    SELECT "gameId" FROM matches
    WHERE "gameVersion" IS NOT NULL AND "gameVersion" <> ALL(${keepPatches})
  `).map((r: any) => Number(r.gameId))

  if (oldIds.length === 0) return 0

  await sql_.begin(async (tx: any) => {
    await tx`
      DELETE FROM participant_augments WHERE "participantId" IN (
        SELECT id FROM participants WHERE "gameId" = ANY(${oldIds})
      )
    `
    await tx`
      DELETE FROM participant_items WHERE "participantId" IN (
        SELECT id FROM participants WHERE "gameId" = ANY(${oldIds})
      )
    `
    await tx`
      DELETE FROM participant_item_sets WHERE "participantId" IN (
        SELECT id FROM participants WHERE "gameId" = ANY(${oldIds})
      )
    `
    await tx`DELETE FROM participants WHERE "gameId" = ANY(${oldIds})`
    await tx`DELETE FROM matches WHERE "gameId" = ANY(${oldIds})`
    await tx`DELETE FROM item_builds_cache WHERE "gameVersion" <> ALL(${keepPatches})`
    await tx`DELETE FROM item_quads_cache WHERE "gameVersion" <> ALL(${keepPatches})`
  })

  return oldIds.length
}

export async function backfillDetailCaches(onProgress?: (phase: string) => void): Promise<void> {
  const patches = await getPatches()
  if (patches.length === 0) return
  for (const gv of patches) {
    const [{ count }] = await sql_`SELECT COUNT(*) FROM augment_champion_stats_cache WHERE "gameVersion" = ${gv}`
    if (Number(count) > 0) continue
    console.log(`[backfill] augment_champion ${gv}...`)
    onProgress?.(`Building augment/champion stats for ${gv}…`)
    await sql_`
      INSERT INTO augment_champion_stats_cache
        ("gameVersion","augmentId","championId","championName",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion",pa."augmentId",p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN participant_augments pa ON pa."participantId"=p.id
      WHERE p."gameVersion" = ${gv}
      GROUP BY p."gameVersion",pa."augmentId",p."championId"
      ON CONFLICT DO NOTHING
    `
    console.log(`[backfill] augment_champion ${gv} done`)
  }
  onProgress?.('')
  console.log('[backfill] complete')
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function upsertChampions(map: Record<number, string>): Promise<void> {
  const rows = Object.entries(map).map(([id, name]) => [parseInt(id), name])
  if (rows.length === 0) return
  await sql_`
    INSERT INTO meta_champions (id, name)
    VALUES ${sql_(rows as any)}
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `
}

export async function upsertAugments(map: Record<number, AugmentInfo>): Promise<void> {
  const rows = Object.values(map).map(a => [a.id, a.name, a.rarity, a.iconPath])
  if (rows.length === 0) return
  await sql_`
    INSERT INTO meta_augments (id, name, rarity, icon_path)
    VALUES ${sql_(rows as any)}
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, rarity = EXCLUDED.rarity, icon_path = EXCLUDED.icon_path
  `
}

export async function getChampionsFromDb(): Promise<Record<number, string>> {
  const rows = await sql_<{ id: number; name: string }[]>`SELECT id, name FROM meta_champions`
  return Object.fromEntries(rows.map(r => [r.id, r.name]))
}

export async function getAugmentsFromDb(): Promise<Record<number, AugmentInfo>> {
  const rows = await sql_<{ id: number; name: string; rarity: number; icon_path: string }[]>`
    SELECT id, name, rarity, icon_path FROM meta_augments
  `
  return Object.fromEntries(rows.map(r => [
    r.id,
    { id: r.id, name: r.name, desc: '', iconPath: r.icon_path, rarity: r.rarity }
  ]))
}

// ─── Patch inference ──────────────────────────────────────────────────────────

const PATCH_DATES: { patch: string; startMs: number }[] = [
  { patch: '14.1',  startMs: new Date('2024-01-10T12:00:00Z').getTime() },
  { patch: '14.2',  startMs: new Date('2024-01-24T12:00:00Z').getTime() },
  { patch: '14.3',  startMs: new Date('2024-02-07T12:00:00Z').getTime() },
  { patch: '14.4',  startMs: new Date('2024-02-21T12:00:00Z').getTime() },
  { patch: '14.5',  startMs: new Date('2024-03-06T12:00:00Z').getTime() },
  { patch: '14.6',  startMs: new Date('2024-03-20T12:00:00Z').getTime() },
  { patch: '14.7',  startMs: new Date('2024-04-03T12:00:00Z').getTime() },
  { patch: '14.8',  startMs: new Date('2024-04-17T12:00:00Z').getTime() },
  { patch: '14.9',  startMs: new Date('2024-05-01T12:00:00Z').getTime() },
  { patch: '14.10', startMs: new Date('2024-05-15T12:00:00Z').getTime() },
  { patch: '14.11', startMs: new Date('2024-06-05T12:00:00Z').getTime() },
  { patch: '14.12', startMs: new Date('2024-06-19T12:00:00Z').getTime() },
  { patch: '14.13', startMs: new Date('2024-07-03T12:00:00Z').getTime() },
  { patch: '14.14', startMs: new Date('2024-07-17T12:00:00Z').getTime() },
  { patch: '14.15', startMs: new Date('2024-07-31T12:00:00Z').getTime() },
  { patch: '14.16', startMs: new Date('2024-08-14T12:00:00Z').getTime() },
  { patch: '14.17', startMs: new Date('2024-08-28T12:00:00Z').getTime() },
  { patch: '14.18', startMs: new Date('2024-09-11T12:00:00Z').getTime() },
  { patch: '14.19', startMs: new Date('2024-09-25T12:00:00Z').getTime() },
  { patch: '14.20', startMs: new Date('2024-10-09T12:00:00Z').getTime() },
  { patch: '14.21', startMs: new Date('2024-10-23T12:00:00Z').getTime() },
  { patch: '14.22', startMs: new Date('2024-11-06T12:00:00Z').getTime() },
  { patch: '14.23', startMs: new Date('2024-11-20T12:00:00Z').getTime() },
  { patch: '14.24', startMs: new Date('2024-12-11T12:00:00Z').getTime() },
  { patch: '15.1',  startMs: new Date('2025-01-08T12:00:00Z').getTime() },
  { patch: '15.2',  startMs: new Date('2025-01-22T12:00:00Z').getTime() },
  { patch: '15.3',  startMs: new Date('2025-02-05T12:00:00Z').getTime() },
  { patch: '15.4',  startMs: new Date('2025-02-19T12:00:00Z').getTime() },
  { patch: '15.5',  startMs: new Date('2025-03-05T12:00:00Z').getTime() },
  { patch: '15.6',  startMs: new Date('2025-03-19T12:00:00Z').getTime() },
  { patch: '15.7',  startMs: new Date('2025-04-02T12:00:00Z').getTime() },
  { patch: '15.8',  startMs: new Date('2025-04-16T12:00:00Z').getTime() },
  { patch: '15.9',  startMs: new Date('2025-04-30T12:00:00Z').getTime() },
  { patch: '15.10', startMs: new Date('2025-05-14T12:00:00Z').getTime() },
  { patch: '15.11', startMs: new Date('2025-05-28T12:00:00Z').getTime() },
  { patch: '15.12', startMs: new Date('2025-06-11T12:00:00Z').getTime() },
  { patch: '15.13', startMs: new Date('2025-06-25T12:00:00Z').getTime() },
  { patch: '15.14', startMs: new Date('2025-07-09T12:00:00Z').getTime() },
  { patch: '15.15', startMs: new Date('2025-07-23T12:00:00Z').getTime() },
  { patch: '15.16', startMs: new Date('2025-08-06T12:00:00Z').getTime() },
  { patch: '15.17', startMs: new Date('2025-08-20T12:00:00Z').getTime() },
  { patch: '15.18', startMs: new Date('2025-09-03T12:00:00Z').getTime() },
  { patch: '15.19', startMs: new Date('2025-09-17T12:00:00Z').getTime() },
  { patch: '15.20', startMs: new Date('2025-10-01T12:00:00Z').getTime() },
  { patch: '15.21', startMs: new Date('2025-10-15T12:00:00Z').getTime() },
  { patch: '15.22', startMs: new Date('2025-10-29T12:00:00Z').getTime() },
  { patch: '15.23', startMs: new Date('2025-11-12T12:00:00Z').getTime() },
  { patch: '15.24', startMs: new Date('2025-11-26T12:00:00Z').getTime() },
  { patch: '26.1',  startMs: new Date('2026-01-07T12:00:00Z').getTime() },
  { patch: '26.2',  startMs: new Date('2026-01-21T12:00:00Z').getTime() },
  { patch: '26.3',  startMs: new Date('2026-02-04T12:00:00Z').getTime() },
  { patch: '26.4',  startMs: new Date('2026-02-18T12:00:00Z').getTime() },
  { patch: '26.5',  startMs: new Date('2026-03-04T12:00:00Z').getTime() },
  { patch: '26.6',  startMs: new Date('2026-03-18T12:00:00Z').getTime() },
  { patch: '26.7',  startMs: new Date('2026-04-01T12:00:00Z').getTime() },
  { patch: '26.8',  startMs: new Date('2026-04-15T12:00:00Z').getTime() },
  { patch: '26.9',  startMs: new Date('2026-04-29T12:00:00Z').getTime() },
  { patch: '26.10', startMs: new Date('2026-05-13T12:00:00Z').getTime() },
  { patch: '26.11', startMs: new Date('2026-05-27T12:00:00Z').getTime() },
  { patch: '26.12', startMs: new Date('2026-06-10T12:00:00Z').getTime() },
  { patch: '26.13', startMs: new Date('2026-06-24T20:00:00Z').getTime() },
  { patch: '26.14', startMs: new Date('2026-07-08T20:00:00Z').getTime() },
]

export function inferPatch(gameCreation: number): string | undefined {
  let result: string | undefined
  for (const entry of PATCH_DATES) {
    if (entry.startMs <= gameCreation) result = entry.patch
    else break
  }
  return result
}

// ─── Sync queue ───────────────────────────────────────────────────────────────

export async function enqueuePlayer(puuid: string): Promise<void> {
  await sql_`
    INSERT INTO sync_queue (puuid, queued_at) VALUES (${puuid}, ${Date.now()})
    ON CONFLICT (puuid) DO NOTHING
  `
}

export async function enqueueAll(puuids: string[]): Promise<void> {
  if (puuids.length === 0) return
  await sql_`
    INSERT INTO sync_queue (puuid, queued_at)
    SELECT p, ${Date.now()} FROM unnest(${puuids}::text[]) p
    ON CONFLICT (puuid) DO NOTHING
  `
}

export async function claimNextJob(clientId: string): Promise<string | null> {
  const now = Date.now()
  const leaseExpires = now + SYNC_LEASE_MS
  const rows = await sql_`
    UPDATE sync_queue SET
      claimed_at       = ${now},
      claimed_by       = ${clientId},
      lease_expires_at = ${leaseExpires}
    WHERE puuid = (
      SELECT puuid FROM sync_queue
      WHERE lease_expires_at IS NULL OR lease_expires_at < ${now}
      ORDER BY priority DESC, queued_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING puuid
  `
  return rows.length > 0 ? (rows[0].puuid as string) : null
}

export async function completeJob(puuid: string): Promise<void> {
  await sql_`DELETE FROM sync_queue WHERE puuid = ${puuid}`
}

export async function enqueuePriority(puuids: string[]): Promise<void> {
  if (puuids.length === 0) return
  const now = Date.now()
  for (const puuid of puuids) {
    await sql_`
      INSERT INTO sync_queue (puuid, queued_at, priority)
      VALUES (${puuid}, ${now}, 1)
      ON CONFLICT (puuid) DO UPDATE
        SET priority = 1, queued_at = ${now},
            claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL
    `
  }
}

export async function failJob(puuid: string): Promise<void> {
  await sql_`
    UPDATE sync_queue SET claimed_at = NULL, claimed_by = NULL, lease_expires_at = NULL
    WHERE puuid = ${puuid}
  `
}

export async function getQueueStatus(): Promise<{ total: number; claimed: number }> {
  const rows = await sql_`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE lease_expires_at IS NOT NULL AND lease_expires_at > ${Date.now()})::int AS claimed
    FROM sync_queue
  `
  return { total: rows[0].total, claimed: rows[0].claimed }
}

export async function clearQueue(): Promise<void> {
  await sql_`DELETE FROM sync_queue`
}

// ─── Write ops ───────────────────────────────────────────────────────────────

export async function setPlayerSyncTime(puuid: string): Promise<void> {
  await sql_`
    INSERT INTO player_sync_times (puuid,"syncedAt") VALUES (${puuid},${Date.now()})
    ON CONFLICT (puuid) DO UPDATE SET "syncedAt" = EXCLUDED."syncedAt"
  `
}

export async function isPlayerStale(puuid: string, thresholdMs: number): Promise<boolean> {
  const rows = await sql_`SELECT "syncedAt" FROM player_sync_times WHERE puuid = ${puuid}`
  if (rows.length === 0) return true
  return Date.now() - Number(rows[0].syncedAt) > thresholdMs
}

export async function invalidateAllSyncTimes(): Promise<void> {
  await sql_`UPDATE player_sync_times SET "syncedAt" = 0`
}

export async function matchExists(gameId: number): Promise<boolean> {
  const rows = await sql_`SELECT 1 FROM matches WHERE "gameId" = ${gameId} LIMIT 1`
  return rows.length > 0
}

export async function insertMatches(matches: Match[]): Promise<number> {
  if (matches.length === 0) return 0

  const insertedCount = await sql_.begin(async (tx) => {
    // Batch insert all matches at once
    const newMatchRows = await tx<{ gameId: number }[]>`
      INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
      VALUES ${tx(matches.map(m => [m.gameId, m.queueId, m.gameCreation, m.gameDuration, m.gameVersion ?? null]) as any)}
      ON CONFLICT ("gameId") DO NOTHING
      RETURNING "gameId"
    `
    const newGameIds = new Set(newMatchRows.map(r => Number(r.gameId)))
    const newMatches = matches.filter(m => newGameIds.has(m.gameId))
    if (newMatches.length === 0) return 0

    // Batch insert all participants for new matches
    // postgres types don't include boolean | null in EscapableArray but handle them fine at runtime
    const partValues = newMatches.flatMap(m =>
      m.participants.map(p => [
        m.gameId, p.puuid, p.summonerName, p.championId, p.championName,
        p.teamId, p.win, p.kills, p.deaths, p.assists,
        p.damageDealt, p.damageTaken, p.goldEarned, p.champLevel,
        m.gameVersion ?? null, m.gameDuration
      ])
    )
    const partRows = await tx<{ id: number; gameId: number; puuid: string }[]>`
      INSERT INTO participants
        ("gameId",puuid,"summonerName","championId","championName","teamId",
         win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel",
         "gameVersion","gameDuration")
      VALUES ${tx(partValues as any)}
      RETURNING id, "gameId", puuid
    `

    // Batch insert all augment pairs using gameId:puuid as stable lookup key
    const partIdMap = new Map(partRows.map(r => [`${r.gameId}:${r.puuid}`, r.id]))
    const augPairs = newMatches.flatMap(m =>
      m.participants.flatMap(p =>
        p.augments.filter(Boolean).map(augId => [partIdMap.get(`${m.gameId}:${p.puuid}`), augId])
      )
    ).filter((pair): pair is [number, number] => pair[0] != null)

    if (augPairs.length > 0) {
      await tx`INSERT INTO participant_augments ("participantId","augmentId") VALUES ${tx(augPairs)}`
    }

    const itemPairs = newMatches.flatMap(m =>
      m.participants.flatMap(p =>
        (p.items ?? []).map(item => [partIdMap.get(`${m.gameId}:${p.puuid}`), item.id, item.slot])
      )
    ).filter((pair): pair is [number, number, number] => pair[0] != null)

    if (itemPairs.length > 0) {
      await tx`INSERT INTO participant_items ("participantId","itemId","slot") VALUES ${tx(itemPairs)}`
      const insertedPartIds = [...new Set(itemPairs.map(p => p[0]))]
      await tx`
        INSERT INTO participant_item_sets ("participantId", "itemIds")
        SELECT "participantId", array_agg("itemId" ORDER BY "itemId")
        FROM participant_items
        WHERE "participantId" = ANY(${insertedPartIds})
        GROUP BY "participantId"
        ON CONFLICT ("participantId") DO UPDATE SET "itemIds" = EXCLUDED."itemIds"
      `
    }

    const newGameIdArr = [...newGameIds]
    if (newGameIdArr.length > 0) {
      await tx`
        WITH new_part AS (
          SELECT p.id, p."gameVersion", p."championId", p.win::int AS win
          FROM participants p
          WHERE p."gameId" = ANY(${newGameIdArr})
            AND p."gameVersion" IS NOT NULL
        ),
        agg AS (
          SELECT np."gameVersion", np."championId", np.win,
            array_agg(pi."itemId" ORDER BY pi."itemId") AS items
          FROM new_part np JOIN participant_items pi ON pi."participantId" = np.id
          GROUP BY np.id, np."gameVersion", np."championId", np.win
          HAVING count(*) >= 5
        ),
        combos AS (
          SELECT agg."gameVersion", agg."championId", agg.win,
            ARRAY[ua.item, ub.item, uc.item, ud.item, ue.item] AS build
          FROM agg,
            LATERAL unnest(agg.items) WITH ORDINALITY AS ua(item, pa),
            LATERAL unnest(agg.items) WITH ORDINALITY AS ub(item, pb),
            LATERAL unnest(agg.items) WITH ORDINALITY AS uc(item, pc),
            LATERAL unnest(agg.items) WITH ORDINALITY AS ud(item, pd),
            LATERAL unnest(agg.items) WITH ORDINALITY AS ue(item, pe)
          WHERE ub.pb > ua.pa AND uc.pc > ub.pb AND ud.pd > uc.pc AND ue.pe > ud.pd
        )
        INSERT INTO item_builds_cache ("gameVersion","championId",build,games,wins)
        SELECT "gameVersion","championId",build,COUNT(*)::int,SUM(win)::int
        FROM combos GROUP BY "gameVersion","championId",build
        ON CONFLICT ("gameVersion","championId",build) DO UPDATE SET
          games = item_builds_cache.games + EXCLUDED.games,
          wins  = item_builds_cache.wins  + EXCLUDED.wins
      `
      // Invalidate precomputed quad stats for these patches so they're rebuilt on next startup
      const affectedVersions = [...new Set(newMatches.map(m => m.gameVersion).filter(Boolean) as string[])]
      if (affectedVersions.length > 0) {
        await tx`DELETE FROM item_quads_cache WHERE "gameVersion" = ANY(${affectedVersions})`
      }
    }

    // Maintain pre-aggregated summary tables
    const champAgg = new Map<string, [string, number, string, number, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        const key = `${m.gameVersion}:${p.championId}`
        const cur = champAgg.get(key) ?? [m.gameVersion, p.championId, p.championName, 0, 0, 0, 0, 0, 0, 0]
        cur[3] += 1; cur[4] += p.win ? 1 : 0; cur[5] += p.kills; cur[6] += p.deaths
        cur[7] += p.assists; cur[8] += p.damageDealt; cur[9] += m.gameDuration
        champAgg.set(key, cur)
      }
    }
    if (champAgg.size > 0) {
      await tx`
        INSERT INTO champion_stats_cache ("gameVersion","championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([...champAgg.values()])}
        ON CONFLICT ("gameVersion","championId") DO UPDATE SET
          "championName"  = EXCLUDED."championName",
          games          = champion_stats_cache.games + EXCLUDED.games,
          wins           = champion_stats_cache.wins + EXCLUDED.wins,
          total_kills    = champion_stats_cache.total_kills + EXCLUDED.total_kills,
          total_deaths   = champion_stats_cache.total_deaths + EXCLUDED.total_deaths,
          total_assists  = champion_stats_cache.total_assists + EXCLUDED.total_assists,
          total_damage   = champion_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration = champion_stats_cache.total_duration + EXCLUDED.total_duration
      `
    }

    const augAgg = new Map<string, [string, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        for (const augId of p.augments) {
          if (!augId) continue
          const key = `${m.gameVersion}:${augId}`
          const cur = augAgg.get(key) ?? [m.gameVersion, augId, 0, 0, 0, 0]
          cur[2] += 1; cur[3] += p.win ? 1 : 0; cur[4] += p.damageDealt; cur[5] += m.gameDuration
          augAgg.set(key, cur)
        }
      }
    }
    if (augAgg.size > 0) {
      await tx`
        INSERT INTO augment_stats_cache ("gameVersion","augmentId",pick_count,wins,total_damage,total_duration)
        VALUES ${tx([...augAgg.values()])}
        ON CONFLICT ("gameVersion","augmentId") DO UPDATE SET
          pick_count     = augment_stats_cache.pick_count + EXCLUDED.pick_count,
          wins           = augment_stats_cache.wins + EXCLUDED.wins,
          total_damage   = augment_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration = augment_stats_cache.total_duration + EXCLUDED.total_duration
      `
    }

    const playerAgg = new Map<string, [string, string, string, number, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        if (!p.puuid) continue
        const key = `${m.gameVersion}:${p.puuid}`
        const cur = playerAgg.get(key) ?? [m.gameVersion, p.puuid, p.summonerName, 0, 0, 0, 0, 0, 0, 0]
        cur[3] += 1; cur[4] += p.win ? 1 : 0; cur[5] += p.kills; cur[6] += p.deaths
        cur[7] += p.assists; cur[8] += p.damageDealt; cur[9] += m.gameDuration
        playerAgg.set(key, cur)
      }
    }
    if (playerAgg.size > 0) {
      await tx`
        INSERT INTO player_stats_cache ("gameVersion",puuid,"summonerName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([...playerAgg.values()])}
        ON CONFLICT ("gameVersion",puuid) DO UPDATE SET
          "summonerName"  = EXCLUDED."summonerName",
          games           = player_stats_cache.games + EXCLUDED.games,
          wins            = player_stats_cache.wins + EXCLUDED.wins,
          total_kills     = player_stats_cache.total_kills + EXCLUDED.total_kills,
          total_deaths    = player_stats_cache.total_deaths + EXCLUDED.total_deaths,
          total_assists   = player_stats_cache.total_assists + EXCLUDED.total_assists,
          total_damage    = player_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration  = player_stats_cache.total_duration + EXCLUDED.total_duration
      `
    }

    const playerChampAgg = new Map<string, [string, string, number, string, number, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        if (!p.puuid) continue
        const key = `${m.gameVersion}:${p.puuid}:${p.championId}`
        const cur = playerChampAgg.get(key) ?? [m.gameVersion, p.puuid, p.championId, p.championName, 0, 0, 0, 0, 0, 0, 0]
        cur[4] += 1; cur[5] += p.win ? 1 : 0; cur[6] += p.kills; cur[7] += p.deaths
        cur[8] += p.assists; cur[9] += p.damageDealt; cur[10] += m.gameDuration
        playerChampAgg.set(key, cur)
      }
    }
    if (playerChampAgg.size > 0) {
      await tx`
        INSERT INTO player_champion_stats_cache
          ("gameVersion",puuid,"championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([...playerChampAgg.values()])}
        ON CONFLICT ("gameVersion",puuid,"championId") DO UPDATE SET
          "championName"  = EXCLUDED."championName",
          games           = player_champion_stats_cache.games + EXCLUDED.games,
          wins            = player_champion_stats_cache.wins + EXCLUDED.wins,
          total_kills     = player_champion_stats_cache.total_kills + EXCLUDED.total_kills,
          total_deaths    = player_champion_stats_cache.total_deaths + EXCLUDED.total_deaths,
          total_assists   = player_champion_stats_cache.total_assists + EXCLUDED.total_assists,
          total_damage    = player_champion_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration  = player_champion_stats_cache.total_duration + EXCLUDED.total_duration
      `
    }

    const augChampAgg = new Map<string, [string, number, number, string, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        for (const augId of p.augments) {
          if (!augId) continue
          const key = `${m.gameVersion}:${augId}:${p.championId}`
          const cur = augChampAgg.get(key) ?? [m.gameVersion, augId, p.championId, p.championName, 0, 0, 0, 0]
          cur[4] += 1; cur[5] += p.win ? 1 : 0; cur[6] += p.damageDealt; cur[7] += m.gameDuration
          augChampAgg.set(key, cur)
        }
      }
    }
    if (augChampAgg.size > 0) {
      await tx`
        INSERT INTO augment_champion_stats_cache
          ("gameVersion","augmentId","championId","championName",pick_count,wins,total_damage,total_duration)
        VALUES ${tx([...augChampAgg.values()])}
        ON CONFLICT ("gameVersion","augmentId","championId") DO UPDATE SET
          "championName"  = EXCLUDED."championName",
          pick_count      = augment_champion_stats_cache.pick_count + EXCLUDED.pick_count,
          wins            = augment_champion_stats_cache.wins + EXCLUDED.wins,
          total_damage    = augment_champion_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration  = augment_champion_stats_cache.total_duration + EXCLUDED.total_duration
      `
    }

    return newMatches.length
  })

  const puuids = [...new Set(matches.flatMap(m => m.participants.map(p => p.puuid).filter(Boolean)))]
  await enqueueAll(puuids)
  return insertedCount
}

export async function upsertMatch(match: Match): Promise<void> {
  await sql_.begin(async (tx) => {
    await tx`
      INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
      VALUES (${match.gameId},${match.queueId},${match.gameCreation},${match.gameDuration},${match.gameVersion ?? null})
      ON CONFLICT ("gameId") DO UPDATE SET
        "queueId"      = EXCLUDED."queueId",
        "gameCreation" = EXCLUDED."gameCreation",
        "gameDuration" = EXCLUDED."gameDuration",
        "gameVersion"  = EXCLUDED."gameVersion"
    `
    const oldParts = await tx`SELECT id FROM participants WHERE "gameId" = ${match.gameId}`
    if (oldParts.length > 0) {
      const ids = oldParts.map((r: any) => r.id)
      await tx`DELETE FROM participant_augments WHERE "participantId" = ANY(${ids})`
      await tx`DELETE FROM participant_items WHERE "participantId" = ANY(${ids})`
      await tx`DELETE FROM participants WHERE "gameId" = ${match.gameId}`
    }
    for (const p of match.participants) {
      const [row] = await tx`
        INSERT INTO participants
          ("gameId",puuid,"summonerName","championId","championName","teamId",
           win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel",
           "gameVersion","gameDuration")
        VALUES
          (${match.gameId},${p.puuid},${p.summonerName},${p.championId},${p.championName},
           ${p.teamId},${p.win},${p.kills},${p.deaths},${p.assists},
           ${p.damageDealt},${p.damageTaken},${p.goldEarned},${p.champLevel},
           ${match.gameVersion ?? null},${match.gameDuration})
        RETURNING id
      `
      for (const augId of p.augments) {
        if (!augId) continue
        await tx`INSERT INTO participant_augments ("participantId","augmentId") VALUES (${row.id},${augId})`
      }
      for (const item of (p.items ?? [])) {
        if (!item) continue
        await tx`INSERT INTO participant_items ("participantId","itemId","slot") VALUES (${row.id},${item.id},${item.slot})`
      }
      const sortedIds = [...(p.items ?? [])].map(i => i.id).sort((a, b) => a - b)
      await tx`
        INSERT INTO participant_item_sets ("participantId", "itemIds")
        VALUES (${row.id}, ${sortedIds})
        ON CONFLICT ("participantId") DO UPDATE SET "itemIds" = EXCLUDED."itemIds"
      `
    }
  })

  // Recompute summary caches for this gameVersion after the transaction
  if (match.gameVersion) {
    const gv = match.gameVersion
    await sql_`
      INSERT INTO champion_stats_cache ("gameVersion","championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion", p."championId", MIN(p."championName"),
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration")
      FROM participants p
      WHERE p."gameVersion" = ${gv}
      GROUP BY p."gameVersion", p."championId"
      ON CONFLICT ("gameVersion","championId") DO UPDATE SET
        "championName"  = EXCLUDED."championName",
        games          = EXCLUDED.games,
        wins           = EXCLUDED.wins,
        total_kills    = EXCLUDED.total_kills,
        total_deaths   = EXCLUDED.total_deaths,
        total_assists  = EXCLUDED.total_assists,
        total_damage   = EXCLUDED.total_damage,
        total_duration = EXCLUDED.total_duration
    `
    await sql_`
      INSERT INTO augment_stats_cache ("gameVersion","augmentId",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion", pa."augmentId",
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration")
      FROM participants p
      JOIN participant_augments pa ON pa."participantId" = p.id
      WHERE p."gameVersion" = ${gv}
      GROUP BY p."gameVersion", pa."augmentId"
      ON CONFLICT ("gameVersion","augmentId") DO UPDATE SET
        pick_count     = EXCLUDED.pick_count,
        wins           = EXCLUDED.wins,
        total_damage   = EXCLUDED.total_damage,
        total_duration = EXCLUDED.total_duration
    `
    await sql_`
      INSERT INTO player_stats_cache ("gameVersion",puuid,"summonerName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion", p.puuid, MAX(p."summonerName"),
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
        SUM(p."damageDealt")::bigint, SUM(p."gameDuration")::bigint
      FROM participants p
      WHERE p."gameVersion" = ${gv} AND p.puuid != ''
      GROUP BY p."gameVersion", p.puuid
      ON CONFLICT ("gameVersion",puuid) DO UPDATE SET
        "summonerName"  = EXCLUDED."summonerName",
        games           = EXCLUDED.games,
        wins            = EXCLUDED.wins,
        total_kills     = EXCLUDED.total_kills,
        total_deaths    = EXCLUDED.total_deaths,
        total_assists   = EXCLUDED.total_assists,
        total_damage    = EXCLUDED.total_damage,
        total_duration  = EXCLUDED.total_duration
    `
    await sql_`
      INSERT INTO player_champion_stats_cache
        ("gameVersion",puuid,"championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion",p.puuid,p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p.kills)::int,SUM(p.deaths)::int,SUM(p.assists)::int,
        SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
      FROM participants p
      WHERE p."gameVersion" = ${gv} AND p.puuid != ''
      GROUP BY p."gameVersion",p.puuid,p."championId"
      ON CONFLICT ("gameVersion",puuid,"championId") DO UPDATE SET
        "championName"  = EXCLUDED."championName",
        games           = EXCLUDED.games,
        wins            = EXCLUDED.wins,
        total_kills     = EXCLUDED.total_kills,
        total_deaths    = EXCLUDED.total_deaths,
        total_assists   = EXCLUDED.total_assists,
        total_damage    = EXCLUDED.total_damage,
        total_duration  = EXCLUDED.total_duration
    `
    await sql_`
      INSERT INTO augment_champion_stats_cache
        ("gameVersion","augmentId","championId","championName",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion",pa."augmentId",p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN participant_augments pa ON pa."participantId"=p.id
      WHERE p."gameVersion" = ${gv}
      GROUP BY p."gameVersion",pa."augmentId",p."championId"
      ON CONFLICT ("gameVersion","augmentId","championId") DO UPDATE SET
        "championName"  = EXCLUDED."championName",
        pick_count      = EXCLUDED.pick_count,
        wins            = EXCLUDED.wins,
        total_damage    = EXCLUDED.total_damage,
        total_duration  = EXCLUDED.total_duration
    `
    const affectedChampionIds = [...new Set(match.participants.map(p => p.championId))]
    await sql_`DELETE FROM item_archetypes_cache WHERE "championId" = ANY(${affectedChampionIds}::int[])`
  }
}

export async function getIncompleteGameIds(): Promise<number[]> {
  const rows = await sql_`
    SELECT p."gameId"
    FROM participants p
    GROUP BY p."gameId"
    HAVING COUNT(*) < 10
  `
  return rows.map((r: any) => Number(r.gameId))
}

// ─── Read ops ─────────────────────────────────────────────────────────────────

export async function getPlayerName(puuid: string): Promise<string | null> {
  const rows = await sql_`
    SELECT "summonerName" FROM participants
    WHERE puuid = ${puuid}
    ORDER BY id DESC LIMIT 1
  `
  return rows.length > 0 ? rows[0].summonerName : null
}

export interface CoplayerStat {
  puuid: string
  summonerName: string
  games: number
  wins: number
}

export async function getCoplayerStats(puuid: string, patches?: string[]): Promise<CoplayerStat[]> {
  const conditions: string[] = [`p1.puuid = $1`, `p2.puuid != $1`, `p2.puuid != ''`]
  const params: any[] = [puuid]
  if (patches?.length) { params.push(patches); conditions.push(`p1."gameVersion" = ANY($${params.length})`) }
  const where = `WHERE ${conditions.join(' AND ')}`

  const rows = await sql_.unsafe(`
    SELECT p2.puuid,
      MIN(p2."summonerName") AS "summonerName",
      COUNT(*)::int AS games,
      SUM(p2.win::int)::int AS wins
    FROM participants p1
    JOIN participants p2 ON p1."gameId" = p2."gameId" AND p1."teamId" = p2."teamId"
    ${where}
    GROUP BY p2.puuid
    HAVING COUNT(*) >= 2
    ORDER BY games DESC
    LIMIT 10
  `, params)

  return rows.map((r: any) => ({
    puuid: r.puuid,
    summonerName: r.summonerName ?? r.puuid.slice(0, 8) + '…',
    games: r.games,
    wins: r.wins,
  }))
}

export async function getPatches(): Promise<string[]> {
  const rows = await sql_`
    SELECT DISTINCT "gameVersion" FROM matches
    WHERE "gameVersion" IS NOT NULL
    ORDER BY "gameVersion" DESC
  `
  return rows
    .map((r: any) => r.gameVersion as string)
    .sort((a, b) => {
      const [aMaj, aMin] = a.split('.').map(Number)
      const [bMaj, bMin] = b.split('.').map(Number)
      return bMaj !== aMaj ? bMaj - aMaj : bMin - aMin
    })
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface PlayerStats {
  puuid: string
  summonerName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDpm: number
  avgGold: number
  syncedFull: boolean
  syncedAt: number
}

export async function getPlayerStats(patches?: string[]): Promise<PlayerStats[]> {
  const rows = patches?.length
    ? await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0 THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0 END AS "avgDpm",
          MAX(s."syncedAt") AS "syncedAt"
        FROM player_stats_cache pc
        JOIN player_sync_times s ON s.puuid = pc.puuid
        WHERE pc."gameVersion" = ANY(${patches}) AND pc.puuid != ''
        GROUP BY pc.puuid ORDER BY games DESC
      `
    : await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0 THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0 END AS "avgDpm",
          MAX(s."syncedAt") AS "syncedAt"
        FROM player_stats_cache pc
        JOIN player_sync_times s ON s.puuid = pc.puuid
        WHERE pc.puuid != ''
        GROUP BY pc.puuid ORDER BY games DESC
      `
  return rows.map((r: any) => ({
    puuid: r.puuid,
    summonerName: r.summonerName,
    games: r.games,
    wins: r.wins,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    avgDpm: parseFloat(r.avgDpm),
    avgGold: 0,
    syncedFull: true,
    syncedAt: Number(r.syncedAt ?? 0),
  }))
}

export async function getOnePlayerStats(puuid: string, patches?: string[]): Promise<PlayerStats | null> {
  const rows = patches?.length
    ? await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0
            THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
          END AS "avgDpm",
          COALESCE(MAX(pst."syncedAt"), 0) AS "syncedAt"
        FROM player_stats_cache pc
        LEFT JOIN player_sync_times pst ON pst.puuid = pc.puuid
        WHERE pc.puuid = ${puuid} AND pc."gameVersion" = ANY(${patches})
        GROUP BY pc.puuid
      `
    : await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0
            THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
          END AS "avgDpm",
          COALESCE(MAX(pst."syncedAt"), 0) AS "syncedAt"
        FROM player_stats_cache pc
        LEFT JOIN player_sync_times pst ON pst.puuid = pc.puuid
        WHERE pc.puuid = ${puuid}
        GROUP BY pc.puuid
      `
  if (!rows.length || !rows[0].games) return null
  const r = rows[0]
  return {
    puuid,
    summonerName: r.summonerName ?? '',
    games: r.games,
    wins: r.wins,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    avgDpm: parseFloat(r.avgDpm),
    avgGold: 0,
    syncedFull: true,
    syncedAt: Number(r.syncedAt ?? 0),
  }
}

export async function getBulkPlayerStats(
  puuids: string[],
  patches?: string[]
): Promise<Record<string, PlayerStats>> {
  if (!puuids.length) return {}
  const rows = patches?.length
    ? await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0
            THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
          END AS "avgDpm"
        FROM player_stats_cache pc
        WHERE pc.puuid = ANY(${puuids}) AND pc."gameVersion" = ANY(${patches})
        GROUP BY pc.puuid`
    : await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0
            THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
          END AS "avgDpm"
        FROM player_stats_cache pc
        WHERE pc.puuid = ANY(${puuids})
        GROUP BY pc.puuid`
  const result: Record<string, PlayerStats> = {}
  for (const r of rows) {
    if (!r.games) continue
    result[r.puuid] = {
      puuid: r.puuid,
      summonerName: r.summonerName ?? '',
      games: r.games,
      wins: r.wins,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      avgDpm: parseFloat(r.avgDpm),
      avgGold: 0,
      syncedFull: true,
      syncedAt: 0,
    }
  }
  return result
}

export async function searchPlayers(query: string): Promise<{ puuid: string; summonerName: string }[]> {
  return sql_<{ puuid: string; summonerName: string }[]>`
    SELECT DISTINCT ON (puuid) puuid, "summonerName"
    FROM participants
    WHERE "summonerName" ILIKE ${'%' + query + '%'}
    ORDER BY puuid, id DESC
    LIMIT 10
  `
}

export interface ChampionStats {
  championId: number
  championName: string
  puuid: string
  summonerName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDpm: number
}

export async function getChampionStats(puuid?: string, patches?: string[]): Promise<ChampionStats[]> {
  let rows: any[]

  if (puuid && patches?.length) {
    rows = await sql_`
      SELECT pc."championId", pc."championName",
        SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
        SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
        CASE WHEN SUM(pc.total_duration) > 0
          THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
        END AS "avgDpm",
        ${puuid}::text AS puuid, ''::text AS "summonerName"
      FROM player_champion_stats_cache pc
      WHERE pc.puuid = ${puuid} AND pc."gameVersion" = ANY(${patches})
      GROUP BY pc."championId", pc."championName"
      ORDER BY games DESC
    `
  } else if (puuid) {
    rows = await sql_`
      SELECT pc."championId", pc."championName",
        SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
        SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
        CASE WHEN SUM(pc.total_duration) > 0
          THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
        END AS "avgDpm",
        ${puuid}::text AS puuid, ''::text AS "summonerName"
      FROM player_champion_stats_cache pc
      WHERE pc.puuid = ${puuid}
      GROUP BY pc."championId", pc."championName"
      ORDER BY games DESC
    `
  } else if (patches?.length) {
    // Fast path: read from pre-aggregated summary table
    rows = await sql_.unsafe(
      `SELECT "championId", "championName",
        SUM(games)::int AS games, SUM(wins)::int AS wins,
        SUM(total_kills)::int AS kills, SUM(total_deaths)::int AS deaths, SUM(total_assists)::int AS assists,
        CASE WHEN SUM(total_duration) > 0 THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0) ELSE 0 END AS "avgDpm",
        ''::text AS puuid, ''::text AS "summonerName"
       FROM champion_stats_cache WHERE "gameVersion" = ANY($1)
       GROUP BY "championId", "championName" ORDER BY games DESC`,
      [patches]
    )
  } else {
    // Fast path: aggregate across all patches using summary table
    rows = await sql_`
      SELECT "championId", MIN("championName") AS "championName",
        SUM(games)::int AS games, SUM(wins)::int AS wins,
        SUM(total_kills)::int AS kills, SUM(total_deaths)::int AS deaths, SUM(total_assists)::int AS assists,
        CASE WHEN SUM(total_duration) > 0 THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0) ELSE 0 END AS "avgDpm",
        ''::text AS puuid, ''::text AS "summonerName"
      FROM champion_stats_cache
      GROUP BY "championId" ORDER BY games DESC
    `
  }

  return rows.map((r: any) => ({
    championId: r.championId,
    championName: r.championName,
    puuid: r.puuid,
    summonerName: r.summonerName,
    games: r.games,
    wins: r.wins,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    avgDpm: parseFloat(r.avgDpm)
  }))
}

export interface AugmentStats {
  augmentId: number
  name: string
  rarity: number
  iconPath: string
  pickCount: number
  wins: number
  avgDpm: number
}

export async function getAugmentStats(puuid?: string, championId?: number, patches?: string[], augmentCache: Record<number, { name: string; rarity: number; iconPath: string }> = {}): Promise<AugmentStats[]> {
  let rows: any[]

  if (!puuid && !championId) {
    // Fast path: read from pre-aggregated summary table
    if (patches?.length) {
      rows = await sql_.unsafe(
        `SELECT "augmentId",
          SUM(pick_count)::int AS "pickCount", SUM(wins)::int AS wins,
          CASE WHEN SUM(total_duration) > 0 THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0) ELSE 0 END AS "avgDpm"
         FROM augment_stats_cache WHERE "gameVersion" = ANY($1)
         GROUP BY "augmentId" ORDER BY "pickCount" DESC`,
        [patches]
      )
    } else {
      rows = await sql_`
        SELECT "augmentId",
          SUM(pick_count)::int AS "pickCount", SUM(wins)::int AS wins,
          CASE WHEN SUM(total_duration) > 0 THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0) ELSE 0 END AS "avgDpm"
        FROM augment_stats_cache
        GROUP BY "augmentId" ORDER BY "pickCount" DESC
      `
    }
  } else if (championId && !puuid) {
    rows = patches?.length
      ? await sql_`
          SELECT acc."augmentId",
            SUM(acc.pick_count)::int AS "pickCount", SUM(acc.wins)::int AS wins,
            CASE WHEN SUM(acc.total_duration) > 0
              THEN SUM(acc.total_damage)::float / (SUM(acc.total_duration) / 60.0) ELSE 0
            END AS "avgDpm"
          FROM augment_champion_stats_cache acc
          WHERE acc."championId" = ${championId} AND acc."gameVersion" = ANY(${patches})
          GROUP BY acc."augmentId"
          ORDER BY "pickCount" DESC
        `
      : await sql_`
          SELECT acc."augmentId",
            SUM(acc.pick_count)::int AS "pickCount", SUM(acc.wins)::int AS wins,
            CASE WHEN SUM(acc.total_duration) > 0
              THEN SUM(acc.total_damage)::float / (SUM(acc.total_duration) / 60.0) ELSE 0
            END AS "avgDpm"
          FROM augment_champion_stats_cache acc
          WHERE acc."championId" = ${championId}
          GROUP BY acc."augmentId"
          ORDER BY "pickCount" DESC
        `
  } else {
    // Both puuid and championId — raw join fallback (4-dimensional, no dedicated table)
    const conditions: string[] = []
    const params: any[] = []
    if (puuid)           { params.push(puuid);      conditions.push(`p.puuid = $${params.length}`) }
    if (championId)      { params.push(championId); conditions.push(`p."championId" = $${params.length}`) }
    if (patches?.length) { params.push(patches);    conditions.push(`p."gameVersion" = ANY($${params.length})`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    rows = await sql_.unsafe(`
      SELECT pa."augmentId",
        COUNT(*)::int AS "pickCount",
        SUM(p.win::int)::int AS wins,
        CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm"
      FROM participants p
      JOIN participant_augments pa ON pa."participantId" = p.id
      ${where}
      GROUP BY pa."augmentId"
      ORDER BY "pickCount" DESC
    `, params)
  }

  return rows.map((r: any) => {
    const meta = augmentCache[r.augmentId]
    return {
      augmentId: r.augmentId,
      name: meta?.name ?? `Augment ${r.augmentId}`,
      rarity: meta?.rarity ?? 0,
      iconPath: meta?.iconPath ?? '',
      pickCount: r.pickCount,
      wins: r.wins,
      avgDpm: parseFloat(r.avgDpm)
    }
  })
}

export interface AugmentChampionStat {
  championId: number
  championName: string
  games: number
  wins: number
  avgDpm: number
}

export async function getAugmentChampionStats(augmentId: number, puuid?: string, patches?: string[]): Promise<AugmentChampionStat[]> {
  let rows: any[]

  if (!puuid) {
    rows = patches?.length
      ? await sql_`
          SELECT acc."championId", acc."championName",
            SUM(acc.pick_count)::int AS games, SUM(acc.wins)::int AS wins,
            CASE WHEN SUM(acc.total_duration) > 0
              THEN SUM(acc.total_damage)::float / (SUM(acc.total_duration) / 60.0) ELSE 0
            END AS "avgDpm"
          FROM augment_champion_stats_cache acc
          WHERE acc."augmentId" = ${augmentId} AND acc."gameVersion" = ANY(${patches})
          GROUP BY acc."championId", acc."championName"
          ORDER BY games DESC
        `
      : await sql_`
          SELECT acc."championId", acc."championName",
            SUM(acc.pick_count)::int AS games, SUM(acc.wins)::int AS wins,
            CASE WHEN SUM(acc.total_duration) > 0
              THEN SUM(acc.total_damage)::float / (SUM(acc.total_duration) / 60.0) ELSE 0
            END AS "avgDpm"
          FROM augment_champion_stats_cache acc
          WHERE acc."augmentId" = ${augmentId}
          GROUP BY acc."championId", acc."championName"
          ORDER BY games DESC
        `
  } else {
    // puuid filter — raw join
    const conditions: string[] = [`pa."augmentId" = $1`]
    const params: any[] = [augmentId]
    params.push(puuid); conditions.push(`p.puuid = $${params.length}`)
    if (patches?.length) { params.push(patches); conditions.push(`p."gameVersion" = ANY($${params.length})`) }
    const where = `WHERE ${conditions.join(' AND ')}`
    rows = await sql_.unsafe(`
      SELECT p."championId", MIN(p."championName") AS "championName",
        COUNT(*)::int AS games,
        SUM(p.win::int)::int AS wins,
        CASE WHEN SUM(p."gameDuration") > 0
          THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0)
          ELSE 0 END AS "avgDpm"
      FROM participant_augments pa
      JOIN participants p ON pa."participantId" = p.id
      ${where}
      GROUP BY p."championId"
      ORDER BY games DESC
    `, params)
  }

  return rows.map((r: any) => ({
    championId: r.championId,
    championName: r.championName ?? `Champion ${r.championId}`,
    games: r.games,
    wins: r.wins,
    avgDpm: parseFloat(r.avgDpm),
  }))
}

export interface ItemBuild {
  build: number[]
  games: number
  wins: number
}

export interface ItemPickRate {
  itemId: number
  picks: number
  wins: number
}

export async function getItemBuilds(championId: number, patches?: string[], allowedIds: number[] = []): Promise<ItemBuild[]> {
  const allowed = allowedIds.length > 0 ? allowedIds : [-1]
  const rows = patches?.length
    ? await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId}
          AND "gameVersion" = ANY(${patches})
          AND build <@ ${allowed}::int[]
        GROUP BY build ORDER BY games DESC LIMIT 50
      `
    : await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId}
          AND "gameVersion" IS NOT NULL
          AND build <@ ${allowed}::int[]
        GROUP BY build ORDER BY games DESC LIMIT 50
      `
  return rows.map((r: any) => ({ build: r.build as number[], games: r.games, wins: r.wins }))
}

export interface BootsByOpenerRow {
  openerId: number
  bootId: number
  picks: number
}

export async function getBootsByOpener(
  championId: number,
  openerIds: number[],
  bootIds: number[],
  patches?: string[]
): Promise<BootsByOpenerRow[]> {
  if (openerIds.length === 0 || bootIds.length === 0) return []
  const rows = patches?.length
    ? await sql_`
        SELECT pi_o."itemId" AS "openerId", pi_b."itemId" AS "bootId", COUNT(*)::int AS picks
        FROM participants p
        JOIN participant_items pi_o ON pi_o."participantId" = p.id
        JOIN participant_items pi_b ON pi_b."participantId" = p.id
        WHERE p."championId" = ${championId}
          AND p."gameVersion" = ANY(${patches})
          AND pi_o."itemId" = ANY(${openerIds})
          AND pi_b."itemId" = ANY(${bootIds})
        GROUP BY pi_o."itemId", pi_b."itemId"
        ORDER BY picks DESC
      `
    : await sql_`
        SELECT pi_o."itemId" AS "openerId", pi_b."itemId" AS "bootId", COUNT(*)::int AS picks
        FROM participants p
        JOIN participant_items pi_o ON pi_o."participantId" = p.id
        JOIN participant_items pi_b ON pi_b."participantId" = p.id
        WHERE p."championId" = ${championId}
          AND pi_o."itemId" = ANY(${openerIds})
          AND pi_b."itemId" = ANY(${bootIds})
        GROUP BY pi_o."itemId", pi_b."itemId"
        ORDER BY picks DESC
      `
  return rows.map((r: any) => ({ openerId: r.openerId, bootId: r.bootId, picks: r.picks }))
}



export interface ItemPickRatesResult {
  totalGames: number
  items: ItemPickRate[]
}

export async function getItemPickRates(championId: number, patches?: string[]): Promise<ItemPickRatesResult> {
  const [itemRows, countRows, bootsRows] = await Promise.all([
    patches?.length
      ? sql_`
          SELECT pi."itemId" AS "itemId", m.name, m."iconPath", m.category,
                 COUNT(*)::int AS picks,
                 SUM(CASE WHEN p.win THEN 1 ELSE 0 END)::int AS wins
          FROM participants p
          JOIN participant_items pi ON pi."participantId" = p.id
          JOIN meta_items m ON m.id = pi."itemId"
            AND m.is_component = false
            AND m.category != 'Boots'
            AND m.name IS NOT NULL
            AND m.name != ''
          WHERE p."championId" = ${championId}
            AND p."gameVersion" = ANY(${patches})
          GROUP BY pi."itemId", m.name, m."iconPath", m.category
          ORDER BY picks DESC
        `
      : sql_`
          SELECT pi."itemId" AS "itemId", m.name, m."iconPath", m.category,
                 COUNT(*)::int AS picks,
                 SUM(CASE WHEN p.win THEN 1 ELSE 0 END)::int AS wins
          FROM participants p
          JOIN participant_items pi ON pi."participantId" = p.id
          JOIN meta_items m ON m.id = pi."itemId"
            AND m.is_component = false
            AND m.category != 'Boots'
            AND m.name IS NOT NULL
            AND m.name != ''
          WHERE p."championId" = ${championId}
          GROUP BY pi."itemId", m.name, m."iconPath", m.category
          ORDER BY picks DESC
        `,
    patches?.length
      ? sql_`
          SELECT COALESCE(SUM(games), 0)::int AS total
          FROM champion_stats_cache
          WHERE "championId" = ${championId}
            AND "gameVersion" = ANY(${patches})
        `
      : sql_`
          SELECT COALESCE(SUM(games), 0)::int AS total
          FROM champion_stats_cache
          WHERE "championId" = ${championId}
        `,
    patches?.length
      ? sql_`
          SELECT pi."itemId" AS "itemId", m.name, m."iconPath", m.category,
                 COUNT(*)::int AS picks,
                 SUM(CASE WHEN p.win THEN 1 ELSE 0 END)::int AS wins
          FROM participants p
          JOIN participant_items pi ON pi."participantId" = p.id
          JOIN meta_items m ON m.id = pi."itemId"
            AND m.category = 'Boots'
            AND m.name IS NOT NULL
            AND m.name != ''
          WHERE p."championId" = ${championId}
            AND p."gameVersion" = ANY(${patches})
          GROUP BY pi."itemId", m.name, m."iconPath", m.category
          ORDER BY picks DESC
        `
      : sql_`
          SELECT pi."itemId" AS "itemId", m.name, m."iconPath", m.category,
                 COUNT(*)::int AS picks,
                 SUM(CASE WHEN p.win THEN 1 ELSE 0 END)::int AS wins
          FROM participants p
          JOIN participant_items pi ON pi."participantId" = p.id
          JOIN meta_items m ON m.id = pi."itemId"
            AND m.category = 'Boots'
            AND m.name IS NOT NULL
            AND m.name != ''
          WHERE p."championId" = ${championId}
          GROUP BY pi."itemId", m.name, m."iconPath", m.category
          ORDER BY picks DESC
        `,
  ])
  const toRow = (r: any) => ({
    itemId: r.itemId,
    picks: r.picks,
    wins: r.wins,
    name: r.name ?? null,
    iconPath: r.iconPath ?? null,
    category: r.category ?? null,
  })
  return {
    totalGames: (countRows[0] as any)?.total ?? 0,
    items: [...(bootsRows as any[]).map(toRow), ...(itemRows as any[]).map(toRow)],
  }
}

export interface MatchView {
  gameId: number
  gameCreation: number
  gameDuration: number
  participants: (Participant & { teamId: number })[]
}

export async function getRecentMatches(limit = 20, puuid?: string, patches?: string[]): Promise<MatchView[]> {
  let matchRows: any[]
  if (puuid && patches?.length) {
    matchRows = await sql_`
      SELECT DISTINCT m."gameId", m."gameCreation", m."gameDuration"
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p.puuid = ${puuid} AND p."gameVersion" = ANY(${patches})
      ORDER BY m."gameCreation" DESC LIMIT ${limit}
    `
  } else if (puuid) {
    matchRows = await sql_`
      SELECT DISTINCT m."gameId", m."gameCreation", m."gameDuration"
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p.puuid = ${puuid}
      ORDER BY m."gameCreation" DESC LIMIT ${limit}
    `
  } else {
    const params: any[] = []
    const conditions: string[] = []
    if (patches?.length) { params.push(patches); conditions.push(`m."gameVersion" = ANY($${params.length})`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    matchRows = await sql_.unsafe(`
      SELECT "gameId","gameCreation","gameDuration" FROM matches m
      ${where} ORDER BY "gameCreation" DESC LIMIT $${params.push(limit)}
    `, params)
  }
  if (matchRows.length === 0) return []

  const gameIds = matchRows.map((r: any) => Number(r.gameId))
  const partRows = await sql_`
    SELECT p.*, ARRAY_AGG(pa."augmentId") FILTER (WHERE pa."augmentId" IS NOT NULL) AS augments
    FROM participants p
    LEFT JOIN participant_augments pa ON pa."participantId" = p.id
    WHERE p."gameId" = ANY(${gameIds})
    GROUP BY p.id
  `

  const partsByGame = new Map<number, any[]>()
  for (const p of partRows) {
    if (!partsByGame.has(p.gameId)) partsByGame.set(p.gameId, [])
    partsByGame.get(p.gameId)!.push(p)
  }

  return matchRows.map((m: any) => ({
    gameId: Number(m.gameId),
    gameCreation: Number(m.gameCreation),
    gameDuration: m.gameDuration,
    participants: (partsByGame.get(m.gameId) ?? []).map((p: any) => ({
      puuid: p.puuid,
      summonerName: p.summonerName,
      championId: p.championId,
      championName: p.championName,
      teamId: p.teamId,
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      damageDealt: p.damageDealt,
      damageTaken: p.damageTaken,
      goldEarned: p.goldEarned,
      champLevel: p.champLevel,
      augments: p.augments ?? []
    }))
  }))
}

export interface WinRateTrend {
  date: string
  winRate: number
  games: number
}

export async function getWinRateTrend(puuid?: string, days = 30): Promise<WinRateTrend[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const rows = puuid
    ? await sql_`
        SELECT
          TO_CHAR(TO_TIMESTAMP(m."gameCreation" / 1000), 'YYYY-MM-DD') AS date,
          COUNT(*)::int       AS games,
          SUM(p.win::int)::int AS wins
        FROM participants p
        JOIN matches m ON p."gameId" = m."gameId"
        WHERE m."gameCreation" >= ${cutoff} AND p.puuid = ${puuid}
        GROUP BY date
        ORDER BY date
      `
    : await sql_`
        SELECT
          TO_CHAR(TO_TIMESTAMP(m."gameCreation" / 1000), 'YYYY-MM-DD') AS date,
          COUNT(*)::int       AS games,
          SUM(p.win::int)::int AS wins
        FROM participants p
        JOIN matches m ON p."gameId" = m."gameId"
        WHERE m."gameCreation" >= ${cutoff}
        GROUP BY date
        ORDER BY date
      `
  return rows.map((r: any) => ({
    date: r.date,
    winRate: (r.wins / r.games) * 100,
    games: r.games
  }))
}

export interface GroupSummary {
  totalMatches: number
  avgWinRate: number
  avgKda: number
  avgDpm: number
}

export async function getGroupSummary(): Promise<GroupSummary> {
  const rows = await sql_`
    SELECT
      (SELECT COUNT(*) FROM matches)::int AS "totalMatches",
      CASE WHEN SUM(games) > 0 THEN SUM(wins)::float / SUM(games) ELSE 0 END AS "avgWinRate",
      CASE WHEN SUM(total_deaths) > 0
        THEN (SUM(total_kills) + SUM(total_assists))::float / SUM(total_deaths)
        ELSE 0 END AS "avgKda",
      CASE WHEN SUM(total_duration) > 0
        THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0)
        ELSE 0 END AS "avgDpm"
    FROM player_stats_cache
  `
  const r = rows[0]
  return {
    totalMatches: r.totalMatches ?? 0,
    avgWinRate: parseFloat(r.avgWinRate ?? '0'),
    avgKda: parseFloat(r.avgKda ?? '0'),
    avgDpm: parseFloat(r.avgDpm ?? '0')
  }
}

export async function upsertItemMeta(
  items: Array<{ id: number; name: string; iconPath: string; category: string }>,
  componentIds: number[] = []
): Promise<void> {
  if (items.length > 0) {
    const ids = items.map(i => i.id)
    const names = items.map(i => i.name)
    const iconPaths = items.map(i => i.iconPath)
    const categories = items.map(i => i.category)
    await sql_`
      INSERT INTO meta_items (id, name, "iconPath", category, is_component)
      SELECT *, false FROM unnest(${ids}::int[], ${names}::text[], ${iconPaths}::text[], ${categories}::text[])
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        "iconPath" = EXCLUDED."iconPath",
        category = EXCLUDED.category,
        is_component = false
    `
  }
  if (componentIds.length > 0) {
    await sql_`
      INSERT INTO meta_items (id, name, "iconPath", category, is_component)
      SELECT id, '', null, null, true FROM unnest(${componentIds}::int[]) AS id
      ON CONFLICT (id) DO UPDATE SET is_component = true
    `
  }
  await sql_`TRUNCATE item_archetypes_cache`
}

const inflightArchetypes = new Map<string, Promise<any[]>>()

export async function getOrComputeArchetypes(
  championId: number,
  patches?: string[]
): Promise<any[]> {
  const patchesKey = `v${ARCHETYPE_CACHE_VERSION}:${(patches ?? []).slice().sort().join(',')}`
  const inflightKey = `${championId}:${patchesKey}`
  if (inflightArchetypes.has(inflightKey)) return inflightArchetypes.get(inflightKey)!
  const promise = _computeArchetypes(championId, patchesKey, patches)
  inflightArchetypes.set(inflightKey, promise)
  promise.finally(() => inflightArchetypes.delete(inflightKey))
  return promise
}

async function _computeArchetypes(
  championId: number,
  patchesKey: string,
  patches?: string[]
): Promise<any[]> {
  const cached = await sql_`
    SELECT archetypes FROM item_archetypes_cache
    WHERE "championId" = ${championId} AND patches_key = ${patchesKey}
  `
  if (cached.length > 0) {
    const val = cached[0].archetypes
    return (Array.isArray(val) ? val : JSON.parse(val as string)) as any[]
  }

  console.log(`[db] computing archetypes for champion ${championId}...`)

  const buildRows = patches?.length
    ? await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId} AND "gameVersion" = ANY(${patches})
        GROUP BY build ORDER BY games DESC
      `
    : await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId}
        GROUP BY build ORDER BY games DESC
      `

  if ((buildRows as any[]).length === 0) return []

  const allItemIds = [...new Set((buildRows as any[]).flatMap(r => r.build as number[]))]
  const metaRows = await sql_`SELECT id, name, "iconPath", category, is_component FROM meta_items WHERE id = ANY(${allItemIds})`
  const fullMeta = new Map((metaRows as any[]).map(r => [r.id as number, r]))
  const componentIds = new Set((metaRows as any[]).filter(r => r.is_component).map(r => r.id as number))

  const enriched = (buildRows as any[])
    .map(b => ({
      build: b.build as number[],
      games: b.games as number,
      wins: b.wins as number,
      items: (b.build as number[])
        .filter(id => fullMeta.has(id))
        .map(id => fullMeta.get(id)!),
    }))
    .filter(b => b.items.filter((i: any) => i.category !== 'Boots' && !componentIds.has(i.id)).length >= 4)

  // Compute no-item ratio per item: high ratio = item appears in games with many empty slots = bought early
  const noItemRatioRows = patches?.length
    ? await sql_`
        SELECT pi."itemId", SUM(6 - cnt.total)::float / COUNT(*) AS ratio
        FROM participants p
        JOIN participant_items pi ON pi."participantId" = p.id
        JOIN meta_items m ON m.id = pi."itemId"
          AND m.is_component = false
          AND m.name IS NOT NULL AND m.name != ''
        JOIN (
          SELECT "participantId", COUNT(*) AS total
          FROM participant_items
          GROUP BY "participantId"
        ) cnt ON cnt."participantId" = p.id
        WHERE p."championId" = ${championId}
          AND p."gameVersion" = ANY(${patches})
        GROUP BY pi."itemId"
      `
    : await sql_`
        SELECT pi."itemId", SUM(6 - cnt.total)::float / COUNT(*) AS ratio
        FROM participants p
        JOIN participant_items pi ON pi."participantId" = p.id
        JOIN meta_items m ON m.id = pi."itemId"
          AND m.is_component = false
          AND m.name IS NOT NULL AND m.name != ''
        JOIN (
          SELECT "participantId", COUNT(*) AS total
          FROM participant_items
          GROUP BY "participantId"
        ) cnt ON cnt."participantId" = p.id
        WHERE p."championId" = ${championId}
        GROUP BY pi."itemId"
      `
  const noItemRatios = new Map<number, number>(
    (noItemRatioRows as any[]).map(r => [r.itemId as number, parseFloat(r.ratio)])
  )

  const { clusterByCooccurrence } = await import('./itemArchetypes')
  const archetypes = clusterByCooccurrence(enriched, componentIds, noItemRatios)

  // item_builds_cache is C(n,5) inflated: a player with 6 items contributes C(3,2)=3 rows
  // for any 3-item core triple, so triple.games overcounts real participants. Re-query
  // participant_items to get the true count for each archetype's core items.
  const corrected = await Promise.all(archetypes.map(async (arch) => {
    const allCoreIds = [arch.openingId, ...arch.coreIds]
    const sortedQuad = [...allCoreIds].sort((a, b) => a - b)
    const quadRows = patches?.length
      ? await sql_`
          SELECT games, wins
          FROM item_quads_cache
          WHERE "championId" = ${championId}
            AND "gameVersion" = ANY(${patches})
            AND quad = ${sortedQuad}::int[]
        `
      : await sql_`
          SELECT games, wins
          FROM item_quads_cache
          WHERE "championId" = ${championId}
            AND quad = ${sortedQuad}::int[]
        `
    let games = 0, wins = 0
    for (const r of quadRows as any[]) {
      games += r.games ?? 0
      wins += r.wins ?? 0
    }
    const row = { games, wins }

    const slotRows = patches?.length
      ? await sql_`
          SELECT pi."itemId", AVG(pi."slot"::float) AS avg_slot
          FROM participant_item_sets pis
          JOIN participants p ON p.id = pis."participantId"
          JOIN participant_items pi ON pi."participantId" = p.id
            AND pi."itemId" = ANY(${sortedQuad}::int[])
            AND pi."slot" IS NOT NULL
          WHERE pis."itemIds" @> ${sortedQuad}::int[]
            AND p."championId" = ${championId}
            AND p."gameVersion" = ANY(${patches})
          GROUP BY pi."itemId"
        `
      : await sql_`
          SELECT pi."itemId", AVG(pi."slot"::float) AS avg_slot
          FROM participant_item_sets pis
          JOIN participants p ON p.id = pis."participantId"
          JOIN participant_items pi ON pi."participantId" = p.id
            AND pi."itemId" = ANY(${sortedQuad}::int[])
            AND pi."slot" IS NOT NULL
          WHERE pis."itemIds" @> ${sortedQuad}::int[]
            AND p."championId" = ${championId}
          GROUP BY pi."itemId"
        `
    const slotMap = new Map<number, number>(
      (slotRows as any[]).map(r => [r.itemId as number, parseFloat(r.avg_slot)])
    )

    let orderedIds = allCoreIds
    if (slotMap.size > 0) {
      orderedIds = [...allCoreIds].sort((a, b) => (slotMap.get(a) ?? 99) - (slotMap.get(b) ?? 99))
    }

    return {
      ...arch,
      games: row?.games ?? 0,
      wins: row?.wins ?? 0,
      openingId: orderedIds[0],
      openingItem: fullMeta.get(orderedIds[0]) ?? arch.openingItem,
      coreIds: orderedIds.slice(1),
      coreItems: orderedIds.slice(1).map(id => fullMeta.get(id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' }),
    }
  }))

  await sql_`
    INSERT INTO item_archetypes_cache ("championId", patches_key, archetypes)
    VALUES (${championId}, ${patchesKey}, ${sql_.json(corrected as any)})
    ON CONFLICT ("championId", patches_key) DO UPDATE SET
      archetypes = EXCLUDED.archetypes,
      computed_at = now()
  `
  console.log(`[db] archetypes cached for champion ${championId}`)
  return corrected
}

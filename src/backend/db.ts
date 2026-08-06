import path from 'path'
import dotenv from 'dotenv'
const envFile = process.env.NODE_ENV !== 'production' ? '.env.dev' : '.env'
dotenv.config({ path: path.resolve(__dirname, '../../', envFile), override: process.env.NODE_ENV !== 'test' })
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: false })
import postgres from 'postgres'
import { wilsonScore } from './lib/wilson'

const SYNC_LEASE_MS = 5 * 60 * 1000
const ARCHETYPE_CACHE_VERSION = 8

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

export async function connectDb(url?: string): Promise<void> {
  const connectionUrl = url ?? process.env.DATABASE_URL
  if (!connectionUrl) throw new Error('DATABASE_URL is not set')
  sql_ = postgres(connectionUrl, { onnotice: () => {} })
}

export async function initDb(url?: string, onProgress?: (phase: string) => void): Promise<void> {
  const connectionUrl = url ?? process.env.DATABASE_URL
  if (!connectionUrl) throw new Error('DATABASE_URL is not set')

  sql_ = postgres(connectionUrl, { onnotice: () => {} })

  const existingCols = await sql_`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN (
      'matches','participants','participant_items','participant_item_sets','meta_items',
      'item_picks_cache','item_builds_cache',
      'champion_stats_cache','augment_stats_cache',
      'player_stats_cache','player_champion_stats_cache','augment_champion_stats_cache',
      'meta_champions'
    )
  `
  const hasCol = (table: string, col: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (existingCols as any[]).some((r) => r.table_name === table && r.column_name === col)

  console.log('[db] creating tables...')
  const _t0 = Date.now()
  await sql_`
    CREATE TABLE IF NOT EXISTS matches (
      "gameId"       BIGINT PRIMARY KEY,
      "queueId"      INTEGER NOT NULL,
      "gameCreation" BIGINT NOT NULL,
      "gameDuration" INTEGER NOT NULL,
      "gameVersion"  TEXT
    )
  `
  if (!hasCol('matches', 'gameVersion')) await sql_`ALTER TABLE matches ADD COLUMN "gameVersion" TEXT`
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
  if (!hasCol('participants', 'gameVersion')) await sql_`ALTER TABLE participants ADD COLUMN "gameVersion" TEXT`
  if (!hasCol('participants', 'gameDuration')) await sql_`ALTER TABLE participants ADD COLUMN "gameDuration" INTEGER`
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
  if (!hasCol('participant_items', 'slot')) await sql_`ALTER TABLE participant_items ADD COLUMN "slot" INTEGER`
  await sql_`
    CREATE TABLE IF NOT EXISTS participant_item_sets (
      "participantId" INTEGER NOT NULL UNIQUE REFERENCES participants(id),
      "itemIds"       INTEGER[] NOT NULL
    )
  `
  await sql_`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_participant_item_sets_gin ON participant_item_sets USING GIN ("itemIds")`
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

  console.log(`[db] tables done (${Date.now() - _t0}ms)`)
  console.log('[db] creating indexes...')
  const _t1 = Date.now()
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
  await sql_`CREATE INDEX IF NOT EXISTS idx_items_participantId_itemId_slot ON participant_items("participantId", "itemId", "slot")`
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
  if (!hasCol('meta_champions', 'tags'))
    await sql_`ALTER TABLE meta_champions ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}'`
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
  if (!hasCol('champion_stats_cache', 'queueId')) {
    await sql_`ALTER TABLE champion_stats_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE champion_stats_cache DROP CONSTRAINT IF EXISTS champion_stats_cache_pkey`
    await sql_`ALTER TABLE champion_stats_cache ADD PRIMARY KEY ("gameVersion", "queueId", "championId")`
  }
  let needsChampCacheRebuild = false
  if (!hasCol('champion_stats_cache', 'total_team_kills')) {
    await sql_`ALTER TABLE champion_stats_cache ADD COLUMN total_team_kills BIGINT NOT NULL DEFAULT 0`
    needsChampCacheRebuild = true
  }
  if (!hasCol('champion_stats_cache', 'total_gold')) {
    await sql_`ALTER TABLE champion_stats_cache ADD COLUMN total_gold BIGINT NOT NULL DEFAULT 0`
    needsChampCacheRebuild = true
  }
  if (needsChampCacheRebuild) {
    await sql_`TRUNCATE champion_stats_cache`
  }
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
  if (!hasCol('augment_stats_cache', 'queueId')) {
    await sql_`ALTER TABLE augment_stats_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE augment_stats_cache DROP CONSTRAINT IF EXISTS augment_stats_cache_pkey`
    await sql_`ALTER TABLE augment_stats_cache ADD PRIMARY KEY ("gameVersion", "queueId", "augmentId")`
  }
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
  if (!hasCol('player_stats_cache', 'queueId')) {
    await sql_`ALTER TABLE player_stats_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE player_stats_cache DROP CONSTRAINT IF EXISTS player_stats_cache_pkey`
    await sql_`ALTER TABLE player_stats_cache ADD PRIMARY KEY ("gameVersion", "queueId", puuid)`
  }
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
  if (!hasCol('player_champion_stats_cache', 'queueId')) {
    await sql_`ALTER TABLE player_champion_stats_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE player_champion_stats_cache DROP CONSTRAINT IF EXISTS player_champion_stats_cache_pkey`
    await sql_`ALTER TABLE player_champion_stats_cache ADD PRIMARY KEY ("gameVersion", "queueId", puuid, "championId")`
  }
  let needsPCSRebuild = false
  if (!hasCol('player_champion_stats_cache', 'total_gold')) {
    await sql_`ALTER TABLE player_champion_stats_cache ADD COLUMN total_gold BIGINT NOT NULL DEFAULT 0`
    needsPCSRebuild = true
  }
  if (!hasCol('player_champion_stats_cache', 'total_team_kills')) {
    await sql_`ALTER TABLE player_champion_stats_cache ADD COLUMN total_team_kills BIGINT NOT NULL DEFAULT 0`
    needsPCSRebuild = true
  }
  if (needsPCSRebuild) {
    await sql_`TRUNCATE player_champion_stats_cache`
  }
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
  if (!hasCol('augment_champion_stats_cache', 'queueId')) {
    await sql_`ALTER TABLE augment_champion_stats_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE augment_champion_stats_cache DROP CONSTRAINT IF EXISTS augment_champion_stats_cache_pkey`
    await sql_`ALTER TABLE augment_champion_stats_cache ADD PRIMARY KEY ("gameVersion", "queueId", "augmentId", "championId")`
  }
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
  if (!hasCol('item_builds_cache', 'queueId')) {
    await sql_`ALTER TABLE item_builds_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE item_builds_cache DROP CONSTRAINT IF EXISTS item_builds_cache_pkey`
    await sql_`ALTER TABLE item_builds_cache ADD PRIMARY KEY ("gameVersion", "queueId", "championId", build)`
  }
  await sql_`
    CREATE TABLE IF NOT EXISTS item_picks_cache (
      "gameVersion"  TEXT    NOT NULL,
      "championId"   INTEGER NOT NULL,
      "itemId"       INTEGER NOT NULL,
      picks          INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("gameVersion", "championId", "itemId")
    )
  `
  await sql_`CREATE INDEX IF NOT EXISTS idx_item_picks_cache_champ_gv ON item_picks_cache ("championId", "gameVersion")`
  if (!hasCol('item_picks_cache', 'slot_emptiness_sum')) await sql_`ALTER TABLE item_picks_cache ADD COLUMN slot_emptiness_sum FLOAT NOT NULL DEFAULT 0`
  if (!hasCol('item_picks_cache', 'slot_emptiness_count')) await sql_`ALTER TABLE item_picks_cache ADD COLUMN slot_emptiness_count INTEGER NOT NULL DEFAULT 0`
  if (!hasCol('item_picks_cache', 'queueId')) {
    await sql_`ALTER TABLE item_picks_cache ADD COLUMN "queueId" INTEGER NOT NULL DEFAULT 2400`
    await sql_`ALTER TABLE item_picks_cache DROP CONSTRAINT IF EXISTS item_picks_cache_pkey`
    await sql_`ALTER TABLE item_picks_cache ADD PRIMARY KEY ("gameVersion", "queueId", "championId", "itemId")`
  }
  await sql_`
    CREATE TABLE IF NOT EXISTS meta_items (
      id           int  PRIMARY KEY,
      name         text NOT NULL,
      "iconPath"   text,
      category     text,
      is_component boolean DEFAULT false
    )
  `
  if (!hasCol('meta_items', 'is_component')) await sql_`ALTER TABLE meta_items ADD COLUMN is_component boolean DEFAULT false`
  await sql_`
    CREATE TABLE IF NOT EXISTS item_archetypes_cache (
      "championId"  int  NOT NULL,
      patches_key   text NOT NULL,
      archetypes    jsonb NOT NULL,
      computed_at   timestamptz DEFAULT now(),
      PRIMARY KEY ("championId", patches_key)
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS player_elo (
      puuid                        TEXT    NOT NULL,
      "queueId"                    INTEGER NOT NULL,
      elo                          FLOAT   NOT NULL DEFAULT 1500,
      games_rated                  INTEGER NOT NULL DEFAULT 0,
      last_processed_game_creation BIGINT  NOT NULL DEFAULT 0,
      updated_at                   TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (puuid, "queueId")
    )
  `
  await sql_`
    CREATE TABLE IF NOT EXISTS elo_history (
      puuid          TEXT    NOT NULL,
      "gameId"       BIGINT  NOT NULL,
      "queueId"      INTEGER NOT NULL,
      elo_before     FLOAT   NOT NULL,
      elo_after      FLOAT   NOT NULL,
      delta          FLOAT   NOT NULL,
      "gameCreation" BIGINT  NOT NULL,
      PRIMARY KEY (puuid, "gameId", "queueId")
    )
  `
  await sql_`CREATE INDEX IF NOT EXISTS idx_elo_history_puuid_queue_gc ON elo_history (puuid, "queueId", "gameCreation")`

console.log(`[db] indexes done (${Date.now() - _t1}ms)`)
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

  {
    // Per-patch backfill for player caches — avoids huge hash aggregates that spill to disk
    const pvRows = await sql_`SELECT DISTINCT "gameVersion" FROM participants WHERE "gameVersion" IS NOT NULL ORDER BY 1`
    const pvList = pvRows.map((r: any) => r.gameVersion as string)
    const existingPlayerRows = await sql_`SELECT DISTINCT "gameVersion" FROM player_stats_cache`
    const existingPlayer = new Set(existingPlayerRows.map((r: any) => r.gameVersion as string))
    const missingPlayer = pvList.filter(gv => !existingPlayer.has(gv))
    if (missingPlayer.length > 0) {
      console.log(`[db] backfilling player stats cache (${missingPlayer.length} patches)...`)
      const _t3 = Date.now()
      for (let i = 0; i < missingPlayer.length; i++) {
        const gv = missingPlayer[i]
        const _tp = Date.now()
        console.log(`[db] player stats ${gv} (${i + 1}/${missingPlayer.length})...`)
        onProgress?.(`Rebuilding player cache: ${gv} (${i + 1}/${missingPlayer.length})…`)
        await sql_`
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
        console.log(`[db] player stats ${gv} done (${Date.now() - _tp}ms)`)
      }
      console.log(`[db] player stats cache backfill complete (${Date.now() - _t3}ms total)`)
    }
    const existingPCRows = await sql_`SELECT DISTINCT "gameVersion" FROM player_champion_stats_cache`
    const existingPC = new Set(existingPCRows.map((r: any) => r.gameVersion as string))
    const missingPC = pvList.filter(gv => !existingPC.has(gv))
    if (missingPC.length > 0) {
      console.log(`[db] backfilling player_champion_stats_cache (${missingPC.length} patches)...`)
      const _t4 = Date.now()
      for (let i = 0; i < missingPC.length; i++) {
        const gv = missingPC[i]
        const _tpc = Date.now()
        console.log(`[db] player_champion_stats ${gv} (${i + 1}/${missingPC.length})...`)
        onProgress?.(`Rebuilding player/champion cache: ${gv} (${i + 1}/${missingPC.length})…`)
        await sql_`
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
        console.log(`[db] player_champion_stats ${gv} done (${Date.now() - _tpc}ms)`)
      }
      console.log(`[db] player_champion_stats_cache backfill complete (${Date.now() - _t4}ms total)`)
    }
  }

  ;(async () => {
    try {
      const patches = await getPatches()
      const todoBuilds: string[] = []
      const todoPicks: string[] = []
      for (const gv of patches) {
        const [{ count: bc }] = await sql_`SELECT COUNT(*) FROM item_builds_cache WHERE "gameVersion" = ${gv}`
        if (Number(bc) === 0) todoBuilds.push(gv)
        const [{ count: pc }] = await sql_`SELECT COUNT(*) FROM item_picks_cache WHERE "gameVersion" = ${gv}`
        if (Number(pc) === 0) todoPicks.push(gv)
      }
      if (todoBuilds.length === 0 && todoPicks.length === 0) return
      if (todoBuilds.length > 0) {
        console.log(`[item-builds] backfilling ${todoBuilds.length} patch(es)...`)
        onProgress?.('Building item builds cache…')
        for (let i = 0; i < todoBuilds.length; i++) {
          const gv = todoBuilds[i]
          console.log(`[item-builds] ${gv} (${i + 1}/${todoBuilds.length})...`)
          onProgress?.(`Building item builds: ${gv} (${i + 1}/${todoBuilds.length})…`)
          await sql_`
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
          console.log(`[item-builds] ${gv} done`)
        }
        console.log('[item-builds] backfill complete')
      }
      if (todoPicks.length > 0) {
        console.log(`[item-picks] backfilling ${todoPicks.length} patch(es)...`)
        onProgress?.('Building item picks cache…')
        for (let i = 0; i < todoPicks.length; i++) {
          const gv = todoPicks[i]
          console.log(`[item-picks] ${gv} (${i + 1}/${todoPicks.length})...`)
          onProgress?.(`Building item picks: ${gv} (${i + 1}/${todoPicks.length})…`)
          await sql_`
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
          console.log(`[item-picks] ${gv} done`)
        }
        console.log('[item-picks] backfill complete')
      }
      onProgress?.('')
    } catch (e) {
      console.warn('[item-builds/picks] backfill failed:', (e as Error).message)
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
    const _tp = Date.now()
    const pruned = await deleteOldMatches(keepPatches)
    if (pruned > 0) console.log(`[db] pruned ${pruned} old matches (${Date.now() - _tp}ms, keeping: ${keepPatches.join(', ')})`)
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
    await tx`DELETE FROM item_picks_cache WHERE "gameVersion" <> ALL(${keepPatches})`
    const prunedVersions = (await tx`
      SELECT DISTINCT "gameVersion" AS gv FROM matches
      WHERE "gameVersion" <> ALL(${keepPatches}) AND "gameVersion" IS NOT NULL
    `).map((r: any) => r.gv as string)
    for (const gv of prunedVersions) {
      await tx`DELETE FROM item_archetypes_cache WHERE patches_key LIKE ${'%' + gv + '%'}`
    }
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
    console.log(`[backfill] augment_champion ${gv} done`)
  }

  for (const gv of patches) {
    const [{ count: zc }] = await sql_`SELECT COUNT(*) FROM item_picks_cache WHERE "gameVersion" = ${gv} AND slot_emptiness_count = 0`
    if (Number(zc) === 0) continue
    console.log(`[item-picks] backfilling slot_emptiness for ${gv}...`)
    onProgress?.(`Updating item picks cache: ${gv}…`)
    await sql_`
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
    console.log(`[item-picks] slot_emptiness backfill for ${gv} done`)
  }

  onProgress?.('')
  console.log('[backfill] complete')
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function upsertChampions(map: Record<number, { name: string; tags: string[] }>): Promise<void> {
  const rows = Object.entries(map).map(([id, v]) => [parseInt(id), v.name, v.tags])
  if (rows.length === 0) return
  await sql_`
    INSERT INTO meta_champions (id, name, tags)
    VALUES ${sql_(rows as any)}
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tags = EXCLUDED.tags
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

export async function getChampionsFromDb(): Promise<Record<number, { name: string; tags: string[] }>> {
  const rows = await sql_<{ id: number; name: string; tags: string[] }[]>`SELECT id, name, tags FROM meta_champions`
  return Object.fromEntries(rows.map(r => [r.id, { name: r.name, tags: r.tags }]))
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
  { patch: '26.15', startMs: new Date('2026-07-22T20:00:00Z').getTime() },
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
          SELECT p.id, p."gameVersion", m."queueId", p."championId", p.win::int AS win
          FROM participants p
          JOIN matches m ON m."gameId" = p."gameId"
          WHERE p."gameId" = ANY(${newGameIdArr})
            AND p."gameVersion" IS NOT NULL
        ),
        agg AS (
          SELECT np."gameVersion", np."queueId", np."championId", np.win,
            array_agg(pi."itemId" ORDER BY pi."itemId") AS items
          FROM new_part np JOIN participant_items pi ON pi."participantId" = np.id
          GROUP BY np.id, np."gameVersion", np."queueId", np."championId", np.win
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
        ON CONFLICT ("gameVersion","queueId","championId",build) DO UPDATE SET
          games = item_builds_cache.games + EXCLUDED.games,
          wins  = item_builds_cache.wins  + EXCLUDED.wins
      `
      await tx`
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
        WHERE p."gameId" = ANY(${newGameIdArr})
          AND p."gameVersion" IS NOT NULL
        GROUP BY p."gameVersion", m."queueId", p."championId", pi."itemId"
        ON CONFLICT ("gameVersion","queueId","championId","itemId") DO UPDATE SET
          picks                = item_picks_cache.picks + EXCLUDED.picks,
          wins                 = item_picks_cache.wins  + EXCLUDED.wins,
          slot_emptiness_sum   = item_picks_cache.slot_emptiness_sum   + EXCLUDED.slot_emptiness_sum,
          slot_emptiness_count = item_picks_cache.slot_emptiness_count + EXCLUDED.slot_emptiness_count
      `
      const affectedChamps = [...new Set(newMatches.flatMap(m => m.participants.map(p => p.championId)))]
      if (affectedChamps.length > 0) {
        await tx`UPDATE item_archetypes_cache SET computed_at = NOW() - INTERVAL '16 minutes' WHERE "championId" = ANY(${affectedChamps})`
      }
    }

    // Maintain pre-aggregated summary tables
    const teamKillMap = new Map<string, number>()
    for (const m of newMatches) {
      for (const p of m.participants) {
        const key = `${m.gameId}:${p.teamId}`
        teamKillMap.set(key, (teamKillMap.get(key) ?? 0) + p.kills)
      }
    }
    const champAgg = new Map<string, [string, number, number, string, number, number, number, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        const teamKills = teamKillMap.get(`${m.gameId}:${p.teamId}`) ?? 0
        const key = `${m.gameVersion}:${m.queueId}:${p.championId}`
        const cur = champAgg.get(key) ?? [m.gameVersion, m.queueId, p.championId, p.championName, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        cur[4] += 1; cur[5] += p.win ? 1 : 0; cur[6] += p.kills; cur[7] += p.deaths
        cur[8] += p.assists; cur[9] += p.damageDealt; cur[10] += m.gameDuration
        cur[11] += teamKills; cur[12] += p.goldEarned
        champAgg.set(key, cur)
      }
    }
    if (champAgg.size > 0) {
      await tx`
        INSERT INTO champion_stats_cache
          ("gameVersion","queueId","championId","championName",games,wins,
           total_kills,total_deaths,total_assists,total_damage,total_duration,
           total_team_kills,total_gold)
        VALUES ${tx([...champAgg.values()])}
        ON CONFLICT ("gameVersion","queueId","championId") DO UPDATE SET
          "championName"   = EXCLUDED."championName",
          games            = champion_stats_cache.games + EXCLUDED.games,
          wins             = champion_stats_cache.wins + EXCLUDED.wins,
          total_kills      = champion_stats_cache.total_kills + EXCLUDED.total_kills,
          total_deaths     = champion_stats_cache.total_deaths + EXCLUDED.total_deaths,
          total_assists    = champion_stats_cache.total_assists + EXCLUDED.total_assists,
          total_damage     = champion_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration   = champion_stats_cache.total_duration + EXCLUDED.total_duration,
          total_team_kills = champion_stats_cache.total_team_kills + EXCLUDED.total_team_kills,
          total_gold       = champion_stats_cache.total_gold + EXCLUDED.total_gold
      `
    }

    const augAgg = new Map<string, [string, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        for (const augId of p.augments) {
          if (!augId) continue
          const key = `${m.gameVersion}:${m.queueId}:${augId}`
          const cur = augAgg.get(key) ?? [m.gameVersion, m.queueId, augId, 0, 0, 0, 0]
          cur[3] += 1; cur[4] += p.win ? 1 : 0; cur[5] += p.damageDealt; cur[6] += m.gameDuration
          augAgg.set(key, cur)
        }
      }
    }
    if (augAgg.size > 0) {
      await tx`
        INSERT INTO augment_stats_cache ("gameVersion","queueId","augmentId",pick_count,wins,total_damage,total_duration)
        VALUES ${tx([...augAgg.values()])}
        ON CONFLICT ("gameVersion","queueId","augmentId") DO UPDATE SET
          pick_count     = augment_stats_cache.pick_count + EXCLUDED.pick_count,
          wins           = augment_stats_cache.wins + EXCLUDED.wins,
          total_damage   = augment_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration = augment_stats_cache.total_duration + EXCLUDED.total_duration
      `
    }

    const playerAgg = new Map<string, [string, number, string, string, number, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        if (!p.puuid) continue
        const key = `${m.gameVersion}:${m.queueId}:${p.puuid}`
        const cur = playerAgg.get(key) ?? [m.gameVersion, m.queueId, p.puuid, p.summonerName, 0, 0, 0, 0, 0, 0, 0]
        cur[4] += 1; cur[5] += p.win ? 1 : 0; cur[6] += p.kills; cur[7] += p.deaths
        cur[8] += p.assists; cur[9] += p.damageDealt; cur[10] += m.gameDuration
        playerAgg.set(key, cur)
      }
    }
    if (playerAgg.size > 0) {
      await tx`
        INSERT INTO player_stats_cache ("gameVersion","queueId",puuid,"summonerName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([...playerAgg.values()])}
        ON CONFLICT ("gameVersion","queueId",puuid) DO UPDATE SET
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

    const playerChampAgg = new Map<string, [string, number, string, number, string, number, number, number, number, number, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        if (!p.puuid) continue
        const teamKills = teamKillMap.get(`${m.gameId}:${p.teamId}`) ?? 0
        const key = `${m.gameVersion}:${m.queueId}:${p.puuid}:${p.championId}`
        const cur = playerChampAgg.get(key) ?? [m.gameVersion, m.queueId, p.puuid, p.championId, p.championName, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        cur[5] += 1; cur[6] += p.win ? 1 : 0; cur[7] += p.kills; cur[8] += p.deaths
        cur[9] += p.assists; cur[10] += p.damageDealt; cur[11] += m.gameDuration
        cur[12] += p.goldEarned; cur[13] += teamKills
        playerChampAgg.set(key, cur)
      }
    }
    if (playerChampAgg.size > 0) {
      await tx`
        INSERT INTO player_champion_stats_cache
          ("gameVersion","queueId",puuid,"championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration,total_gold,total_team_kills)
        VALUES ${tx([...playerChampAgg.values()])}
        ON CONFLICT ("gameVersion","queueId",puuid,"championId") DO UPDATE SET
          "championName"   = EXCLUDED."championName",
          games            = player_champion_stats_cache.games + EXCLUDED.games,
          wins             = player_champion_stats_cache.wins + EXCLUDED.wins,
          total_kills      = player_champion_stats_cache.total_kills + EXCLUDED.total_kills,
          total_deaths     = player_champion_stats_cache.total_deaths + EXCLUDED.total_deaths,
          total_assists    = player_champion_stats_cache.total_assists + EXCLUDED.total_assists,
          total_damage     = player_champion_stats_cache.total_damage + EXCLUDED.total_damage,
          total_duration   = player_champion_stats_cache.total_duration + EXCLUDED.total_duration,
          total_gold       = player_champion_stats_cache.total_gold + EXCLUDED.total_gold,
          total_team_kills = player_champion_stats_cache.total_team_kills + EXCLUDED.total_team_kills
      `
    }

    const augChampAgg = new Map<string, [string, number, number, number, string, number, number, number, number]>()
    for (const m of newMatches) {
      if (!m.gameVersion) continue
      for (const p of m.participants) {
        for (const augId of p.augments) {
          if (!augId) continue
          const key = `${m.gameVersion}:${m.queueId}:${augId}:${p.championId}`
          const cur = augChampAgg.get(key) ?? [m.gameVersion, m.queueId, augId, p.championId, p.championName, 0, 0, 0, 0]
          cur[5] += 1; cur[6] += p.win ? 1 : 0; cur[7] += p.damageDealt; cur[8] += m.gameDuration
          augChampAgg.set(key, cur)
        }
      }
    }
    if (augChampAgg.size > 0) {
      await tx`
        INSERT INTO augment_champion_stats_cache
          ("gameVersion","queueId","augmentId","championId","championName",pick_count,wins,total_damage,total_duration)
        VALUES ${tx([...augChampAgg.values()])}
        ON CONFLICT ("gameVersion","queueId","augmentId","championId") DO UPDATE SET
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

  // Recompute summary caches for this gameVersion + queueId after the transaction
  if (match.gameVersion) {
    const gv = match.gameVersion
    const qid = match.queueId
    await sql_`
      WITH team_kills AS (
        SELECT p2."gameId", p2."teamId", SUM(p2.kills)::bigint AS team_kills
        FROM participants p2
        JOIN matches m2 ON m2."gameId" = p2."gameId"
        WHERE m2."gameVersion" = ${gv} AND m2."queueId" = ${qid}
        GROUP BY p2."gameId", p2."teamId"
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
      WHERE p."gameVersion" = ${gv} AND m."queueId" = ${qid}
      GROUP BY p."gameVersion", m."queueId", p."championId"
      ON CONFLICT ("gameVersion","queueId","championId") DO UPDATE SET
        "championName"   = EXCLUDED."championName",
        games            = EXCLUDED.games,
        wins             = EXCLUDED.wins,
        total_kills      = EXCLUDED.total_kills,
        total_deaths     = EXCLUDED.total_deaths,
        total_assists    = EXCLUDED.total_assists,
        total_damage     = EXCLUDED.total_damage,
        total_duration   = EXCLUDED.total_duration,
        total_team_kills = EXCLUDED.total_team_kills,
        total_gold       = EXCLUDED.total_gold
    `
    await sql_`
      INSERT INTO augment_stats_cache ("gameVersion","queueId","augmentId",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion", m."queueId", pa."augmentId",
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p."damageDealt"), SUM(p."gameDuration")
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN participant_augments pa ON pa."participantId" = p.id
      WHERE p."gameVersion" = ${gv} AND m."queueId" = ${qid}
      GROUP BY p."gameVersion", m."queueId", pa."augmentId"
      ON CONFLICT ("gameVersion","queueId","augmentId") DO UPDATE SET
        pick_count     = EXCLUDED.pick_count,
        wins           = EXCLUDED.wins,
        total_damage   = EXCLUDED.total_damage,
        total_duration = EXCLUDED.total_duration
    `
    await sql_`
      INSERT INTO player_stats_cache ("gameVersion","queueId",puuid,"summonerName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion", m."queueId", p.puuid, MAX(p."summonerName"),
        COUNT(*)::int, SUM(p.win::int)::int,
        SUM(p.kills)::int, SUM(p.deaths)::int, SUM(p.assists)::int,
        SUM(p."damageDealt")::bigint, SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p."gameVersion" = ${gv} AND m."queueId" = ${qid} AND p.puuid != ''
      GROUP BY p."gameVersion", m."queueId", p.puuid
      ON CONFLICT ("gameVersion","queueId",puuid) DO UPDATE SET
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
        ("gameVersion","queueId",puuid,"championId","championName",games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
      SELECT p."gameVersion",m."queueId",p.puuid,p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p.kills)::int,SUM(p.deaths)::int,SUM(p.assists)::int,
        SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p."gameVersion" = ${gv} AND m."queueId" = ${qid} AND p.puuid != ''
      GROUP BY p."gameVersion",m."queueId",p.puuid,p."championId"
      ON CONFLICT ("gameVersion","queueId",puuid,"championId") DO UPDATE SET
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
        ("gameVersion","queueId","augmentId","championId","championName",pick_count,wins,total_damage,total_duration)
      SELECT p."gameVersion",m."queueId",pa."augmentId",p."championId",MIN(p."championName"),
        COUNT(*)::int,SUM(p.win::int)::int,SUM(p."damageDealt")::bigint,SUM(p."gameDuration")::bigint
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      JOIN participant_augments pa ON pa."participantId"=p.id
      WHERE p."gameVersion" = ${gv} AND m."queueId" = ${qid}
      GROUP BY p."gameVersion",m."queueId",pa."augmentId",p."championId"
      ON CONFLICT ("gameVersion","queueId","augmentId","championId") DO UPDATE SET
        "championName"  = EXCLUDED."championName",
        pick_count      = EXCLUDED.pick_count,
        wins            = EXCLUDED.wins,
        total_damage    = EXCLUDED.total_damage,
        total_duration  = EXCLUDED.total_duration
    `
    const affectedChampionIds = [...new Set(match.participants.map(p => p.championId))]
    await sql_`UPDATE item_archetypes_cache SET computed_at = NOW() - INTERVAL '16 minutes' WHERE "championId" = ANY(${affectedChampionIds}::int[])`
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

export async function getCoplayerStats(puuid: string, patches?: string[], queueId = 2400): Promise<CoplayerStat[]> {
  const conditions: string[] = [`p1.puuid = $1`, `p2.puuid != $1`, `p2.puuid != ''`]
  const params: any[] = [puuid]
  params.push(queueId); conditions.push(`m."queueId" = $${params.length}`)
  if (patches?.length) { params.push(patches); conditions.push(`p1."gameVersion" = ANY($${params.length})`) }
  const where = `WHERE ${conditions.join(' AND ')}`

  const rows = await sql_.unsafe(`
    SELECT p2.puuid,
      MIN(p2."summonerName") AS "summonerName",
      COUNT(*)::int AS games,
      SUM(p2.win::int)::int AS wins
    FROM participants p1
    JOIN participants p2 ON p1."gameId" = p2."gameId" AND p1."teamId" = p2."teamId"
    JOIN matches m ON m."gameId" = p1."gameId"
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
  elo: number | null
}

export async function getPlayerStats(patches?: string[], queueId = 2400): Promise<PlayerStats[]> {
  const rows = patches?.length
    ? await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0 THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0 END AS "avgDpm",
          MAX(s."syncedAt") AS "syncedAt",
          MAX(pe.elo) AS elo
        FROM player_stats_cache pc
        JOIN player_sync_times s ON s.puuid = pc.puuid
        LEFT JOIN player_elo pe ON pe.puuid = pc.puuid AND pe."queueId" = ${queueId}
        WHERE pc."queueId" = ${queueId} AND pc."gameVersion" = ANY(${patches}) AND pc.puuid != ''
        GROUP BY pc.puuid ORDER BY games DESC
      `
    : await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0 THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0 END AS "avgDpm",
          MAX(s."syncedAt") AS "syncedAt",
          MAX(pe.elo) AS elo
        FROM player_stats_cache pc
        JOIN player_sync_times s ON s.puuid = pc.puuid
        LEFT JOIN player_elo pe ON pe.puuid = pc.puuid AND pe."queueId" = ${queueId}
        WHERE pc."queueId" = ${queueId} AND pc.puuid != ''
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
    elo: r.elo != null ? parseFloat(r.elo) : null,
  }))
}

export async function getOnePlayerStats(puuid: string, patches?: string[], queueId = 2400): Promise<PlayerStats | null> {
  const rows = patches?.length
    ? await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0
            THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
          END AS "avgDpm",
          COALESCE(MAX(pst."syncedAt"), 0) AS "syncedAt",
          MAX(pe.elo) AS elo
        FROM player_stats_cache pc
        LEFT JOIN player_sync_times pst ON pst.puuid = pc.puuid
        LEFT JOIN player_elo pe ON pe.puuid = pc.puuid AND pe."queueId" = ${queueId}
        WHERE pc.puuid = ${puuid} AND pc."queueId" = ${queueId} AND pc."gameVersion" = ANY(${patches})
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
          COALESCE(MAX(pst."syncedAt"), 0) AS "syncedAt",
          MAX(pe.elo) AS elo
        FROM player_stats_cache pc
        LEFT JOIN player_sync_times pst ON pst.puuid = pc.puuid
        LEFT JOIN player_elo pe ON pe.puuid = pc.puuid AND pe."queueId" = ${queueId}
        WHERE pc.puuid = ${puuid} AND pc."queueId" = ${queueId}
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
    elo: r.elo != null ? parseFloat(r.elo) : null,
  }
}

export async function getBulkPlayerStats(
  puuids: string[],
  patches?: string[],
  queueId = 2400
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
          END AS "avgDpm",
          MAX(pe.elo) AS elo
        FROM player_stats_cache pc
        LEFT JOIN player_elo pe ON pe.puuid = pc.puuid AND pe."queueId" = ${queueId}
        WHERE pc.puuid = ANY(${puuids}) AND pc."queueId" = ${queueId} AND pc."gameVersion" = ANY(${patches})
        GROUP BY pc.puuid`
    : await sql_`
        SELECT pc.puuid,
          MAX(pc."summonerName") AS "summonerName",
          SUM(pc.games)::int AS games, SUM(pc.wins)::int AS wins,
          SUM(pc.total_kills)::int AS kills, SUM(pc.total_deaths)::int AS deaths, SUM(pc.total_assists)::int AS assists,
          CASE WHEN SUM(pc.total_duration) > 0
            THEN SUM(pc.total_damage)::float / (SUM(pc.total_duration) / 60.0) ELSE 0
          END AS "avgDpm",
          MAX(pe.elo) AS elo
        FROM player_stats_cache pc
        LEFT JOIN player_elo pe ON pe.puuid = pc.puuid AND pe."queueId" = ${queueId}
        WHERE pc.puuid = ANY(${puuids}) AND pc."queueId" = ${queueId}
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
      elo: r.elo != null ? parseFloat(r.elo) : null,
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
  wilsonScore: number
}

export async function getChampionStats(puuid?: string, patches?: string[], queueId = 2400): Promise<ChampionStats[]> {
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
      WHERE pc.puuid = ${puuid} AND pc."queueId" = ${queueId} AND pc."gameVersion" = ANY(${patches})
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
      WHERE pc.puuid = ${puuid} AND pc."queueId" = ${queueId}
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
       FROM champion_stats_cache WHERE "queueId" = $1 AND "gameVersion" = ANY($2)
       GROUP BY "championId", "championName" ORDER BY games DESC`,
      [queueId, patches]
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
      WHERE "queueId" = ${queueId}
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
    avgDpm: parseFloat(r.avgDpm),
    wilsonScore: wilsonScore(r.wins, r.games)
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
  wilsonScore: number
}

export async function getAugmentStats(puuid?: string, championId?: number, patches?: string[], augmentCache: Record<number, { name: string; rarity: number; iconPath: string }> = {}, queueId = 2400): Promise<AugmentStats[]> {
  let rows: any[]

  if (!puuid && !championId) {
    // Fast path: read from pre-aggregated summary table
    if (patches?.length) {
      rows = await sql_.unsafe(
        `SELECT "augmentId",
          SUM(pick_count)::int AS "pickCount", SUM(wins)::int AS wins,
          CASE WHEN SUM(total_duration) > 0 THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0) ELSE 0 END AS "avgDpm"
         FROM augment_stats_cache WHERE "queueId" = $1 AND "gameVersion" = ANY($2)
         GROUP BY "augmentId" ORDER BY "pickCount" DESC`,
        [queueId, patches]
      )
    } else {
      rows = await sql_`
        SELECT "augmentId",
          SUM(pick_count)::int AS "pickCount", SUM(wins)::int AS wins,
          CASE WHEN SUM(total_duration) > 0 THEN SUM(total_damage)::float / (SUM(total_duration) / 60.0) ELSE 0 END AS "avgDpm"
        FROM augment_stats_cache
        WHERE "queueId" = ${queueId}
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
          WHERE acc."championId" = ${championId} AND acc."queueId" = ${queueId} AND acc."gameVersion" = ANY(${patches})
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
          WHERE acc."championId" = ${championId} AND acc."queueId" = ${queueId}
          GROUP BY acc."augmentId"
          ORDER BY "pickCount" DESC
        `
  } else {
    // puuid set (with or without championId) — raw join fallback
    const conditions: string[] = []
    const params: any[] = []
    if (puuid)           { params.push(puuid);      conditions.push(`p.puuid = $${params.length}`) }
    if (championId)      { params.push(championId); conditions.push(`p."championId" = $${params.length}`) }
    if (patches?.length) { params.push(patches);    conditions.push(`p."gameVersion" = ANY($${params.length})`) }
    params.push(queueId); conditions.push(`m."queueId" = $${params.length}`)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    rows = await sql_.unsafe(`
      SELECT pa."augmentId",
        COUNT(*)::int AS "pickCount",
        SUM(p.win::int)::int AS wins,
        CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm"
      FROM participants p
      JOIN participant_augments pa ON pa."participantId" = p.id
      JOIN matches m ON m."gameId" = p."gameId"
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
      avgDpm: parseFloat(r.avgDpm),
      wilsonScore: wilsonScore(r.wins, r.pickCount)
    }
  })
}

export interface ChampionMeta {
  name: string
  tags: string[]
}

export interface PlayerPerformance {
  championPickQuality: number
  augmentPickQuality: number
  kpDelta: number
  dpmDelta: number
  gpmDelta: number
  poolUniqueChampions: number
  poolTop3Concentration: number
  poolTopChampions: { championId: number; championName: string; games: number; share: number }[]
  classBuckets: { class: string; games: number; wins: number; winRate: number }[]
}

export async function getPlayerPerformance(
  puuid: string,
  championMap: Record<number, ChampionMeta>,
  patches?: string[],
  queueId = 2400
): Promise<PlayerPerformance> {
  const empty: PlayerPerformance = {
    championPickQuality: 0, augmentPickQuality: 0,
    kpDelta: 0, dpmDelta: 0, gpmDelta: 0,
    poolUniqueChampions: 0, poolTop3Concentration: 0,
    poolTopChampions: [], classBuckets: []
  }

  // Query 1a: player champion stats (pool depth, DPM, pick quality numerator)
  const playerChampRows: any[] = patches?.length
    ? await sql_.unsafe(
        `SELECT "championId","championName",
          SUM(games)::int AS games, SUM(wins)::int AS wins,
          SUM(total_damage)::bigint AS total_damage,
          SUM(total_duration)::bigint AS total_duration
         FROM player_champion_stats_cache
         WHERE puuid=$1 AND "queueId"=$2 AND "gameVersion"=ANY($3)
         GROUP BY "championId","championName" ORDER BY games DESC`,
        [puuid, queueId, patches]
      )
    : await sql_`
        SELECT "championId","championName",
          SUM(games)::int AS games, SUM(wins)::int AS wins,
          SUM(total_damage)::bigint AS total_damage,
          SUM(total_duration)::bigint AS total_duration
        FROM player_champion_stats_cache
        WHERE puuid=${puuid} AND "queueId"=${queueId}
        GROUP BY "championId","championName" ORDER BY games DESC
      `

  if (playerChampRows.length === 0) return empty

  const playerChampIds = playerChampRows.map((r: any) => r.championId as number)

  // Query 1b: global champion baselines
  const globalChampRows: any[] = patches?.length
    ? await sql_.unsafe(
        `SELECT "championId",
          SUM(games)::int AS games, SUM(wins)::int AS wins,
          SUM(total_damage)::bigint AS total_damage,
          SUM(total_duration)::bigint AS total_duration,
          SUM(total_team_kills)::bigint AS total_team_kills,
          SUM(total_gold)::bigint AS total_gold,
          (SUM(total_kills)+SUM(total_assists))::bigint AS total_kp_num
         FROM champion_stats_cache
         WHERE "queueId"=$1 AND "gameVersion"=ANY($2) AND "championId"=ANY($3)
         GROUP BY "championId"`,
        [queueId, patches, playerChampIds]
      )
    : await sql_`
        SELECT "championId",
          SUM(games)::int AS games, SUM(wins)::int AS wins,
          SUM(total_damage)::bigint AS total_damage,
          SUM(total_duration)::bigint AS total_duration,
          SUM(total_team_kills)::bigint AS total_team_kills,
          SUM(total_gold)::bigint AS total_gold,
          (SUM(total_kills)+SUM(total_assists))::bigint AS total_kp_num
        FROM champion_stats_cache
        WHERE "queueId"=${queueId} AND "championId"=ANY(${playerChampIds})
        GROUP BY "championId"
      `

  const globalChampMap = new Map<number, any>(
    globalChampRows.map((r: any) => [r.championId as number, r])
  )

  // Query 1c: global augment WRs
  const globalAugRows: any[] = patches?.length
    ? await sql_.unsafe(
        `SELECT "augmentId", SUM(pick_count)::int AS pick_count, SUM(wins)::int AS wins
         FROM augment_stats_cache WHERE "queueId"=$1 AND "gameVersion"=ANY($2)
         GROUP BY "augmentId"`,
        [queueId, patches]
      )
    : await sql_`
        SELECT "augmentId", SUM(pick_count)::int AS pick_count, SUM(wins)::int AS wins
        FROM augment_stats_cache WHERE "queueId"=${queueId} GROUP BY "augmentId"
      `

  const globalAugWR = new Map<number, number>()
  let totalAugWR = 0, totalAugCount = 0
  for (const r of globalAugRows) {
    if (r.pick_count > 0) {
      const wr = r.wins / r.pick_count
      globalAugWR.set(r.augmentId as number, wr)
      totalAugWR += wr; totalAugCount++
    }
  }
  const avgAugWR = totalAugCount > 0 ? totalAugWR / totalAugCount : 0.5

  // Query 1d: player augment picks
  const playerAugRows: any[] = patches?.length
    ? await sql_.unsafe(
        `SELECT pa."augmentId", COUNT(*)::int AS pick_count
         FROM participants p
         JOIN participant_augments pa ON pa."participantId"=p.id
         JOIN matches m ON m."gameId"=p."gameId"
         WHERE p.puuid=$1 AND m."queueId"=$2 AND p."gameVersion"=ANY($3)
         GROUP BY pa."augmentId"`,
        [puuid, queueId, patches]
      )
    : await sql_`
        SELECT pa."augmentId", COUNT(*)::int AS pick_count
        FROM participants p
        JOIN participant_augments pa ON pa."participantId"=p.id
        JOIN matches m ON m."gameId"=p."gameId"
        WHERE p.puuid=${puuid} AND m."queueId"=${queueId}
        GROUP BY pa."augmentId"
      `

  // Query 2: raw KP%/GPM per champion for this player
  const rawRows: any[] = patches?.length
    ? await sql_.unsafe(
        `SELECT p."championId",
          SUM(p.kills+p.assists)::int AS kp_num,
          SUM(tk.team_kills)::bigint  AS kp_den,
          SUM(p."goldEarned")::bigint AS total_gold,
          SUM(p."gameDuration")::bigint AS total_duration
         FROM participants p
         JOIN (
           SELECT "gameId","teamId",SUM(kills)::int AS team_kills
           FROM participants GROUP BY "gameId","teamId"
         ) tk ON p."gameId"=tk."gameId" AND p."teamId"=tk."teamId"
         JOIN matches m ON p."gameId"=m."gameId"
         WHERE p.puuid=$1 AND m."queueId"=$2 AND p."gameVersion"=ANY($3)
         GROUP BY p."championId"`,
        [puuid, queueId, patches]
      )
    : await sql_`
        SELECT p."championId",
          SUM(p.kills+p.assists)::int AS kp_num,
          SUM(tk.team_kills)::bigint  AS kp_den,
          SUM(p."goldEarned")::bigint AS total_gold,
          SUM(p."gameDuration")::bigint AS total_duration
        FROM participants p
        JOIN (
          SELECT "gameId","teamId",SUM(kills)::int AS team_kills
          FROM participants GROUP BY "gameId","teamId"
        ) tk ON p."gameId"=tk."gameId" AND p."teamId"=tk."teamId"
        JOIN matches m ON p."gameId"=m."gameId"
        WHERE p.puuid=${puuid} AND m."queueId"=${queueId}
        GROUP BY p."championId"
      `

  // ─── Compute metrics ──────────────────────────────────────────────────────

  // Champion pick quality: weighted avg global WR of picks, delta from 0.5
  let cpqWR = 0, cpqGames = 0
  for (const pc of playerChampRows) {
    const g = globalChampMap.get(pc.championId)
    if (!g || g.games === 0) continue
    cpqWR += pc.games * (g.wins / g.games); cpqGames += pc.games
  }
  const championPickQuality = cpqGames > 0 ? cpqWR / cpqGames - 0.5 : 0

  // Augment pick quality: weighted avg global WR of player's picks, delta from avgAugWR
  let apqWR = 0, apqTotal = 0
  for (const pa of playerAugRows) {
    const gwr = globalAugWR.get(pa.augmentId) ?? avgAugWR
    apqWR += gwr * pa.pick_count; apqTotal += pa.pick_count
  }
  const augmentPickQuality = apqTotal > 0 ? apqWR / apqTotal - avgAugWR : 0

  // DPM delta
  let playerDmg = 0, playerDurSec = 0, expDmgMin = 0, expDurMin = 0
  for (const pc of playerChampRows) {
    playerDmg += Number(pc.total_damage); playerDurSec += Number(pc.total_duration)
    const g = globalChampMap.get(pc.championId)
    if (g && Number(g.total_duration) > 0) {
      const gDPM = Number(g.total_damage) / (Number(g.total_duration) / 60)
      const durMin = Number(pc.total_duration) / 60
      expDmgMin += gDPM * durMin; expDurMin += durMin
    }
  }
  const playerDPM = playerDurSec > 0 ? playerDmg / (playerDurSec / 60) : 0
  const expectedDPM = expDurMin > 0 ? expDmgMin / expDurMin : 0
  const dpmDelta = playerDPM - expectedDPM

  // KP% and GPM deltas (from raw query 2)
  let pKPNum = 0, pKPDen = 0, eKPNum = 0, eKPDen = 0
  let pGold = 0, pGoldDurSec = 0, eGoldMin = 0, eGoldDurMin = 0
  for (const rr of rawRows) {
    const kpn = Number(rr.kp_num), kpd = Number(rr.kp_den)
    const gold = Number(rr.total_gold), dur = Number(rr.total_duration)
    pKPNum += kpn; pKPDen += kpd
    pGold += gold; pGoldDurSec += dur
    const g = globalChampMap.get(rr.championId)
    if (g && Number(g.total_team_kills) > 0) {
      const gKP = Number(g.total_kp_num) / Number(g.total_team_kills)
      eKPNum += gKP * kpd; eKPDen += kpd
    }
    if (g && Number(g.total_duration) > 0) {
      const gGPM = Number(g.total_gold) / (Number(g.total_duration) / 60)
      const durMin = dur / 60
      eGoldMin += gGPM * durMin; eGoldDurMin += durMin
    }
  }
  const kpDelta = (pKPDen > 0 ? pKPNum / pKPDen : 0) - (eKPDen > 0 ? eKPNum / eKPDen : 0)
  const gpmDelta = (pGoldDurSec > 0 ? pGold / (pGoldDurSec / 60) : 0)
                - (eGoldDurMin > 0 ? eGoldMin / eGoldDurMin : 0)

  // Pool depth
  const totalGames = playerChampRows.reduce((s: number, r: any) => s + r.games, 0)
  const top3Games = playerChampRows.slice(0, 3).reduce((s: number, r: any) => s + r.games, 0)

  // Class buckets (in-process, no DB query)
  const bucketMap = new Map<string, { games: number; wins: number }>()
  for (const pc of playerChampRows) {
    const role = championMap[pc.championId]?.tags?.[0]
    if (!role) continue
    const b = bucketMap.get(role) ?? { games: 0, wins: 0 }
    b.games += pc.games; b.wins += pc.wins
    bucketMap.set(role, b)
  }

  return {
    championPickQuality,
    augmentPickQuality,
    kpDelta,
    dpmDelta,
    gpmDelta,
    poolUniqueChampions: playerChampRows.length,
    poolTop3Concentration: totalGames > 0 ? top3Games / totalGames : 0,
    poolTopChampions: playerChampRows.slice(0, 5).map((r: any) => ({
      championId: r.championId as number,
      championName: r.championName as string,
      games: r.games as number,
      share: totalGames > 0 ? r.games / totalGames : 0
    })),
    classBuckets: [...bucketMap.entries()]
      .map(([cls, b]) => ({ class: cls, games: b.games, wins: b.wins, winRate: b.games > 0 ? b.wins / b.games : 0 }))
      .sort((a, b) => b.games - a.games)
  }
}

export interface AugmentChampionStat {
  championId: number
  championName: string
  games: number
  wins: number
  avgDpm: number
  wilsonScore: number
}

export async function getAugmentChampionStats(augmentId: number, puuid?: string, patches?: string[], queueId = 2400): Promise<AugmentChampionStat[]> {
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
          WHERE acc."augmentId" = ${augmentId} AND acc."queueId" = ${queueId} AND acc."gameVersion" = ANY(${patches})
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
          WHERE acc."augmentId" = ${augmentId} AND acc."queueId" = ${queueId}
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
    wilsonScore: wilsonScore(r.wins, r.games),
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

export async function getItemBuilds(championId: number, patches?: string[], allowedIds: number[] = [], queueId = 2400): Promise<ItemBuild[]> {
  const allowed = allowedIds.length > 0 ? allowedIds : [-1]
  const rows = patches?.length
    ? await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId}
          AND "queueId" = ${queueId}
          AND "gameVersion" = ANY(${patches})
          AND build <@ ${allowed}::int[]
        GROUP BY build ORDER BY games DESC LIMIT 50
      `
    : await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId}
          AND "queueId" = ${queueId}
          AND "gameVersion" IS NOT NULL
          AND build <@ ${allowed}::int[]
        GROUP BY build ORDER BY games DESC LIMIT 50
      `
  return rows.map((r: any) => ({ build: r.build as number[], games: r.games, wins: r.wins }))
}


export interface ItemPickRatesResult {
  totalGames: number
  items: ItemPickRate[]
}

export async function getItemPickRates(championId: number, patches?: string[], queueId = 2400): Promise<ItemPickRatesResult> {
  const [itemRows, countRows] = await Promise.all([
    patches?.length
      ? sql_`
          SELECT ipc."itemId", m.name, m."iconPath", m.category,
                 SUM(ipc.picks)::int AS picks,
                 SUM(ipc.wins)::int  AS wins
          FROM item_picks_cache ipc
          JOIN meta_items m ON m.id = ipc."itemId"
            AND m.is_component = false
            AND m.name IS NOT NULL
            AND m.name != ''
          WHERE ipc."championId" = ${championId}
            AND ipc."queueId" = ${queueId}
            AND ipc."gameVersion" = ANY(${patches})
          GROUP BY ipc."itemId", m.name, m."iconPath", m.category
          ORDER BY CASE WHEN m.category = 'Boots' THEN 0 ELSE 1 END, picks DESC
        `
      : sql_`
          SELECT ipc."itemId", m.name, m."iconPath", m.category,
                 SUM(ipc.picks)::int AS picks,
                 SUM(ipc.wins)::int  AS wins
          FROM item_picks_cache ipc
          JOIN meta_items m ON m.id = ipc."itemId"
            AND m.is_component = false
            AND m.name IS NOT NULL
            AND m.name != ''
          WHERE ipc."championId" = ${championId}
            AND ipc."queueId" = ${queueId}
          GROUP BY ipc."itemId", m.name, m."iconPath", m.category
          ORDER BY CASE WHEN m.category = 'Boots' THEN 0 ELSE 1 END, picks DESC
        `,
    patches?.length
      ? sql_`
          SELECT COALESCE(SUM(games), 0)::int AS total
          FROM champion_stats_cache
          WHERE "championId" = ${championId}
            AND "queueId" = ${queueId}
            AND "gameVersion" = ANY(${patches})
        `
      : sql_`
          SELECT COALESCE(SUM(games), 0)::int AS total
          FROM champion_stats_cache
          WHERE "championId" = ${championId}
            AND "queueId" = ${queueId}
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
    items: (itemRows as any[]).map(toRow),
  }
}

export interface MatchView {
  gameId: number
  gameCreation: number
  gameDuration: number
  participants: (Participant & { teamId: number })[]
}

export async function getRecentMatches(limit = 20, puuid?: string, patches?: string[], queueId = 2400): Promise<MatchView[]> {
  let matchRows: any[]
  if (puuid && patches?.length) {
    matchRows = await sql_`
      SELECT DISTINCT m."gameId", m."gameCreation", m."gameDuration"
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p.puuid = ${puuid} AND p."gameVersion" = ANY(${patches}) AND m."queueId" = ${queueId}
      ORDER BY m."gameCreation" DESC LIMIT ${limit}
    `
  } else if (puuid) {
    matchRows = await sql_`
      SELECT DISTINCT m."gameId", m."gameCreation", m."gameDuration"
      FROM participants p
      JOIN matches m ON m."gameId" = p."gameId"
      WHERE p.puuid = ${puuid} AND m."queueId" = ${queueId}
      ORDER BY m."gameCreation" DESC LIMIT ${limit}
    `
  } else {
    const params: any[] = []
    const conditions: string[] = [`m."queueId" = $${params.push(queueId)}`]
    if (patches?.length) { params.push(patches); conditions.push(`m."gameVersion" = ANY($${params.length})`) }
    const where = `WHERE ${conditions.join(' AND ')}`
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
  patches?: string[],
  queueId = 2400
): Promise<any[]> {
  const patchesKey = `v${ARCHETYPE_CACHE_VERSION}:q${queueId}:${(patches ?? []).slice().sort().join(',')}`
  const inflightKey = `${championId}:${queueId}:${patchesKey}`
  if (inflightArchetypes.has(inflightKey)) return inflightArchetypes.get(inflightKey)!

  const cached = await sql_`
    SELECT archetypes, computed_at FROM item_archetypes_cache
    WHERE "championId" = ${championId} AND patches_key = ${patchesKey}
  `
  if (cached.length > 0) {
    const ageMs = Date.now() - new Date((cached[0] as any).computed_at).getTime()
    if (ageMs >= 15 * 60 * 1000 && !inflightArchetypes.has(inflightKey)) {
      const p = _computeArchetypes(championId, patchesKey, patches, queueId)
      inflightArchetypes.set(inflightKey, p)
      p.finally(() => inflightArchetypes.delete(inflightKey))
    }
    const val = (cached[0] as any).archetypes
    return (Array.isArray(val) ? val : JSON.parse(val as string)) as any[]
  }

  const promise = _computeArchetypes(championId, patchesKey, patches, queueId)
  inflightArchetypes.set(inflightKey, promise)
  promise.finally(() => inflightArchetypes.delete(inflightKey))
  return promise
}

async function _computeArchetypes(
  championId: number,
  patchesKey: string,
  patches?: string[],
  queueId = 2400
): Promise<any[]> {
  console.log(`[db] computing archetypes for champion ${championId}...`)

  const buildRows = patches?.length
    ? await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId} AND "queueId" = ${queueId} AND "gameVersion" = ANY(${patches})
        GROUP BY build ORDER BY games DESC
      `
    : await sql_`
        SELECT build, SUM(games)::int AS games, SUM(wins)::int AS wins
        FROM item_builds_cache
        WHERE "championId" = ${championId} AND "queueId" = ${queueId}
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
        SELECT "itemId", SUM(slot_emptiness_sum) / NULLIF(SUM(slot_emptiness_count), 0) AS ratio
        FROM item_picks_cache
        WHERE "championId" = ${championId} AND "queueId" = ${queueId} AND "gameVersion" = ANY(${patches})
        GROUP BY "itemId"
      `
    : await sql_`
        SELECT "itemId", SUM(slot_emptiness_sum) / NULLIF(SUM(slot_emptiness_count), 0) AS ratio
        FROM item_picks_cache
        WHERE "championId" = ${championId} AND "queueId" = ${queueId}
        GROUP BY "itemId"
      `
  const noItemRatios = new Map<number, number>(
    (noItemRatioRows as any[]).map(r => [r.itemId as number, parseFloat(r.ratio)])
  )

  const { clusterByCooccurrence } = await import('./itemArchetypes')
  const archetypes = clusterByCooccurrence(enriched, componentIds, noItemRatios)
  console.log(`[db] archetype candidates for ${championId}: enriched=${enriched.length} clusters=${archetypes.length}`)

  // item_builds_cache is C(n,5) inflated — query participant_item_sets directly for accurate counts.
  const corrected = await Promise.all(archetypes.map(async (arch) => {
    const allCoreIds = [arch.openingId, ...arch.coreIds]
    const sortedQuad = [...allCoreIds].sort((a, b) => a - b)
    const combinedRows = patches?.length
      ? await sql_`
          WITH base AS MATERIALIZED (
            SELECT p.id, p.win
            FROM participant_item_sets pis
            JOIN participants p ON p.id = pis."participantId"
            JOIN matches m ON m."gameId" = p."gameId"
            WHERE pis."itemIds" @> ${sortedQuad}::int[]
              AND p."championId" = ${championId}
              AND p."gameVersion" = ANY(${patches})
              AND m."queueId" = ${queueId}
          )
          SELECT
            (SELECT COUNT(*)::int      FROM base) AS games,
            (SELECT SUM(win::int)::int FROM base) AS wins,
            pi."itemId",
            AVG(pi."slot"::float) AS avg_slot
          FROM base b
          LEFT JOIN participant_items pi ON pi."participantId" = b.id
            AND pi."itemId" = ANY(${sortedQuad}::int[])
            AND pi."slot" IS NOT NULL
          GROUP BY pi."itemId"
        `
      : await sql_`
          WITH base AS MATERIALIZED (
            SELECT p.id, p.win
            FROM participant_item_sets pis
            JOIN participants p ON p.id = pis."participantId"
            JOIN matches m ON m."gameId" = p."gameId"
            WHERE pis."itemIds" @> ${sortedQuad}::int[]
              AND p."championId" = ${championId}
              AND m."queueId" = ${queueId}
          )
          SELECT
            (SELECT COUNT(*)::int      FROM base) AS games,
            (SELECT SUM(win::int)::int FROM base) AS wins,
            pi."itemId",
            AVG(pi."slot"::float) AS avg_slot
          FROM base b
          LEFT JOIN participant_items pi ON pi."participantId" = b.id
            AND pi."itemId" = ANY(${sortedQuad}::int[])
            AND pi."slot" IS NOT NULL
          GROUP BY pi."itemId"
        `
    const row = {
      games: (combinedRows[0]?.games ?? 0) as number,
      wins: (combinedRows[0]?.wins ?? 0) as number,
    }
    const slotMap = new Map<number, number>(
      (combinedRows as any[]).filter(r => r.itemId != null).map(r => [r.itemId as number, parseFloat(r.avg_slot)])
    )

    let orderedIds = allCoreIds
    if (slotMap.size > 0) {
      orderedIds = [...allCoreIds].sort((a, b) => (slotMap.get(a) ?? 99) - (slotMap.get(b) ?? 99))
    }

    return {
      ...arch,
      games: row.games > 0 ? row.games : arch.games,
      wins: row.wins > 0 ? row.wins : arch.wins,
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

// ─── Elo rating ───────────────────────────────────────────────────────────────

const ELO_K = 128
const ELO_DEFAULT = 1500

export async function updateElo(
  queueId = 2400,
  opts?: { pageSize?: number; startWatermark?: number; freshInsert?: boolean }
): Promise<number> {
  let watermark: number
  if (opts?.startWatermark != null) {
    watermark = opts.startWatermark
  } else {
    const watermarkRows = await sql_`
      SELECT COALESCE(MIN(last_processed_game_creation), 0)::bigint AS watermark
      FROM player_elo WHERE "queueId" = ${queueId}
    `
    watermark = Number((watermarkRows[0] as any).watermark)
  }

  let matchRows: any[]
  if (opts?.pageSize != null) {
    const gameIdRows = await sql_`
      SELECT "gameId" FROM matches
      WHERE "queueId" = ${queueId} AND "gameCreation" > ${watermark}
      ORDER BY "gameCreation" ASC, "gameId" ASC
      LIMIT ${opts.pageSize}
    `
    if ((gameIdRows as any[]).length === 0) return 0
    const gameIds = (gameIdRows as any[]).map(r => Number(r.gameId))
    matchRows = await sql_`
      SELECT m."gameId", m."gameCreation", p.puuid, p."teamId", p.win
      FROM matches m
      JOIN participants p ON p."gameId" = m."gameId"
      WHERE m."gameId" = ANY(${gameIds}::bigint[])
      ORDER BY m."gameCreation" ASC, m."gameId" ASC
    `
  } else {
    matchRows = await sql_`
      SELECT m."gameId", m."gameCreation", p.puuid, p."teamId", p.win
      FROM matches m
      JOIN participants p ON p."gameId" = m."gameId"
      WHERE m."queueId" = ${queueId} AND m."gameCreation" > ${watermark}
      ORDER BY m."gameCreation" ASC, m."gameId" ASC
    `
  }
  if ((matchRows as any[]).length === 0) return 0

  const eloRows = await sql_`SELECT puuid, elo FROM player_elo WHERE "queueId" = ${queueId}`
  const eloMap = new Map<string, number>()
  for (const r of eloRows as any[]) eloMap.set(r.puuid as string, parseFloat(r.elo))

  // Group by gameId
  type TeamEntry = { puuid: string; win: boolean }
  const gameMap = new Map<number, { gameCreation: number; teams: Record<number, TeamEntry[]> }>()
  for (const row of matchRows as any[]) {
    const gid = Number(row.gameId)
    if (!gameMap.has(gid)) gameMap.set(gid, { gameCreation: Number(row.gameCreation), teams: {} })
    const g = gameMap.get(gid)!
    const tid = row.teamId as number
    if (!g.teams[tid]) g.teams[tid] = []
    g.teams[tid].push({ puuid: row.puuid as string, win: row.win as boolean })
  }

  const histPuuids: string[] = []
  const histGameIds: number[] = []
  const histQueueIds: number[] = []
  const histEloBefores: number[] = []
  const histEloAfters: number[] = []
  const histDeltas: number[] = []
  const histGCs: number[] = []
  const gamesRated = new Map<string, number>()
  let maxGC = watermark

  const sorted = [...gameMap.entries()].sort((a, b) => a[1].gameCreation - b[1].gameCreation)

  for (const [gameId, { gameCreation, teams }] of sorted) {
    const teamIds = Object.keys(teams).map(Number)
    if (teamIds.length < 2) continue
    const [tid1, tid2] = teamIds
    const team1 = teams[tid1]
    const team2 = teams[tid2]

    const avg1 = team1.reduce((s, p) => s + (eloMap.get(p.puuid) ?? ELO_DEFAULT), 0) / team1.length
    const avg2 = team2.reduce((s, p) => s + (eloMap.get(p.puuid) ?? ELO_DEFAULT), 0) / team2.length

    for (const { puuid, win } of [...team1, ...team2]) {
      const onTeam1 = team1.some(p => p.puuid === puuid)
      const opponentAvg = onTeam1 ? avg2 : avg1
      const before = eloMap.get(puuid) ?? ELO_DEFAULT
      const expected = 1 / (1 + Math.pow(10, (opponentAvg - before) / 400))
      const delta = ELO_K * ((win ? 1 : 0) - expected)
      const after = before + delta
      eloMap.set(puuid, after)
      gamesRated.set(puuid, (gamesRated.get(puuid) ?? 0) + 1)
      histPuuids.push(puuid)
      histGameIds.push(gameId)
      histQueueIds.push(queueId)
      histEloBefores.push(before)
      histEloAfters.push(after)
      histDeltas.push(delta)
      histGCs.push(gameCreation)
    }
    if (gameCreation > maxGC) maxGC = gameCreation
  }

  if (histPuuids.length === 0) return 0

  const CHUNK = 50_000
  const updatedPuuids = [...gamesRated.keys()]

  await sql_.begin(async sql => {
    for (let i = 0; i < histPuuids.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, histPuuids.length)
      await sql`
        INSERT INTO elo_history (puuid, "gameId", "queueId", elo_before, elo_after, delta, "gameCreation")
        SELECT * FROM UNNEST(
          ${histPuuids.slice(i, end)}::text[],
          ${histGameIds.slice(i, end)}::bigint[],
          ${histQueueIds.slice(i, end)}::int[],
          ${histEloBefores.slice(i, end)}::float8[],
          ${histEloAfters.slice(i, end)}::float8[],
          ${histDeltas.slice(i, end)}::float8[],
          ${histGCs.slice(i, end)}::bigint[]
        )
        ${opts?.freshInsert ? sql`` : sql`ON CONFLICT (puuid, "gameId", "queueId") DO NOTHING`}
      `
    }

    for (let i = 0; i < updatedPuuids.length; i += CHUNK) {
      const chunk = updatedPuuids.slice(i, i + CHUNK)
      await sql`
        INSERT INTO player_elo (puuid, "queueId", elo, games_rated, last_processed_game_creation, updated_at)
        SELECT * FROM UNNEST(
          ${chunk}::text[],
          ${Array(chunk.length).fill(queueId)}::int[],
          ${chunk.map(p => eloMap.get(p)!)}::float8[],
          ${chunk.map(p => gamesRated.get(p)!)}::int[],
          ${Array(chunk.length).fill(maxGC)}::bigint[],
          ${Array(chunk.length).fill(new Date().toISOString())}::timestamptz[]
        )
        ON CONFLICT (puuid, "queueId") DO UPDATE SET
          elo = EXCLUDED.elo,
          games_rated = player_elo.games_rated + EXCLUDED.games_rated,
          last_processed_game_creation = GREATEST(player_elo.last_processed_game_creation, EXCLUDED.last_processed_game_creation),
          updated_at = now()
      `
    }
  })

  return gameMap.size
}

export async function recomputeEloFull(queueId = 2400): Promise<number> {
  await sql_`DELETE FROM elo_history WHERE "queueId" = ${queueId}`
  await sql_`DELETE FROM player_elo  WHERE "queueId" = ${queueId}`
  await sql_`ALTER TABLE elo_history DROP CONSTRAINT IF EXISTS elo_history_pkey`
  await sql_`DROP INDEX IF EXISTS idx_elo_history_puuid_queue_gc`
  try {
    return await updateElo(queueId, { freshInsert: true })
  } finally {
    await sql_`ALTER TABLE elo_history ADD PRIMARY KEY (puuid, "gameId", "queueId")`
    await sql_`CREATE INDEX IF NOT EXISTS idx_elo_history_puuid_queue_gc ON elo_history (puuid, "queueId", "gameCreation")`
  }
}

export async function recomputePlayerElo(puuid: string, queueId = 2400): Promise<number> {
  const [{ oldest }] = await sql_`
    SELECT MIN(m."gameCreation") AS oldest
    FROM matches m
    JOIN participants p ON p."gameId" = m."gameId" AND p.puuid = ${puuid}
    LEFT JOIN elo_history eh ON eh."gameId" = m."gameId" AND eh.puuid = ${puuid} AND eh."queueId" = ${queueId}
    WHERE m."queueId" = ${queueId} AND eh."gameId" IS NULL
  `
  if (oldest == null) return 0

  const oldestGc = Number(oldest)

  const prior = await sql_`
    SELECT elo_after FROM elo_history
    WHERE puuid = ${puuid} AND "queueId" = ${queueId} AND "gameCreation" < ${oldestGc}
    ORDER BY "gameCreation" DESC, "gameId" DESC
    LIMIT 1
  `
  const startElo: number = prior.length > 0 ? parseFloat((prior[0] as any).elo_after) : ELO_DEFAULT

  const matchRows = await sql_`
    SELECT m."gameId", m."gameCreation", p2.puuid AS participant_puuid, p2."teamId", p2.win
    FROM matches m
    JOIN participants p ON p."gameId" = m."gameId" AND p.puuid = ${puuid}
    JOIN participants p2 ON p2."gameId" = m."gameId"
    WHERE m."queueId" = ${queueId} AND m."gameCreation" >= ${oldestGc}
    ORDER BY m."gameCreation" ASC, m."gameId" ASC
  `
  if ((matchRows as any[]).length === 0) return 0

  const allPuuids = [...new Set((matchRows as any[]).map(r => r.participant_puuid as string))]
  const eloRows = await sql_`
    SELECT puuid, elo FROM player_elo WHERE "queueId" = ${queueId} AND puuid = ANY(${allPuuids}::text[])
  `
  const eloMap = new Map<string, number>()
  for (const r of eloRows as any[]) eloMap.set(r.puuid as string, parseFloat(r.elo))
  eloMap.set(puuid, startElo)

  type TeamEntry = { puuid: string; win: boolean }
  const gameMap = new Map<number, { gameCreation: number; teams: Record<number, TeamEntry[]> }>()
  for (const row of matchRows as any[]) {
    const gid = Number(row.gameId)
    if (!gameMap.has(gid)) gameMap.set(gid, { gameCreation: Number(row.gameCreation), teams: {} })
    const g = gameMap.get(gid)!
    const tid = row.teamId as number
    if (!g.teams[tid]) g.teams[tid] = []
    g.teams[tid].push({ puuid: row.participant_puuid as string, win: row.win as boolean })
  }

  const sorted = [...gameMap.entries()].sort((a, b) => a[1].gameCreation - b[1].gameCreation)

  const histGameIds: number[] = []
  const histEloBefores: number[] = []
  const histEloAfters: number[] = []
  const histDeltas: number[] = []
  const histGCs: number[] = []
  let maxGC = oldestGc

  for (const [gameId, { gameCreation, teams }] of sorted) {
    const teamIds = Object.keys(teams).map(Number)
    if (teamIds.length < 2) continue

    let myTeamId: number | undefined
    let myWin: boolean | undefined
    for (const tid of teamIds) {
      const entry = teams[tid].find(e => e.puuid === puuid)
      if (entry) { myTeamId = tid; myWin = entry.win; break }
    }
    if (myTeamId === undefined || myWin === undefined) continue

    const oppTeamId = teamIds.find(t => t !== myTeamId)!
    const oppTeam = teams[oppTeamId]
    const before = eloMap.get(puuid) ?? ELO_DEFAULT
    const oppAvg = oppTeam.reduce((s, p) => s + (eloMap.get(p.puuid) ?? ELO_DEFAULT), 0) / oppTeam.length
    const expected = 1 / (1 + Math.pow(10, (oppAvg - before) / 400))
    const delta = ELO_K * ((myWin ? 1 : 0) - expected)
    const after = before + delta

    eloMap.set(puuid, after)
    histGameIds.push(gameId)
    histEloBefores.push(before)
    histEloAfters.push(after)
    histDeltas.push(delta)
    histGCs.push(gameCreation)
    if (gameCreation > maxGC) maxGC = gameCreation
  }

  if (histGameIds.length === 0) return 0

  await sql_.begin(async sql => {
    await sql`DELETE FROM elo_history WHERE puuid = ${puuid} AND "queueId" = ${queueId} AND "gameCreation" >= ${oldestGc}`

    await sql`
      INSERT INTO elo_history (puuid, "gameId", "queueId", elo_before, elo_after, delta, "gameCreation")
      SELECT * FROM UNNEST(
        ${Array(histGameIds.length).fill(puuid)}::text[],
        ${histGameIds}::bigint[],
        ${Array(histGameIds.length).fill(queueId)}::int[],
        ${histEloBefores}::float8[],
        ${histEloAfters}::float8[],
        ${histDeltas}::float8[],
        ${histGCs}::bigint[]
      )
      ON CONFLICT (puuid, "gameId", "queueId") DO UPDATE SET
        elo_before = EXCLUDED.elo_before,
        elo_after = EXCLUDED.elo_after,
        delta = EXCLUDED.delta
    `

    const [{ cnt }] = await sql`
      SELECT COUNT(*)::int AS cnt FROM elo_history
      WHERE puuid = ${puuid} AND "queueId" = ${queueId} AND "gameCreation" < ${oldestGc}
    `

    await sql`
      INSERT INTO player_elo (puuid, "queueId", elo, games_rated, last_processed_game_creation, updated_at)
      VALUES (${puuid}, ${queueId}, ${eloMap.get(puuid)!}, ${Number(cnt) + histGameIds.length}, ${maxGC}, now())
      ON CONFLICT (puuid, "queueId") DO UPDATE SET
        elo = EXCLUDED.elo,
        games_rated = EXCLUDED.games_rated,
        last_processed_game_creation = GREATEST(player_elo.last_processed_game_creation, EXCLUDED.last_processed_game_creation),
        updated_at = now()
    `
  })

  return histGameIds.length
}

export async function getEloLeaderboard(
  queueId = 2400,
  minGames = 10
): Promise<{ puuid: string; summonerName: string; elo: number; gamesRated: number; games: number; wins: number }[]> {
  const rows = await sql_`
    SELECT
      pe.puuid,
      pe.elo::float,
      pe.games_rated AS "gamesRated",
      MAX(psc."summonerName") AS "summonerName",
      SUM(psc.games)::int AS games,
      SUM(psc.wins)::int AS wins
    FROM player_elo pe
    JOIN player_stats_cache psc ON psc.puuid = pe.puuid AND psc."queueId" = pe."queueId"
    WHERE pe."queueId" = ${queueId} AND pe.games_rated >= ${minGames}
    GROUP BY pe.puuid, pe.elo, pe.games_rated
    ORDER BY pe.elo DESC
    LIMIT 200
  `
  return rows as any[]
}

export async function getEloHistory(
  puuid: string,
  queueId = 2400
): Promise<{ gameId: number; elo_before: number; elo_after: number; delta: number; gameCreation: number }[]> {
  const rows = await sql_`
    SELECT "gameId", elo_before::float, elo_after::float, delta::float, "gameCreation"
    FROM elo_history
    WHERE puuid = ${puuid} AND "queueId" = ${queueId}
    ORDER BY "gameCreation" ASC
  `
  return (rows as any[]).map(r => ({
    gameId: Number(r.gameId),
    elo_before: parseFloat(r.elo_before),
    elo_after: parseFloat(r.elo_after),
    delta: parseFloat(r.delta),
    gameCreation: Number(r.gameCreation),
  }))
}

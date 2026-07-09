import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
import postgres from 'postgres'

const SYNC_LEASE_MS = 5 * 60 * 1000

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

export async function initDb(url?: string): Promise<void> {
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
  await sql_`
    CREATE TABLE IF NOT EXISTS participant_augments (
      "participantId" INTEGER NOT NULL REFERENCES participants(id),
      "augmentId"     INTEGER NOT NULL
    )
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

  const [{ count: champCacheCount }] = await sql_`SELECT COUNT(*) FROM champion_stats_cache`
  if (Number(champCacheCount) === 0) {
    console.log('[db] backfilling summary caches...')
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
  { patch: '16.1',  startMs: new Date('2026-01-07T12:00:00Z').getTime() },
  { patch: '16.2',  startMs: new Date('2026-01-21T12:00:00Z').getTime() },
  { patch: '16.3',  startMs: new Date('2026-02-04T12:00:00Z').getTime() },
  { patch: '16.4',  startMs: new Date('2026-02-18T12:00:00Z').getTime() },
  { patch: '16.5',  startMs: new Date('2026-03-04T12:00:00Z').getTime() },
  { patch: '16.6',  startMs: new Date('2026-03-18T12:00:00Z').getTime() },
  { patch: '16.7',  startMs: new Date('2026-04-01T12:00:00Z').getTime() },
  { patch: '16.8',  startMs: new Date('2026-04-15T12:00:00Z').getTime() },
  { patch: '16.9',  startMs: new Date('2026-04-29T12:00:00Z').getTime() },
  { patch: '16.10', startMs: new Date('2026-05-13T12:00:00Z').getTime() },
  { patch: '16.11', startMs: new Date('2026-05-27T12:00:00Z').getTime() },
  { patch: '16.12', startMs: new Date('2026-06-10T12:00:00Z').getTime() },
  { patch: '16.13', startMs: new Date('2026-06-24T12:00:00Z').getTime() },
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
  }
}

export async function getIncompleteGameIds(): Promise<number[]> {
  const rows = await sql_`
    SELECT m."gameId"
    FROM matches m
    WHERE (SELECT COUNT(*) FROM participants p WHERE p."gameId" = m."gameId") < 10
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
}

export async function getPlayerStats(patches?: string[]): Promise<PlayerStats[]> {
  const rows = patches?.length
    ? await sql_`
        SELECT p.puuid,
          MAX(p."summonerName") AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold",
          true AS "syncedFull"
        FROM participants p
        JOIN player_sync_times s ON s.puuid = p.puuid
        WHERE p."gameVersion" = ANY(${patches})
        GROUP BY p.puuid ORDER BY games DESC
      `
    : await sql_`
        SELECT p.puuid,
          MAX(p."summonerName") AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold",
          true AS "syncedFull"
        FROM participants p
        JOIN player_sync_times s ON s.puuid = p.puuid
        GROUP BY p.puuid ORDER BY games DESC
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
    avgGold: parseFloat(r.avgGold),
    syncedFull: r.syncedFull
  }))
}

export async function getOnePlayerStats(puuid: string, patches?: string[]): Promise<PlayerStats | null> {
  const rows = patches?.length
    ? await sql_`
        SELECT
          ${puuid} AS puuid,
          (SELECT "summonerName" FROM participants p2 WHERE p2.puuid = ${puuid} ORDER BY p2.id DESC LIMIT 1) AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold",
          true AS "syncedFull"
        FROM participants p
        WHERE p.puuid = ${puuid} AND p."gameVersion" = ANY(${patches})
      `
    : await sql_`
        SELECT
          ${puuid} AS puuid,
          (SELECT "summonerName" FROM participants p2 WHERE p2.puuid = ${puuid} ORDER BY p2.id DESC LIMIT 1) AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold",
          true AS "syncedFull"
        FROM participants p
        WHERE p.puuid = ${puuid}
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
    avgGold: parseFloat(r.avgGold),
    syncedFull: true,
  }
}

export async function getBulkPlayerStats(
  puuids: string[],
  patches?: string[]
): Promise<Record<string, PlayerStats>> {
  if (!puuids.length) return {}
  const rows = patches?.length
    ? await sql_`
        SELECT p.puuid,
          MAX(p."summonerName") AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(p."gameDuration") > 0
            THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0
          END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold"
        FROM participants p
        WHERE p.puuid = ANY(${puuids}) AND p."gameVersion" = ANY(${patches})
        GROUP BY p.puuid`
    : await sql_`
        SELECT p.puuid,
          MAX(p."summonerName") AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(p."gameDuration") > 0
            THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0
          END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold"
        FROM participants p
        WHERE p.puuid = ANY(${puuids})
        GROUP BY p.puuid`
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
      avgGold: parseFloat(r.avgGold),
      syncedFull: true,
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
    rows = await sql_.unsafe(
      `SELECT p."championId", p."championName",
        COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
        SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
        CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
        p.puuid, p."summonerName"
       FROM participants p WHERE p.puuid = $1 AND p."gameVersion" = ANY($2)
       GROUP BY p."championId", p."championName", p.puuid, p."summonerName" ORDER BY games DESC`,
      [puuid, patches]
    )
  } else if (puuid) {
    rows = await sql_.unsafe(
      `SELECT p."championId", p."championName",
        COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
        SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
        CASE WHEN SUM(p."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
        p.puuid, p."summonerName"
       FROM participants p WHERE p.puuid = $1
       GROUP BY p."championId", p."championName", p.puuid, p."summonerName" ORDER BY games DESC`,
      [puuid]
    )
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
  } else {
    // Per-player or per-champion: fall back to participant-level join
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
  const conditions: string[] = [`pa."augmentId" = $1`]
  const params: any[] = [augmentId]
  if (puuid)           { params.push(puuid);   conditions.push(`p.puuid = $${params.length}`) }
  if (patches?.length) { params.push(patches); conditions.push(`p."gameVersion" = ANY($${params.length})`) }
  const where = `WHERE ${conditions.join(' AND ')}`

  const rows = await sql_.unsafe(`
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

  return rows.map((r: any) => ({
    championId: r.championId,
    championName: r.championName ?? `Champion ${r.championId}`,
    games: r.games,
    wins: r.wins,
    avgDpm: parseFloat(r.avgDpm),
  }))
}

export interface MatchView {
  gameId: number
  gameCreation: number
  gameDuration: number
  participants: (Participant & { teamId: number })[]
}

export async function getRecentMatches(limit = 20, puuid?: string, patches?: string[]): Promise<MatchView[]> {
  const conditions: string[] = []
  const params: any[] = []
  if (puuid)        { params.push(puuid);      conditions.push(`EXISTS (SELECT 1 FROM participants pp WHERE pp."gameId" = m."gameId" AND pp.puuid = $${params.length})`) }
  if (patches?.length) { params.push(patches); conditions.push(`m."gameVersion" = ANY($${params.length})`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const matchRows = await sql_.unsafe(`
    SELECT "gameId","gameCreation","gameDuration" FROM matches m
    ${where} ORDER BY "gameCreation" DESC LIMIT $${params.push(limit)}
  `, params)
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
      AVG(p.win::int)                     AS "avgWinRate",
      CASE WHEN SUM(p.deaths) > 0
        THEN SUM(p.kills + p.assists)::float / SUM(p.deaths)
        ELSE 0 END                        AS "avgKda",
      CASE WHEN SUM(p."gameDuration") > 0
        THEN SUM(p."damageDealt")::float / (SUM(p."gameDuration") / 60.0)
        ELSE 0 END                        AS "avgDpm"
    FROM participants p
  `
  const r = rows[0]
  return {
    totalMatches: r.totalMatches ?? 0,
    avgWinRate: parseFloat(r.avgWinRate ?? '0'),
    avgKda: parseFloat(r.avgKda ?? '0'),
    avgDpm: parseFloat(r.avgDpm ?? '0')
  }
}

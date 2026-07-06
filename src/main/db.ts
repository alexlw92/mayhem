import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
import postgres from 'postgres'


// ─── Types ───────────────────────────────────────────────────────────────────

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

export async function initDb(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  sql_ = postgres(url, { onnotice: () => {} })

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
      "champLevel"   INTEGER NOT NULL
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

  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_gameId     ON participants("gameId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_puuid      ON participants(puuid)`
  await sql_`CREATE INDEX IF NOT EXISTS idx_participants_championId ON participants("championId")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_matches_gameVersion     ON matches("gameVersion")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_matches_gameCreation    ON matches("gameCreation")`
  await sql_`CREATE INDEX IF NOT EXISTS idx_augments_participantId  ON participant_augments("participantId")`

}

// ─── Patch inference ──────────────────────────────────────────────────────────

// Patch date table: { patch, startMs } sorted ascending.
// For a game, find the last entry where startMs <= gameCreation.
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
  await sql_`DELETE FROM player_sync_times`
}

export async function matchExists(gameId: number): Promise<boolean> {
  const rows = await sql_`SELECT 1 FROM matches WHERE "gameId" = ${gameId} LIMIT 1`
  return rows.length > 0
}

export async function insertMatch(match: Match): Promise<void> {
  await sql_.begin(async (tx) => {
    const inserted = await tx`
      INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
      VALUES (${match.gameId},${match.queueId},${match.gameCreation},${match.gameDuration},${match.gameVersion ?? null})
      ON CONFLICT ("gameId") DO NOTHING
      RETURNING "gameId"
    `
    if (inserted.length === 0) return

    for (const p of match.participants) {
      const [row] = await tx`
        INSERT INTO participants
          ("gameId",puuid,"summonerName","championId","championName","teamId",
           win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel")
        VALUES
          (${match.gameId},${p.puuid},${p.summonerName},${p.championId},${p.championName},
           ${p.teamId},${p.win},${p.kills},${p.deaths},${p.assists},
           ${p.damageDealt},${p.damageTaken},${p.goldEarned},${p.champLevel})
        RETURNING id
      `
      for (const augId of p.augments) {
        if (!augId) continue
        await tx`INSERT INTO participant_augments ("participantId","augmentId") VALUES (${row.id},${augId})`
      }
    }
  })
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
    // Remove old participants and re-insert (simplest upsert for nested data)
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
           win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel")
        VALUES
          (${match.gameId},${p.puuid},${p.summonerName},${p.championId},${p.championName},
           ${p.teamId},${p.win},${p.kills},${p.deaths},${p.assists},
           ${p.damageDealt},${p.damageTaken},${p.goldEarned},${p.champLevel})
        RETURNING id
      `
      for (const augId of p.augments) {
        if (!augId) continue
        await tx`INSERT INTO participant_augments ("participantId","augmentId") VALUES (${row.id},${augId})`
      }
    }
  })
}

export async function getIncompleteGameIds(): Promise<number[]> {
  const rows = await sql_`
    SELECT m."gameId"
    FROM matches m
    WHERE (SELECT COUNT(*) FROM participants p WHERE p."gameId" = m."gameId") < 10
  `
  return rows.map((r: any) => r.gameId)
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

export async function getCoplayerPuuids(puuid: string): Promise<string[]> {
  const rows = await sql_`
    SELECT DISTINCT p2.puuid
    FROM participants p1
    JOIN participants p2 ON p1."gameId" = p2."gameId"
    WHERE p1.puuid = ${puuid} AND p2.puuid != ${puuid} AND p2.puuid != ''
  `
  return rows.map((r: any) => r.puuid)
}

export async function getPatches(): Promise<string[]> {
  const rows = await sql_`
    SELECT DISTINCT "gameVersion" FROM matches
    WHERE "gameVersion" IS NOT NULL
    ORDER BY "gameVersion" DESC
  `
  // Sort by major.minor numerically
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
          (SELECT "summonerName" FROM participants p2 WHERE p2.puuid = p.puuid ORDER BY p2.id DESC LIMIT 1) AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(m."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(m."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold",
          EXISTS(SELECT 1 FROM player_sync_times s WHERE s.puuid = p.puuid) AS "syncedFull"
        FROM participants p JOIN matches m ON p."gameId" = m."gameId"
        WHERE m."gameVersion" = ANY(${patches})
        GROUP BY p.puuid ORDER BY games DESC
      `
    : await sql_`
        SELECT p.puuid,
          (SELECT "summonerName" FROM participants p2 WHERE p2.puuid = p.puuid ORDER BY p2.id DESC LIMIT 1) AS "summonerName",
          COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
          SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
          CASE WHEN SUM(m."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(m."gameDuration") / 60.0) ELSE 0 END AS "avgDpm",
          AVG(p."goldEarned") AS "avgGold",
          EXISTS(SELECT 1 FROM player_sync_times s WHERE s.puuid = p.puuid) AS "syncedFull"
        FROM participants p JOIN matches m ON p."gameId" = m."gameId"
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
  const COLS = `p."championId", p."championName",
    COUNT(*)::int AS games, SUM(p.win::int)::int AS wins,
    SUM(p.kills)::int AS kills, SUM(p.deaths)::int AS deaths, SUM(p.assists)::int AS assists,
    CASE WHEN SUM(m."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(m."gameDuration") / 60.0) ELSE 0 END AS "avgDpm"`

  const rows = puuid && patches?.length
    ? await sql_.unsafe(`SELECT ${COLS}, p.puuid, p."summonerName" FROM participants p JOIN matches m ON p."gameId" = m."gameId" WHERE p.puuid = $1 AND m."gameVersion" = ANY($2) GROUP BY p."championId", p."championName", p.puuid, p."summonerName" ORDER BY games DESC`, [puuid, patches])
    : puuid
    ? await sql_.unsafe(`SELECT ${COLS}, p.puuid, p."summonerName" FROM participants p JOIN matches m ON p."gameId" = m."gameId" WHERE p.puuid = $1 GROUP BY p."championId", p."championName", p.puuid, p."summonerName" ORDER BY games DESC`, [puuid])
    : patches?.length
    ? await sql_.unsafe(`SELECT ${COLS}, ''::text AS puuid, ''::text AS "summonerName" FROM participants p JOIN matches m ON p."gameId" = m."gameId" WHERE m."gameVersion" = ANY($1) GROUP BY p."championId", p."championName" ORDER BY games DESC`, [patches])
    : await sql_.unsafe(`SELECT ${COLS}, ''::text AS puuid, ''::text AS "summonerName" FROM participants p JOIN matches m ON p."gameId" = m."gameId" GROUP BY p."championId", p."championName" ORDER BY games DESC`)
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

export async function getAugmentStats(puuid?: string, championId?: number, patches?: string[]): Promise<AugmentStats[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (puuid)        { params.push(puuid);      conditions.push(`p.puuid = $${params.length}`) }
  if (championId)   { params.push(championId); conditions.push(`p."championId" = $${params.length}`) }
  if (patches?.length) { params.push(patches); conditions.push(`m."gameVersion" = ANY($${params.length})`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await sql_.unsafe(`
    SELECT pa."augmentId",
      COUNT(*)::int AS "pickCount",
      SUM(p.win::int)::int AS wins,
      CASE WHEN SUM(m."gameDuration") > 0 THEN SUM(p."damageDealt")::float / (SUM(m."gameDuration") / 60.0) ELSE 0 END AS "avgDpm"
    FROM participant_augments pa
    JOIN participants p ON pa."participantId" = p.id
    JOIN matches m ON p."gameId" = m."gameId"
    ${where}
    GROUP BY pa."augmentId"
    ORDER BY "pickCount" DESC
  `, params)

  const cache = getAugmentCache()
  return rows.map((r: any) => {
    const meta = cache[r.augmentId]
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

export interface MatchView {
  gameId: number
  gameCreation: number
  gameDuration: number
  participants: (Participant & { teamId: number })[]
}

export async function getRecentMatches(limit = 20, puuid?: string, patches?: string[]): Promise<MatchView[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (puuid)        { params.push(puuid);      conditions.push(`EXISTS (SELECT 1 FROM participants pp WHERE pp."gameId" = m."gameId" AND pp.puuid = $${params.length})`) }
  if (patches?.length) { params.push(patches); conditions.push(`m."gameVersion" = ANY($${params.length})`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const matchRows = await sql_.unsafe(`
    SELECT "gameId","gameCreation","gameDuration" FROM matches m
    ${where} ORDER BY "gameCreation" DESC LIMIT $${params.push(limit)}
  `, params)
  if (matchRows.length === 0) return []

  const gameIds = matchRows.map((r: any) => r.gameId)
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
    gameId: m.gameId,
    gameCreation: m.gameCreation,
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
      CASE WHEN SUM(m."gameDuration") > 0
        THEN SUM(p."damageDealt")::float / (SUM(m."gameDuration") / 60.0)
        ELSE 0 END                        AS "avgDpm"
    FROM participants p
    JOIN matches m ON p."gameId" = m."gameId"
  `
  const r = rows[0]
  return {
    totalMatches: r.totalMatches ?? 0,
    avgWinRate: parseFloat(r.avgWinRate ?? '0'),
    avgKda: parseFloat(r.avgKda ?? '0'),
    avgDpm: parseFloat(r.avgDpm ?? '0')
  }
}

// ─── Metadata cache (champions + augments) ───────────────────────────────────

export interface AugmentInfo {
  id: number
  name: string
  desc: string
  iconPath: string
  rarity: number
}

const META_VERSION = 2

interface MetaCache {
  champions: Record<number, string>
  augments: Record<number, AugmentInfo>
  fetchedAt: number
  version?: number
}

let metaCache: MetaCache | null = null

function metaPath(): string {
  return path.join(app.getPath('userData'), 'mayhem-meta.json')
}

function loadMeta(): MetaCache {
  if (metaCache) return metaCache
  try {
    metaCache = JSON.parse(fs.readFileSync(metaPath(), 'utf-8'))
  } catch {
    metaCache = { champions: {}, augments: {}, fetchedAt: 0 }
  }
  return metaCache!
}

function saveMeta(): void {
  fs.writeFileSync(metaPath(), JSON.stringify(metaCache), 'utf-8')
}

export function isMetaStale(maxAgeHours = 24): boolean {
  const m = loadMeta()
  if ((m.version ?? 0) < META_VERSION) return true
  return Date.now() - m.fetchedAt > maxAgeHours * 3_600_000
}

export function clearMetaCache(): void {
  metaCache = null
}

export function saveMetaCache(
  champions: Record<number, string>,
  augments: Record<number, AugmentInfo>
): void {
  metaCache = { champions, augments, fetchedAt: Date.now(), version: META_VERSION }
  saveMeta()
}

export function getChampionCache(): Record<number, string> {
  return loadMeta().champions
}

export function getAugmentCache(): Record<number, AugmentInfo> {
  return loadMeta().augments
}

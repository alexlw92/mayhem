import postgres from 'postgres'
import dotenv from 'dotenv'
import path from 'path'
import { execSync } from 'child_process'

dotenv.config({ path: path.resolve(__dirname, '../.env.dev') })

const VER = '99.0'
const TEST_GAME_IDS = [1001, 1002, 1003, 1004, 1005, 2001, 2002]
const NOW = Date.now()
const BACKEND_PORT = parseInt(process.env.PORT ?? '3847')

function killStaleBackend(): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano 2>nul | findstr ":${BACKEND_PORT} "`, { encoding: 'utf8' }).trim()
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue
        const pid = line.trim().split(/\s+/).pop()
        if (pid && /^\d+$/.test(pid)) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }) } catch { /* already gone */ }
        }
      }
    } else {
      execSync(`lsof -ti tcp:${BACKEND_PORT} | xargs -r kill -9`, { stdio: 'ignore' })
    }
  } catch { /* port was free or command unavailable */ }
}

export default async function globalSetup(): Promise<void> {
  killStaleBackend()

  const dbUrl = process.env.TEST_DATABASE_URL
  if (!dbUrl) throw new Error('TEST_DATABASE_URL not set in .env.dev')

  const sql = postgres(dbUrl)

  try {
    await sql.begin(async (tx) => {
      // Clean up test data from previous runs (FK-safe order)
      const parts = await tx`SELECT id FROM participants WHERE "gameId" = ANY(${TEST_GAME_IDS})`
      const ids = parts.map((r) => r.id as number)
      if (ids.length > 0) {
        await tx`DELETE FROM participant_augments WHERE "participantId" = ANY(${ids})`
        await tx`DELETE FROM participant_items WHERE "participantId" = ANY(${ids})`
        await tx`DELETE FROM participant_item_sets WHERE "participantId" = ANY(${ids})`
      }
      await tx`DELETE FROM elo_history WHERE "gameId" = ANY(${TEST_GAME_IDS})`
      await tx`DELETE FROM player_elo WHERE puuid = ANY(${['e2e-p1', 'e2e-p2']})`
      await tx`DELETE FROM participants WHERE "gameId" = ANY(${TEST_GAME_IDS})`
      await tx`DELETE FROM matches WHERE "gameId" = ANY(${TEST_GAME_IDS})`

      for (const t of [
        'champion_stats_cache', 'augment_stats_cache', 'player_stats_cache',
        'player_champion_stats_cache', 'augment_champion_stats_cache',
        'item_builds_cache', 'item_picks_cache',
      ]) {
        // Delete ALL rows — this is a test-only DB, stale rows from past runs pollute queries
        await tx.unsafe(`DELETE FROM ${t}`)
      }
      await tx`DELETE FROM sync_queue WHERE puuid = ANY(${['e2e-p1', 'e2e-p2']})`
      await tx`DELETE FROM player_sync_times WHERE puuid = ANY(${['e2e-p1', 'e2e-p2']})`

      // Seed matches
      // 2400 = Mayhem: matches 1001-1005 (Annie ×3, Teemo ×2 for e2e-p1)
      // 2450 = Classic: matches 2001-2002 (Lux ×2 for e2e-p1)
      await tx`
        INSERT INTO matches ("gameId","queueId","gameCreation","gameDuration","gameVersion")
        VALUES ${tx([
          [1001, 2400, NOW - 9 * 3600_000, 1100, VER],
          [1002, 2400, NOW - 8 * 3600_000, 1100, VER],
          [1003, 2400, NOW - 7 * 3600_000, 1100, VER],
          [1004, 2400, NOW - 6 * 3600_000, 1100, VER],
          [1005, 2400, NOW - 5 * 3600_000, 1100, VER],
          [2001, 2450, NOW - 4 * 3600_000, 1100, VER],
          [2002, 2450, NOW - 3 * 3600_000, 1100, VER],
        ] as any)}
      `

      // Participants: e2e-p1 + e2e-p2, same team (100)
      const partRows: any[][] = [
        // Match 1001: Annie win + augments [300,301,302]
        [1001, 'e2e-p1', 'E2EPlayer#NA1',  1, 'Annie', 100, true,  4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [1001, 'e2e-p2', 'E2ECoplay#NA1', 11, 'Other', 100, true,  2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
        // Match 1002: Annie win
        [1002, 'e2e-p1', 'E2EPlayer#NA1',  1, 'Annie', 100, true,  4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [1002, 'e2e-p2', 'E2ECoplay#NA1', 11, 'Other', 100, true,  2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
        // Match 1003: Annie loss
        [1003, 'e2e-p1', 'E2EPlayer#NA1',  1, 'Annie', 100, false, 4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [1003, 'e2e-p2', 'E2ECoplay#NA1', 11, 'Other', 100, false, 2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
        // Match 1004: Teemo win
        [1004, 'e2e-p1', 'E2EPlayer#NA1', 17, 'Teemo', 100, true,  4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [1004, 'e2e-p2', 'E2ECoplay#NA1', 27, 'Other', 100, true,  2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
        // Match 1005: Teemo loss
        [1005, 'e2e-p1', 'E2EPlayer#NA1', 17, 'Teemo', 100, false, 4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [1005, 'e2e-p2', 'E2ECoplay#NA1', 27, 'Other', 100, false, 2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
        // Match 2001: Lux win (Classic)
        [2001, 'e2e-p1', 'E2EPlayer#NA1', 99, 'Lux',   100, true,  4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [2001, 'e2e-p2', 'E2ECoplay#NA1',109, 'Other', 100, true,  2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
        // Match 2002: Lux loss (Classic)
        [2002, 'e2e-p1', 'E2EPlayer#NA1', 99, 'Lux',   100, false, 4, 1, 6, 40000, 15000, 10000, 14, VER, 1100],
        [2002, 'e2e-p2', 'E2ECoplay#NA1',109, 'Other', 100, false, 2, 2, 4, 20000, 10000,  8000, 13, VER, 1100],
      ]

      const inserted = await tx<{ id: number; gameId: number; puuid: string }[]>`
        INSERT INTO participants
          ("gameId",puuid,"summonerName","championId","championName","teamId",
           win,kills,deaths,assists,"damageDealt","damageTaken","goldEarned","champLevel",
           "gameVersion","gameDuration")
        VALUES ${tx(partRows as any)}
        RETURNING id, "gameId"::int AS "gameId", puuid
      `

      // Augments for match 1001 e2e-p1
      const p1_1001 = inserted.find(r => r.gameId === 1001 && r.puuid === 'e2e-p1')
      if (p1_1001) {
        await tx`
          INSERT INTO participant_augments ("participantId","augmentId") VALUES
          (${p1_1001.id}, 300),
          (${p1_1001.id}, 301),
          (${p1_1001.id}, 302)
        `
      }

      // champion_stats_cache
      await tx`
        INSERT INTO champion_stats_cache
          ("gameVersion","queueId","championId","championName",
           games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([
          [VER, 2400,   1, 'Annie', 3, 2, 12,  3, 18, 120000, 3300],
          [VER, 2400,  11, 'Other', 3, 2,  6,  6, 12,  60000, 3300],
          [VER, 2400,  17, 'Teemo', 2, 1,  8,  2, 12,  80000, 2200],
          [VER, 2400,  27, 'Other', 2, 1,  4,  4,  8,  40000, 2200],
          [VER, 2450,  99, 'Lux',   2, 1,  8,  2, 12,  80000, 2200],
          [VER, 2450, 109, 'Other', 2, 1,  4,  4,  8,  40000, 2200],
        ] as any)}
      `

      // augment_stats_cache (only match 1001 has augments for e2e-p1)
      await tx`
        INSERT INTO augment_stats_cache
          ("gameVersion","queueId","augmentId",pick_count,wins,total_damage,total_duration)
        VALUES
          (${VER}, 2400, 300, 1, 1, 40000, 1100),
          (${VER}, 2400, 301, 1, 1, 40000, 1100),
          (${VER}, 2400, 302, 1, 1, 40000, 1100)
      `

      // player_stats_cache
      await tx`
        INSERT INTO player_stats_cache
          ("gameVersion","queueId",puuid,"summonerName",
           games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([
          [VER, 2400, 'e2e-p1', 'E2EPlayer#NA1', 5, 3, 20,  5, 30, 200000, 5500],
          [VER, 2400, 'e2e-p2', 'E2ECoplay#NA1', 5, 3, 10, 10, 20, 100000, 5500],
          [VER, 2450, 'e2e-p1', 'E2EPlayer#NA1', 2, 1,  8,  2, 12,  80000, 2200],
          [VER, 2450, 'e2e-p2', 'E2ECoplay#NA1', 2, 1,  4,  4,  8,  40000, 2200],
        ] as any)}
      `

      // player_champion_stats_cache
      await tx`
        INSERT INTO player_champion_stats_cache
          ("gameVersion","queueId",puuid,"championId","championName",
           games,wins,total_kills,total_deaths,total_assists,total_damage,total_duration)
        VALUES ${tx([
          [VER, 2400, 'e2e-p1',   1, 'Annie', 3, 2, 12,  3, 18, 120000, 3300],
          [VER, 2400, 'e2e-p1',  17, 'Teemo', 2, 1,  8,  2, 12,  80000, 2200],
          [VER, 2400, 'e2e-p2',  11, 'Other', 3, 2,  6,  6, 12,  60000, 3300],
          [VER, 2400, 'e2e-p2',  27, 'Other', 2, 1,  4,  4,  8,  40000, 2200],
          [VER, 2450, 'e2e-p1',  99, 'Lux',   2, 1,  8,  2, 12,  80000, 2200],
          [VER, 2450, 'e2e-p2', 109, 'Other', 2, 1,  4,  4,  8,  40000, 2200],
        ] as any)}
      `

      // augment_champion_stats_cache
      await tx`
        INSERT INTO augment_champion_stats_cache
          ("gameVersion","queueId","augmentId","championId","championName",
           pick_count,wins,total_damage,total_duration)
        VALUES
          (${VER}, 2400, 300, 1, 'Annie', 1, 1, 40000, 1100),
          (${VER}, 2400, 301, 1, 'Annie', 1, 1, 40000, 1100),
          (${VER}, 2400, 302, 1, 'Annie', 1, 1, 40000, 1100)
      `

      // player_elo — current ratings for both queues
      await tx`
        INSERT INTO player_elo (puuid, "queueId", elo, games_rated, last_processed_game_creation)
        VALUES ${tx([
          ['e2e-p1', 2400, 1513, 15, NOW - 5 * 3600_000],
          ['e2e-p2', 2400, 1487, 15, NOW - 5 * 3600_000],
          ['e2e-p1', 2450, 1499, 2, NOW - 3 * 3600_000],
          ['e2e-p2', 2450, 1499, 2, NOW - 3 * 3600_000],
        ] as any)}
      `

      // elo_history for e2e-p1 — Mayhem (5 games: 3 wins, 2 losses)
      await tx`
        INSERT INTO elo_history (puuid, "gameId", "queueId", elo_before, elo_after, delta, "gameCreation")
        VALUES ${tx([
          ['e2e-p1', 1001, 2400, 1500, 1516,  16, NOW - 9 * 3600_000],
          ['e2e-p1', 1002, 2400, 1516, 1531,  15, NOW - 8 * 3600_000],
          ['e2e-p1', 1003, 2400, 1531, 1514, -17, NOW - 7 * 3600_000],
          ['e2e-p1', 1004, 2400, 1514, 1530,  16, NOW - 6 * 3600_000],
          ['e2e-p1', 1005, 2400, 1530, 1513, -17, NOW - 5 * 3600_000],
        ] as any)}
      `

      // elo_history for e2e-p1 — Classic (2 games: 1 win, 1 loss → net -1)
      await tx`
        INSERT INTO elo_history (puuid, "gameId", "queueId", elo_before, elo_after, delta, "gameCreation")
        VALUES ${tx([
          ['e2e-p1', 2001, 2450, 1500, 1516,  16, NOW - 4 * 3600_000],
          ['e2e-p1', 2002, 2450, 1516, 1499, -17, NOW - 3 * 3600_000],
        ] as any)}
      `
    })
  } finally {
    await sql.end()
  }
}

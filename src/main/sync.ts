import { getMatchHistory, getGameDetails, LCUMatchHistoryGame } from './lcu'
import { apiClient } from './apiClient'
import { inferPatch } from '../backend/db'
import type { Match } from '../backend/db'

let championNames: Record<number, string> = {}

export function setChampionNames(names: Record<number, string>): void {
  championNames = names
}

export function getChampionNames(): Record<number, string> {
  return championNames
}

export function mapGame(game: LCUMatchHistoryGame): Match {
  return {
    gameId: game.gameId,
    queueId: game.queueId,
    gameCreation: game.gameCreation,
    gameDuration: game.gameDuration,
    gameVersion: inferPatch(game.gameCreation),
    participants: game.participants.map((p) => {
      const identity = game.participantIdentities.find(
        (pi) => pi.participantId === p.participantId
      )
      const s = p.stats
      return {
        puuid: identity?.player.puuid ?? '',
        summonerName: identity?.player.gameName
          ? `${identity.player.gameName}#${identity.player.tagLine}`
          : identity?.player.summonerName || 'Unknown',
        championId: p.championId,
        championName: championNames[p.championId] ?? `Champion ${p.championId}`,
        teamId: p.teamId,
        win: s.win,
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        damageDealt: s.totalDamageDealtToChampions,
        damageTaken: s.totalDamageTaken,
        goldEarned: s.goldEarned,
        champLevel: s.champLevel,
        augments: [s.playerAugment1, s.playerAugment2, s.playerAugment3,
                   s.playerAugment4, s.playerAugment5, s.playerAugment6]
                  .filter((a): a is number => !!a)
      }
    })
  }
}

export async function importGamesForPuuid(
  puuid: string
): Promise<{ imported: number; fetchFailed: boolean }> {
  let imported = 0
  let fetchFailed = false

  const { games, totalInWindow } = await getMatchHistory(puuid, 0, 49)

  if (totalInWindow === 0) {
    fetchFailed = true
  } else {
    for (const game of games) {
      if (await apiClient.matchExists(game.gameId)) continue

      const full = await getGameDetails(game.gameId)
      const data = full ?? game
      await apiClient.insertMatch(mapGame(data))
      imported++
    }
    if (imported > 0) console.log(`[sync]   ${imported} new from ${games.length} aram games`)
  }

  return { imported, fetchFailed }
}

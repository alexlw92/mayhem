import { getMatchHistory, getGameDetails, LCUMatchHistoryGame } from './lcu'
import { apiClient } from './apiClient'
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
    gameVersion: game.gameVersion?.split('.').slice(0, 2).join('.') ?? inferPatch(game.gameCreation),
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
                  .filter((a): a is number => !!a),
        items: ([s.item0, s.item1, s.item2, s.item3, s.item4, s.item5] as const)
               .map((id, slot) => (id ? { id, slot } : null))
               .filter((x): x is { id: number; slot: number } => x !== null)
      }
    })
  }
}

export async function importGamesForPuuid(
  puuid: string,
  shouldStop?: () => boolean
): Promise<{ imported: number; fetchFailed: boolean }> {
  const { games, totalInWindow } = await getMatchHistory(puuid, 0, 49)
  if (totalInWindow === 0) return { imported: 0, fetchFailed: true }

  const CONCURRENCY = 5
  const toInsert: Match[] = []
  for (let i = 0; i < games.length; i += CONCURRENCY) {
    if (shouldStop?.()) break
    const chunk = games.slice(i, i + CONCURRENCY)
    const details = await Promise.all(chunk.map(g => getGameDetails(g.gameId)))
    for (let j = 0; j < chunk.length; j++) {
      toInsert.push(mapGame(details[j] ?? chunk[j]))
    }
  }

  if (toInsert.length === 0) return { imported: 0, fetchFailed: false }
  const BATCH_SIZE = 10
  let imported = 0
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const { inserted } = await apiClient.insertMatches(toInsert.slice(i, i + BATCH_SIZE))
    imported += inserted
  }
  return { imported, fetchFailed: false }
}

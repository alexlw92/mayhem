import { describe, it, expect, beforeEach } from 'vitest'
import { mapGame, setChampionNames } from '../sync'
import type { LCUMatchHistoryGame } from '../lcu'

const PATCH_14_1_TS = new Date('2024-01-12T00:00:00Z').getTime()

function makeGame(overrides: Partial<LCUMatchHistoryGame> = {}): LCUMatchHistoryGame {
  return {
    gameId: 1001,
    gameCreation: PATCH_14_1_TS,
    gameDuration: 1200,
    gameMode: 'ARAM',
    gameType: 'MATCHED_GAME',
    queueId: 2400,
    teams: [
      { teamId: 100, win: 'Win' },
      { teamId: 200, win: 'Fail' }
    ],
    participants: [
      {
        participantId: 1,
        teamId: 100,
        championId: 64,
        stats: {
          kills: 5, deaths: 2, assists: 10, win: true,
          totalDamageDealtToChampions: 50000, totalDamageTaken: 30000,
          goldEarned: 9000, champLevel: 13,
          playerAugment1: 101, playerAugment2: 202, playerAugment3: 0,
          playerAugment4: undefined, playerAugment5: undefined, playerAugment6: undefined
        }
      }
    ],
    participantIdentities: [
      {
        participantId: 1,
        player: {
          summonerName: 'OldName',
          gameName: 'TestPlayer',
          tagLine: 'NA1',
          summonerId: 999,
          puuid: 'puuid-abc-123'
        }
      }
    ],
    ...overrides
  }
}

describe('mapGame', () => {
  beforeEach(() => {
    setChampionNames({ 64: 'Lee Sin' })
  })

  it('maps gameId, queueId, and duration correctly', () => {
    const result = mapGame(makeGame())
    expect(result.gameId).toBe(1001)
    expect(result.queueId).toBe(2400)
    expect(result.gameDuration).toBe(1200)
  })

  it('infers the patch from gameCreation timestamp', () => {
    const result = mapGame(makeGame())
    expect(result.gameVersion).toBe('14.1')
  })

  it('formats summonerName as gameName#tagLine', () => {
    const result = mapGame(makeGame())
    expect(result.participants[0].summonerName).toBe('TestPlayer#NA1')
  })

  it('falls back to summonerName when gameName is absent', () => {
    const game = makeGame()
    game.participantIdentities[0].player.gameName = ''
    const result = mapGame(game)
    expect(result.participants[0].summonerName).toBe('OldName')
  })

  it('uses Unknown when no identity exists for the participant', () => {
    const game = makeGame()
    game.participantIdentities = []
    const result = mapGame(game)
    expect(result.participants[0].puuid).toBe('')
    expect(result.participants[0].summonerName).toBe('Unknown')
  })

  it('resolves champion name from the cache', () => {
    const result = mapGame(makeGame())
    expect(result.participants[0].championName).toBe('Lee Sin')
  })

  it('falls back to Champion <id> when champion not in cache', () => {
    setChampionNames({})
    const result = mapGame(makeGame())
    expect(result.participants[0].championName).toBe('Champion 64')
  })

  it('filters out falsy augment values', () => {
    const result = mapGame(makeGame())
    // playerAugment1=101, playerAugment2=202, playerAugment3=0 (falsy) → [101, 202]
    expect(result.participants[0].augments).toEqual([101, 202])
  })

  it('maps stats correctly', () => {
    const p = mapGame(makeGame()).participants[0]
    expect(p.kills).toBe(5)
    expect(p.deaths).toBe(2)
    expect(p.assists).toBe(10)
    expect(p.win).toBe(true)
    expect(p.damageDealt).toBe(50000)
    expect(p.damageTaken).toBe(30000)
    expect(p.goldEarned).toBe(9000)
    expect(p.champLevel).toBe(13)
  })
})

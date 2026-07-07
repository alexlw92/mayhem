import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { LCUMatchHistoryGame } from '../lcu'

vi.mock('../lcu', () => ({
  getMatchHistory: vi.fn(),
  getGameDetails: vi.fn(),
}))
vi.mock('../apiClient', () => ({
  apiClient: {
    matchExists: vi.fn(),
    insertMatch: vi.fn(),
  },
}))

import { getMatchHistory, getGameDetails } from '../lcu'
import { apiClient } from '../apiClient'
import { importGamesForPuuid } from '../sync'

const makeGame = (overrides: Partial<LCUMatchHistoryGame> = {}): LCUMatchHistoryGame => ({
  gameId: 1001,
  gameCreation: new Date('2025-06-01T00:00:00Z').getTime(),
  gameDuration: 1200,
  queueId: 2400,
  gameMode: 'ARAM',
  gameType: 'MATCHED_GAME',
  teams: [],
  participants: [{
    participantId: 1, teamId: 100, championId: 1,
    stats: {
      win: true, kills: 3, deaths: 1, assists: 5,
      totalDamageDealtToChampions: 20000, totalDamageTaken: 10000,
      goldEarned: 8000, champLevel: 10
    }
  }],
  participantIdentities: [{
    participantId: 1,
    player: { puuid: 'puuid-a', summonerName: 'Foo', gameName: 'Foo', tagLine: 'NA1', summonerId: 1 }
  }],
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getMatchHistory).mockResolvedValue({ games: [makeGame()], totalInWindow: 1 })
  vi.mocked(getGameDetails).mockResolvedValue(null)
  vi.mocked(apiClient.matchExists).mockResolvedValue(false)
  vi.mocked(apiClient.insertMatch).mockResolvedValue({} as any)
})

describe('importGamesForPuuid', () => {
  it('returns fetchFailed: true when totalInWindow is 0', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({ games: [], totalInWindow: 0 })
    const result = await importGamesForPuuid('puuid-a')
    expect(result).toEqual({ imported: 0, fetchFailed: true })
  })

  it('returns fetchFailed: false and imported: 0 when all games already exist', async () => {
    vi.mocked(apiClient.matchExists).mockResolvedValue(true)
    const result = await importGamesForPuuid('puuid-a')
    expect(result).toEqual({ imported: 0, fetchFailed: false })
  })

  it('does not call insertMatch for games that already exist', async () => {
    vi.mocked(apiClient.matchExists).mockResolvedValue(true)
    await importGamesForPuuid('puuid-a')
    expect(apiClient.insertMatch).not.toHaveBeenCalled()
  })

  it('inserts new games and returns correct imported count', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({
      games: [makeGame({ gameId: 1 }), makeGame({ gameId: 2 })],
      totalInWindow: 2
    })
    vi.mocked(apiClient.matchExists).mockResolvedValue(false)
    const result = await importGamesForPuuid('puuid-a')
    expect(result.imported).toBe(2)
    expect(result.fetchFailed).toBe(false)
    expect(apiClient.insertMatch).toHaveBeenCalledTimes(2)
  })

  it('uses getGameDetails result when available', async () => {
    const detailedGame = makeGame({ gameId: 9999, gameDuration: 3000 })
    vi.mocked(getGameDetails).mockResolvedValue(detailedGame)
    await importGamesForPuuid('puuid-a')
    const inserted = vi.mocked(apiClient.insertMatch).mock.calls[0][0]
    expect(inserted.gameId).toBe(9999)
    expect(inserted.gameDuration).toBe(3000)
  })

  it('falls back to history game when getGameDetails returns null', async () => {
    vi.mocked(getGameDetails).mockResolvedValue(null)
    await importGamesForPuuid('puuid-a')
    const inserted = vi.mocked(apiClient.insertMatch).mock.calls[0][0]
    expect(inserted.gameId).toBe(1001)
  })
})

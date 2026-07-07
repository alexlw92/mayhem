import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { LCUMatchHistoryGame } from '../lcu'

vi.mock('../lcu', () => ({
  getMatchHistory: vi.fn(),
  getGameDetails: vi.fn(),
}))
vi.mock('../apiClient', () => ({
  apiClient: {
    insertMatches: vi.fn(),
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
  vi.mocked(apiClient.insertMatches).mockResolvedValue({ inserted: 1 })
})

describe('importGamesForPuuid', () => {
  it('returns fetchFailed: true when totalInWindow is 0', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({ games: [], totalInWindow: 0 })
    const result = await importGamesForPuuid('puuid-a')
    expect(result).toEqual({ imported: 0, fetchFailed: true })
    expect(apiClient.insertMatches).not.toHaveBeenCalled()
  })

  it('calls insertMatches with all games in a single call', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({
      games: [makeGame({ gameId: 1 }), makeGame({ gameId: 2 }), makeGame({ gameId: 3 })],
      totalInWindow: 3
    })
    vi.mocked(apiClient.insertMatches).mockResolvedValue({ inserted: 3 })
    await importGamesForPuuid('puuid-a')
    expect(apiClient.insertMatches).toHaveBeenCalledTimes(1)
    const [matches] = vi.mocked(apiClient.insertMatches).mock.calls[0]
    expect(matches).toHaveLength(3)
  })

  it('returns imported count from backend inserted value', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({
      games: [makeGame({ gameId: 1 }), makeGame({ gameId: 2 })],
      totalInWindow: 2
    })
    vi.mocked(apiClient.insertMatches).mockResolvedValue({ inserted: 1 })
    const result = await importGamesForPuuid('puuid-a')
    expect(result).toEqual({ imported: 1, fetchFailed: false })
  })

  it('calls getGameDetails for every game without pre-filtering', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({
      games: [makeGame({ gameId: 10 }), makeGame({ gameId: 20 })],
      totalInWindow: 2
    })
    await importGamesForPuuid('puuid-a')
    expect(getGameDetails).toHaveBeenCalledTimes(2)
    expect(getGameDetails).toHaveBeenCalledWith(10)
    expect(getGameDetails).toHaveBeenCalledWith(20)
  })

  it('uses getGameDetails result when available', async () => {
    const detailedGame = makeGame({ gameId: 9999, gameDuration: 3000 })
    vi.mocked(getGameDetails).mockResolvedValue(detailedGame)
    await importGamesForPuuid('puuid-a')
    const [matches] = vi.mocked(apiClient.insertMatches).mock.calls[0]
    expect(matches[0].gameId).toBe(9999)
    expect(matches[0].gameDuration).toBe(3000)
  })

  it('falls back to history game when getGameDetails returns null', async () => {
    vi.mocked(getGameDetails).mockResolvedValue(null)
    await importGamesForPuuid('puuid-a')
    const [matches] = vi.mocked(apiClient.insertMatches).mock.calls[0]
    expect(matches[0].gameId).toBe(1001)
  })

  it('stops before next batch when shouldStop returns true', async () => {
    const games = Array.from({ length: 10 }, (_, i) => makeGame({ gameId: i + 1 }))
    vi.mocked(getMatchHistory).mockResolvedValue({ games, totalInWindow: 10 })
    vi.mocked(apiClient.insertMatches).mockResolvedValue({ inserted: 0 })

    let calls = 0
    const shouldStop = () => { calls++; return calls > 1 }

    await importGamesForPuuid('puuid-a', shouldStop)
    // First batch of 5 runs (shouldStop returns false), second check returns true — only 5 games fetched
    expect(getGameDetails).toHaveBeenCalledTimes(5)
  })

  it('returns imported: 0 without calling insertMatches when stopped before any batch', async () => {
    vi.mocked(getMatchHistory).mockResolvedValue({
      games: [makeGame({ gameId: 1 })],
      totalInWindow: 1
    })
    const result = await importGamesForPuuid('puuid-a', () => true)
    expect(result).toEqual({ imported: 0, fetchFailed: false })
    expect(apiClient.insertMatches).not.toHaveBeenCalled()
  })
})

import axios from 'axios'
import { BACKEND_URL } from './config'
import type { Match } from '../backend/db'

const http = axios.create({ baseURL: BACKEND_URL, timeout: 10_000 })

export const apiClient = {
  patches: (): Promise<string[]> =>
    http.get('/api/patches').then((r) => r.data),

  playerStats: (patches?: string[]) =>
    http.get('/api/players', { params: { patches: patches?.join(',') }, timeout: 30_000 }).then((r) => r.data),

  playerOneStats: (puuid: string, patches?: string[]) =>
    http.get(`/api/players/${puuid}/stats`, { params: { patches: patches?.join(',') }, timeout: 30_000 }).then((r) => r.data),

  playerBulkStats: (puuids: string[], patches?: string[]) =>
    http.post('/api/players/bulk-stats', { puuids }, { params: { patches: patches?.join(',') }, timeout: 30_000 }).then((r) => r.data),

  championStats: (puuid?: string, patches?: string[]) =>
    http.get(puuid ? `/api/players/${puuid}/champions` : '/api/champions', {
      params: { patches: patches?.join(',') }, timeout: 30_000
    }).then((r) => r.data),

  recentMatches: (limit?: number, puuid?: string, patches?: string[]) =>
    http.get(puuid ? `/api/players/${puuid}/matches` : '/api/matches', {
      params: { limit, patches: patches?.join(',') }
    }).then((r) => r.data),

  augmentStats: (puuid?: string, championId?: number, patches?: string[]) =>
    http.get(puuid ? `/api/players/${puuid}/augments` : '/api/augments', {
      params: { championId, patches: patches?.join(',') }, timeout: 30_000
    }).then((r) => r.data),

  augmentChampionStats: (augmentId: number, puuid?: string, patches?: string[]) =>
    http.get(`/api/augments/${augmentId}/champions`, {
      params: { puuid, patches: patches?.join(',') }
    }).then((r) => r.data),

  winRateTrend: (puuid?: string, days?: number) =>
    http.get(puuid ? `/api/players/${puuid}/trend` : '/api/trend', {
      params: { days }
    }).then((r) => r.data),

  groupSummary: () =>
    http.get('/api/group').then((r) => r.data),

  playerName: (puuid: string): Promise<string | null> =>
    http.get(`/api/players/${puuid}/name`).then((r) => r.data),

  coplayerStats: (puuid: string, patches?: string[]): Promise<{ puuid: string; summonerName: string; games: number; wins: number }[]> =>
    http.get(`/api/players/${puuid}/coplayers`, { params: { patches: patches?.join(',') } }).then((r) => r.data),

  matchExists: (gameId: number): Promise<boolean> =>
    http.get(`/api/matches/${gameId}/exists`).then((r) => r.data),

  insertMatches: (matches: Match[]): Promise<{ inserted: number }> =>
    http.post('/api/matches/bulk', { matches }, { timeout: 30_000 }).then(r => r.data),

  upsertMatch: (match: Match) =>
    http.put(`/api/matches/${match.gameId}`, match, { timeout: 30_000 }),

  incompleteGames: (): Promise<number[]> =>
    http.get('/api/incomplete-games').then((r) => r.data),

  invalidateSyncTimes: () =>
    http.delete('/api/synctimes'),

  claimNextJob: (clientId: string): Promise<{ puuid: string | null }> =>
    http.get('/api/sync/next', { params: { clientId } }).then((r) => r.data),

  completeJob: (puuid: string) =>
    http.post(`/api/sync/done/${puuid}`),

  failJob: (puuid: string) =>
    http.post(`/api/sync/fail/${puuid}`),

  enqueuePlayer: (puuid: string) =>
    http.post('/api/sync/enqueue', { puuid }),

  enqueuePriority: (puuids: string[]) =>
    http.post('/api/sync/enqueue-priority', { puuids }).then((r) => r.data),

  queueStatus: (): Promise<{ total: number; claimed: number }> =>
    http.get('/api/sync/queue').then((r) => r.data),

  clearQueue: () =>
    http.delete('/api/sync/queue'),

  championCache: (): Promise<Record<number, string>> =>
    http.get('/api/meta/champions').then((r) => r.data),

  searchPlayers: (query: string): Promise<{ puuid: string; summonerName: string }[]> =>
    http.get('/api/players/search', { params: { q: query } }).then((r) => r.data),
}

import fs from 'fs'
import path from 'path'
import https from 'https'
import axios from 'axios'
import { LCU_MAX_RETRY_MS, LCU_RETRY_BASE_DELAY_MS } from './config'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function withRetry<T>(fn: () => Promise<T>, maxTotalWaitMs = LCU_MAX_RETRY_MS): Promise<T> {
  let delay = LCU_RETRY_BASE_DELAY_MS
  let totalWaited = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (totalWaited + delay > maxTotalWaitMs) throw err
      console.warn(`[lcu] request failed, retrying in ${delay}ms (${totalWaited + delay}ms/${maxTotalWaitMs}ms used)`)
      await sleep(delay)
      totalWaited += delay
      delay *= 2
    }
  }
}

const LEAGUE_PATHS = [
  'C:\\Riot Games\\League of Legends',
  'D:\\Riot Games\\League of Legends',
  'C:\\Program Files\\Riot Games\\League of Legends',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends'
]

export interface LCUCredentials {
  port: number
  password: string
  protocol: string
}

export interface LCUSummoner {
  accountId: number
  displayName: string
  gameName: string
  tagLine: string
  puuid: string
  summonerId: number
  summonerLevel: number
  profileIconId: number
}

export interface LCUMatchHistoryGame {
  gameId: number
  gameCreation: number
  gameDuration: number
  gameVersion?: string
  gameMode: string
  gameType: string
  queueId: number
  teams: LCUTeam[]
  participants: LCUParticipant[]
  participantIdentities: LCUParticipantIdentity[]
}

export interface LCUTeam {
  teamId: number
  win: string
}

export interface LCUParticipant {
  participantId: number
  teamId: number
  championId: number
  stats: LCUParticipantStats
}

export interface LCUParticipantStats {
  kills: number
  deaths: number
  assists: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  goldEarned: number
  win: boolean
  champLevel: number
  playerAugment1?: number
  playerAugment2?: number
  playerAugment3?: number
  playerAugment4?: number
  playerAugment5?: number
  playerAugment6?: number
}

export interface LCUParticipantIdentity {
  participantId: number
  player: {
    summonerName: string
    gameName: string
    tagLine: string
    summonerId: number
    puuid: string
  }
}

// ARAM Mayhem queue ID — Riot internal game mode "KIWI"
export const ARAM_MAYHEM_QUEUE_ID = 2400

let credentials: LCUCredentials | null = null
let axiosInstance: ReturnType<typeof axios.create> | null = null

function findLockfile(): string | null {
  for (const leaguePath of LEAGUE_PATHS) {
    const lockfilePath = path.join(leaguePath, 'lockfile')
    if (fs.existsSync(lockfilePath)) {
      return lockfilePath
    }
  }
  return null
}

function parseLockfile(content: string): LCUCredentials {
  const parts = content.split(':')
  return {
    port: parseInt(parts[2]),
    password: parts[3],
    protocol: parts[4]
  }
}

export function getLCUCredentials(): LCUCredentials | null {
  const lockfilePath = findLockfile()
  if (!lockfilePath) return null

  try {
    const content = fs.readFileSync(lockfilePath, 'utf-8')
    return parseLockfile(content)
  } catch {
    return null
  }
}

export function isClientRunning(): boolean {
  return getLCUCredentials() !== null
}

function createAxiosInstance(creds: LCUCredentials) {
  return axios.create({
    baseURL: `https://127.0.0.1:${creds.port}`,
    auth: { username: 'riot', password: creds.password },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 5000
  })
}

function getAxios(): ReturnType<typeof axios.create> | null {
  const creds = getLCUCredentials()
  if (!creds) return null

  if (!credentials || credentials.port !== creds.port || credentials.password !== creds.password) {
    credentials = creds
    axiosInstance = createAxiosInstance(creds)
  }

  return axiosInstance
}

export async function getCurrentSummoner(): Promise<LCUSummoner | null> {
  const client = getAxios()
  if (!client) return null

  try {
    const res = await client.get('/lol-summoner/v1/current-summoner')
    return res.data
  } catch {
    return null
  }
}

export async function getMatchHistory(
  puuid: string,
  begIndex = 0,
  endIndex = 19
): Promise<{ games: LCUMatchHistoryGame[]; totalInWindow: number }> {
  const client = getAxios()
  if (!client) return { games: [], totalInWindow: 0 }

  try {
    const res = await withRetry(() =>
      client.get(`/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=${begIndex}&endIndex=${endIndex}`)
    )
    const all: LCUMatchHistoryGame[] = res.data.games?.games ?? []
    return {
      games: all.filter((g) => g.queueId === ARAM_MAYHEM_QUEUE_ID),
      totalInWindow: all.length
    }
  } catch (err: any) {
    const status = err?.response?.status
    if (status === 429) console.warn('[lcu] rate limited on match history')
    else console.error('[lcu] match history failed after retries:', err?.message ?? err)
    return { games: [], totalInWindow: 0 }
  }
}

export async function lookupSummonerByRiotId(
  gameName: string,
  tagLine: string
): Promise<LCUSummoner | null> {
  const client = getAxios()
  if (!client) return null

  const attempts = [
    `/lol-summoner/v1/summoners?name=${encodeURIComponent(`${gameName}#${tagLine}`)}`,
    `/lol-summoner/v1/summoners?name=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`,
    `/lol-summoner/v1/summoners?name=${encodeURIComponent(gameName)}`,
  ]

  for (const url of attempts) {
    try {
      const res = await client.get(url)
      let result = Array.isArray(res.data) ? res.data[0] ?? null : res.data
      console.warn(`[lcu] lookup ${url} →`, JSON.stringify(result))
      if (!result) continue
      if (!result.puuid && result.summonerId) {
        const r2 = await client.get(`/lol-summoner/v1/summoners/${result.summonerId}`)
        result = r2.data
        console.warn(`[lcu] summonerId fallback →`, JSON.stringify(result))
      }
      if (result?.puuid) return result
    } catch (err: any) {
      console.warn(`[lcu] lookup ${url} failed: ${err?.response?.status ?? err?.message}`)
    }
  }

  return null
}

export async function getGameDetails(gameId: number): Promise<LCUMatchHistoryGame | null> {
  const client = getAxios()
  if (!client) return null
  try {
    const res = await withRetry(() => client.get(`/lol-match-history/v1/games/${gameId}`))
    return res.data
  } catch (err: any) {
    console.error(`[lcu] game details for ${gameId} failed after retries:`, err?.message ?? err)
    return null
  }
}

export async function getRawMatchHistory(puuid: string): Promise<any> {
  const client = getAxios()
  if (!client) return null
  const res = await client.get(
    `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=9`
  )
  return res.data
}

export async function getChampionIcon(championId: number): Promise<string> {
  // Returns DDragon URL for champion icon — resolved in renderer via version endpoint
  try {
    const client = getAxios()
    if (!client) return ''
    const versionRes = await client.get('/lol-patch/v1/game-version')
    const version = (versionRes.data as string).split('.').slice(0, 2).join('.')
    return `https://ddragon.leagueoflegends.com/cdn/${version}.1/img/champion/${championId}.png`
  } catch {
    return ''
  }
}

export async function getChampionData(): Promise<Record<number, string>> {
  try {
    const versionRes = await axios.get(
      'https://ddragon.leagueoflegends.com/api/versions.json',
      { timeout: 10000 }
    )
    const version = versionRes.data[0]
    const champRes = await axios.get(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
      { timeout: 10000 }
    )
    const map: Record<number, string> = {}
    for (const champ of Object.values(champRes.data.data) as { key: string; name: string }[]) {
      map[parseInt(champ.key)] = champ.name
    }
    return map
  } catch {
    return {}
  }
}

export interface AugmentRaw {
  id: number
  nameTRA: string
  augmentSmallIconPath?: string
  rarity?: string  // "kSilver" | "kGold" | "kPrismatic"
}

export async function getAugmentData(): Promise<AugmentRaw[]> {
  try {
    const res = await axios.get(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json',
      { timeout: 15000 }
    )
    return (Array.isArray(res.data) ? res.data : []) as AugmentRaw[]
  } catch {
    return []
  }
}

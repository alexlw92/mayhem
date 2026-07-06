import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron'
import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import axios from 'axios'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  isClientRunning,
  getCurrentSummoner,
  getMatchHistory,
  getGameDetails,
  lookupSummonerByRiotId,
  getChampionData,
  getAugmentData,
  LCUMatchHistoryGame
} from './lcu'
import {
  initDb,
  matchExists,
  insertMatch,
  upsertMatch,
  getIncompleteGameIds,
  setPlayerSyncTime,
  isPlayerStale,
  invalidateAllSyncTimes,
  getCoplayerPuuids,
  getPlayerStats,
  getChampionStats,
  getAugmentStats,
  getPatches,
  getRecentMatches,
  getWinRateTrend,
  getGroupSummary,
  isMetaStale,
  saveMetaCache,
  getChampionCache,
  getAugmentCache,
  clearMetaCache,
  getPlayerName,
  inferPatch,
  AugmentInfo
} from './db'

import { AUTOSYNC_INTERVAL_MS, SYNC_STALE_THRESHOLD_MS } from './config'

protocol.registerSchemesAsPrivileged([
  { scheme: 'mayhem-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let championNames: Record<number, string> = {}
let pollInterval: ReturnType<typeof setInterval> | null = null
let syncInProgress = false
let syncGeneration = 0

// Forward main-process logs to renderer DevTools console
const _origLog = console.log.bind(console)
const _origWarn = console.warn.bind(console)
const _origError = console.error.bind(console)
function proxyConsole() {
  console.log = (...args) => { _origLog(...args); mainWindow?.webContents.send('main-log', 'log', args.map(String).join(' ')) }
  console.warn = (...args) => { _origWarn(...args); mainWindow?.webContents.send('main-log', 'warn', args.map(String).join(' ')) }
  console.error = (...args) => { _origError(...args); mainWindow?.webContents.send('main-log', 'error', args.map(String).join(' ')) }
}

// ─── Metadata ────────────────────────────────────────────────────────────────

async function downloadToCache(url: string, destPath: string): Promise<boolean> {
  try {
    await fs.promises.access(destPath)
    return true
  } catch { /* file doesn't exist, download it */ }
  try {
    await fs.promises.mkdir(dirname(destPath), { recursive: true })
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 15000 })
    await fs.promises.writeFile(destPath, Buffer.from(res.data))
    return true
  } catch {
    return false
  }
}

async function refreshMetadata(): Promise<void> {
  if (!isMetaStale()) {
    mainWindow?.webContents.send('assets-ready')
    return
  }
  const [champions, augmentsRaw] = await Promise.all([getChampionData(), getAugmentData()])
  if (Object.keys(champions).length === 0) {
    mainWindow?.webContents.send('assets-ready')
    return
  }

  const RARITY_MAP: Record<string, number> = { kSilver: 0, kGold: 1, kPrismatic: 2 }
  const CDRAGON_PLUGIN = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'
  const augments: Record<number, AugmentInfo> = {}
  for (const a of augmentsRaw) {
    const iconRaw = a.augmentSmallIconPath ?? ''
    // /lol-game-data/assets/ASSETS/... → {CDRAGON_PLUGIN}/assets/...
    const iconPath = iconRaw
      ? `${CDRAGON_PLUGIN}/${iconRaw.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase()}`
      : ''
    augments[a.id] = {
      id: a.id,
      name: a.nameTRA,
      desc: '',
      iconPath,
      rarity: RARITY_MAP[a.rarity ?? ''] ?? 0
    }
  }

  const imageCacheDir = join(app.getPath('userData'), 'image-cache')
  const championIds = Object.keys(champions)
  const augmentList = Object.values(augments).filter((aug) => aug.iconPath)
  const total = championIds.length + augmentList.length
  let done = 0
  mainWindow?.webContents.send('assets-progress', { done, total })

  await Promise.all(championIds.map(async (idStr) => {
    const url = `${CDRAGON_PLUGIN}/v1/champion-icons/${idStr}.png`
    await downloadToCache(url, join(imageCacheDir, 'champion-icons', `${idStr}.png`))
    mainWindow?.webContents.send('assets-progress', { done: ++done, total })
  }))

  await Promise.all(augmentList.map(async (aug) => {
    const dest = join(imageCacheDir, 'augment-icons', `${aug.id}.png`)
    if (await downloadToCache(aug.iconPath, dest)) {
      aug.iconPath = `mayhem-asset://augment-icons/${aug.id}.png`
    }
    mainWindow?.webContents.send('assets-progress', { done: ++done, total })
  }))

  saveMetaCache(champions, augments)
  championNames = champions
  mainWindow?.webContents.send('meta-refreshed')
  mainWindow?.webContents.send('assets-ready')
}

function ensureChampionNames(): void {
  if (Object.keys(championNames).length === 0) {
    championNames = getChampionCache()
  }
}

// ─── Core import logic ───────────────────────────────────────────────────────


function mapGame(game: LCUMatchHistoryGame) {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// LCU doesn't support pagination — always returns same 50 most recent games regardless of begIndex.
// One call per player is sufficient.
async function importGamesForPuuid(
  puuid: string
): Promise<{ imported: number; seenPuuids: Set<string>; fetchFailed: boolean }> {
  let imported = 0
  const seenPuuids = new Set<string>()
  let fetchFailed = false

  const { games, totalInWindow } = await getMatchHistory(puuid, 0, 49)

  for (const p of await getCoplayerPuuids(puuid)) seenPuuids.add(p)

  if (totalInWindow === 0) {
    fetchFailed = true
  } else {
    for (const game of games) {
      if (await matchExists(game.gameId)) continue

      const full = await getGameDetails(game.gameId)
      const data = full ?? game
      for (const identity of data.participantIdentities) {
        if (identity.player.puuid) seenPuuids.add(identity.player.puuid)
      }
      await insertMatch(mapGame(data))
      imported++
    }
    if (imported > 0) console.log(`[sync]   ${imported} new from ${games.length} aram games`)
  }

  return { imported, seenPuuids, fetchFailed }
}

// Fix matches already in DB that only have 1 participant (imported before this fix)
async function repairIncompleteMatches(): Promise<number> {
  const ids = await getIncompleteGameIds()
  let fixed = 0
  for (const gameId of ids) {
    const full = await getGameDetails(gameId)
    if (!full || full.participants.length < 2) continue
    await upsertMatch(mapGame(full))
    fixed++
  }
  return fixed
}

// ─── Sync ────────────────────────────────────────────────────────────────────

async function runSync(startPuuid: string, generation: number): Promise<{ imported: number; playerssynced: number; reason?: string }> {
  if (!isClientRunning()) {
    console.log('[sync] client not running')
    return { imported: 0, playerssynced: 0, reason: 'client-offline' }
  }

  ensureChampionNames()
  await repairIncompleteMatches()

  const queue: string[] = [startPuuid]
  const queued = new Set<string>([startPuuid])
  const retries = new Map<string, number>()

  let totalImported = 0
  let playerssynced = 0
  let playersSearched = 0

  console.log(`[sync] starting from ${startPuuid.slice(0, 8)}…`)

  while (queue.length > 0) {
    if (generation !== syncGeneration) {
      console.log(`[sync] cancelled after ${playerssynced} players, ${totalImported} imported`)
      return { imported: totalImported, playerssynced, reason: 'cancelled' }
    }

    const puuid = queue.shift()!
    playersSearched++

    const playerName = (await getPlayerName(puuid)) ?? puuid.slice(0, 8) + '…'
    mainWindow?.webContents.send('sync-progress', { playerName, totalImported, playersSearched })

    let imported = 0
    let seenPuuids = new Set<string>()
    let failed = false
    try {
      const result = await importGamesForPuuid(puuid)
      imported = result.imported
      seenPuuids = result.seenPuuids
      if (result.fetchFailed) {
        failed = true
        console.warn(`[sync] fetch failed for ${playerName} (${puuid.slice(0, 8)}…)`)
        await sleep(100)
      } else {
        console.log(`[sync] ${playerName}: ${imported} new game${imported !== 1 ? 's' : ''} (${seenPuuids.size} players seen, queue: ${queue.length})`)
      }
    } catch (err) {
      failed = true
      console.error(`[sync] error syncing ${playerName} (${puuid.slice(0, 8)}…):`, err)
    }

    if (failed) {
      const attempts = (retries.get(puuid) ?? 0) + 1
      retries.set(puuid, attempts)
      if (attempts <= 1) {
        console.log(`[sync] re-queuing ${playerName} (attempt ${attempts + 1})`)
        queue.push(puuid)
      } else {
        console.warn(`[sync] giving up on ${playerName} after ${attempts} attempts`)
        await setPlayerSyncTime(puuid)
        playerssynced++
      }
    } else {
      await setPlayerSyncTime(puuid)
      totalImported += imported
      playerssynced++

      for (const p of seenPuuids) {
        if (p && !queued.has(p) && await isPlayerStale(p, SYNC_STALE_THRESHOLD_MS)) {
          queue.push(p)
          queued.add(p)
        }
      }
    }

    mainWindow?.webContents.send('sync-progress', { playerName, totalImported, playersSearched })
  }

  console.log(`[sync] done — ${playerssynced} players, ${totalImported} new games`)
  return { imported: totalImported, playerssynced }
}

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Mayhem Stats',
    backgroundColor: '#0a0e1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => { mainWindow?.show(); proxyConsole() })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mayhem.stats')
  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))

  const imageCacheDir = join(app.getPath('userData'), 'image-cache')
  protocol.handle('mayhem-asset', async (request) => {
    const url = new URL(request.url)
    const localPath = join(imageCacheDir, url.hostname, url.pathname)
    try {
      const data = await fs.promises.readFile(localPath)
      return new Response(data, { headers: { 'Content-Type': 'image/png' } })
    } catch { /* file not cached yet, fall through */ }
    if (url.hostname === 'champion-icons') {
      return net.fetch(
        `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons${url.pathname}`
      )
    }
    return new Response(null, { status: 404 })
  })

  createWindow()

  mainWindow!.webContents.once('did-finish-load', async () => {
    try {
      await initDb()
    } catch (err) {
      console.error('[db] init failed:', err)
      mainWindow?.webContents.send('db-error', String(err))
      return
    }
    mainWindow?.webContents.send('db-ready')
    refreshMetadata().catch(() => {
      mainWindow?.webContents.send('assets-ready')
    })
  })

  pollInterval = setInterval(async () => {
    if (syncInProgress) return
    const summoner = await getCurrentSummoner()
    if (!summoner) return
    const gen = ++syncGeneration
    syncInProgress = true
    await invalidateAllSyncTimes()
    const result = await runSync(summoner.puuid, gen)
    if (gen !== syncGeneration) return
    syncInProgress = false
    if (result.imported > 0 && mainWindow) {
      mainWindow.webContents.send('matches-synced', result)
    }
  }, AUTOSYNC_INTERVAL_MS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (pollInterval) clearInterval(pollInterval)
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('lcu:status', () => ({ running: isClientRunning() }))
ipcMain.handle('lcu:syncStatus', () => ({ syncing: syncInProgress }))
ipcMain.handle('lcu:sync', async (_e, startPuuid?: string) => {
  if (syncInProgress) return { started: false }
  const puuid = startPuuid ?? (await getCurrentSummoner())?.puuid
  if (!puuid) return { started: false, reason: 'no-summoner' }
  const gen = ++syncGeneration
  syncInProgress = true
  mainWindow?.webContents.send('sync-started')
  runSync(puuid, gen).then((result) => {
    if (gen !== syncGeneration) return
    syncInProgress = false
    mainWindow?.webContents.send('sync-complete', result)
  }).catch((err) => {
    if (gen !== syncGeneration) return
    console.error('[sync] error:', err)
    syncInProgress = false
    mainWindow?.webContents.send('sync-complete', { imported: 0, playerssynced: 0, reason: 'error' })
  })
  return { started: true }
})

ipcMain.handle('lcu:fullSync', async (_e, startPuuid?: string) => {
  const puuid = startPuuid ?? (await getCurrentSummoner())?.puuid
  if (!puuid) return { started: false, reason: 'no-summoner' }
  const gen = ++syncGeneration
  syncInProgress = true
  mainWindow?.webContents.send('sync-started')
  ;(async () => {
    await invalidateAllSyncTimes()
    return runSync(puuid, gen)
  })().then((result) => {
    if (gen !== syncGeneration) return
    syncInProgress = false
    mainWindow?.webContents.send('sync-complete', result)
  }).catch((err) => {
    if (gen !== syncGeneration) return
    console.error('[sync] error:', err)
    syncInProgress = false
    mainWindow?.webContents.send('sync-complete', { imported: 0, playerssynced: 0, reason: 'error' })
  })
  return { started: true }
})

ipcMain.handle('lcu:syncPlayer', async (_e, puuid: string) => {
  if (!isClientRunning()) return { error: 'Client not running', imported: 0 }
  ensureChampionNames()
  const { imported, fetchFailed } = await importGamesForPuuid(puuid)
  if (fetchFailed) console.log('[sync] syncPlayer fetch failed for', puuid.slice(0, 8))
  await setPlayerSyncTime(puuid)
  return { imported }
})

ipcMain.handle('lcu:lookupPlayer', async (_e, gameName: string, tagLine: string) => {
  if (!isClientRunning()) return null
  return lookupSummonerByRiotId(gameName, tagLine)
})

ipcMain.handle('db:patches', () => getPatches())
ipcMain.handle('db:playerStats', (_e, patches?: string[]) => getPlayerStats(patches))
ipcMain.handle('db:championStats', (_e, puuid?: string, patches?: string[]) => getChampionStats(puuid, patches))
ipcMain.handle('db:recentMatches', (_e, limit?: number, puuid?: string, patches?: string[]) => getRecentMatches(limit, puuid, patches))
ipcMain.handle('db:winRateTrend', (_e, puuid?: string, days?: number) => getWinRateTrend(puuid, days))
ipcMain.handle('db:groupSummary', () => getGroupSummary())
ipcMain.handle('db:championCache', () => getChampionCache())
ipcMain.handle('db:augmentCache', () => getAugmentCache())
ipcMain.handle('db:augmentStats', (_e, puuid?: string, championId?: number, patches?: string[]) => getAugmentStats(puuid, championId, patches))

ipcMain.handle('db:currentSummoner', async () => {
  if (!isClientRunning()) return null
  return getCurrentSummoner()
})

ipcMain.handle('meta:refresh', async () => {
  clearMetaCache()
  await refreshMetadata()
  return {
    champions: Object.keys(getChampionCache()).length,
    augments: Object.keys(getAugmentCache()).length
  }
})

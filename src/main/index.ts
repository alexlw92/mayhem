import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron'
import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import os from 'os'
import axios from 'axios'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  isClientRunning,
  getCurrentSummoner,
  getGameDetails,
  lookupSummonerByRiotId,
  getChampionData,
  getAugmentData,
} from './lcu'
import {
  initDb,
  getIncompleteGameIds,
} from '../backend/db'
import {
  isMetaStale,
  saveMetaCache,
  getChampionCache,
  getAugmentCache,
  clearMetaCache,
  AugmentInfo
} from './meta'
import { apiClient } from './apiClient'
import { createExpressApp } from '../backend/server'
import { mapGame, importGamesForPuuid, setChampionNames, getChampionNames } from './sync'
import { AUTOSYNC_INTERVAL_MS, BACKEND_PORT } from './config'

protocol.registerSchemesAsPrivileged([
  { scheme: 'mayhem-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let workerRunning = false
let syncInProgress = false
let syncCancelled = false
let syncAccum = { imported: 0, playerssynced: 0 }

const CLIENT_ID = `electron-${os.hostname()}-${process.pid}`

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
  setChampionNames(champions)
  mainWindow?.webContents.send('meta-refreshed')
  mainWindow?.webContents.send('assets-ready')
}

function ensureChampionNames(): void {
  if (Object.keys(getChampionNames()).length === 0) {
    setChampionNames(getChampionCache())
  }
}

// ─── Repair incomplete matches ────────────────────────────────────────────────

async function repairIncompleteMatches(): Promise<number> {
  const ids = await apiClient.incompleteGames()
  let fixed = 0
  for (const gameId of ids) {
    const full = await getGameDetails(gameId)
    if (!full || full.participants.length < 2) continue
    await apiClient.upsertMatch(mapGame(full))
    fixed++
  }
  return fixed
}

// ─── Sync worker ──────────────────────────────────────────────────────────────

async function syncWorker(): Promise<void> {
  const draining = syncInProgress

  while (true) {
    if (syncCancelled) {
      syncCancelled = false
      syncInProgress = false
      mainWindow?.webContents.send('sync-complete', { ...syncAccum, reason: 'cancelled' })
      return
    }
    if (!isClientRunning()) {
      if (draining && syncInProgress) {
        syncInProgress = false
        mainWindow?.webContents.send('sync-complete', { ...syncAccum, reason: 'client-offline' })
      }
      return
    }
    ensureChampionNames()

    const { puuid } = await apiClient.claimNextJob(CLIENT_ID)
    if (!puuid) {
      if (draining && syncInProgress) {
        syncInProgress = false
        mainWindow?.webContents.send('sync-complete', syncAccum)
      }
      return
    }

    const playerName = await apiClient.playerName(puuid) ?? puuid.slice(0, 8) + '…'
    mainWindow?.webContents.send('sync-progress', { playerName, totalImported: 0, playersSearched: 1 })

    try {
      const { imported, fetchFailed } = await importGamesForPuuid(puuid, () => syncCancelled)
      if (fetchFailed) {
        console.warn(`[sync] no ARAM history for ${playerName}, skipping`)
        await apiClient.completeJob(puuid)
      } else {
        console.log(`[sync] ${playerName}: ${imported} new game${imported !== 1 ? 's' : ''}`)
        await apiClient.completeJob(puuid)
        if (draining) syncAccum.playerssynced++
        if (imported > 0) {
          if (draining) syncAccum.imported += imported
          mainWindow?.webContents.send('sync-progress', { playerName, totalImported: imported, playersSearched: 1 })
          mainWindow?.webContents.send('matches-synced', { imported, playerssynced: 1 })
        }
      }
    } catch (err) {
      console.error(`[sync] error syncing ${playerName}:`, err)
      await apiClient.failJob(puuid).catch(() => {})
    }
  }
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

    createExpressApp({
      getChampions: () => getChampionCache(),
      getAugments: () => getAugmentCache()
    }).listen(BACKEND_PORT, () => console.log(`[backend] :${BACKEND_PORT}`))

    mainWindow?.webContents.send('db-ready')

    refreshMetadata().catch(() => {
      mainWindow?.webContents.send('assets-ready')
    })

    ensureChampionNames()
    repairIncompleteMatches().catch(() => {})

    pollInterval = setInterval(async () => {
      if (workerRunning) return
      workerRunning = true
      try { await syncWorker() } finally { workerRunning = false }
    }, AUTOSYNC_INTERVAL_MS)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (pollInterval) clearInterval(pollInterval)
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('lcu:status', async () => {
  if (!isClientRunning()) return { running: false }
  const summoner = await getCurrentSummoner()
  return { running: summoner !== null }
})

ipcMain.handle('lcu:syncStatus', () => ({ syncing: workerRunning }))

ipcMain.handle('lcu:sync', async () => {
  const summoner = await getCurrentSummoner()
  if (!summoner) return { started: false, reason: 'no-summoner' }
  syncCancelled = false
  syncInProgress = true
  syncAccum = { imported: 0, playerssynced: 0 }
  await apiClient.enqueuePlayer(summoner.puuid)
  mainWindow?.webContents.send('sync-started')
  return { started: true }
})

ipcMain.handle('lcu:fullSync', async () => {
  const summoner = await getCurrentSummoner()
  if (!summoner) return { started: false, reason: 'no-summoner' }
  syncCancelled = false
  syncInProgress = true
  syncAccum = { imported: 0, playerssynced: 0 }
  await apiClient.invalidateSyncTimes()
  mainWindow?.webContents.send('sync-started')
  return { started: true }
})

ipcMain.handle('lcu:stopSync', () => { syncCancelled = true })

ipcMain.handle('lcu:syncPlayer', async (_e, puuid: string) => {
  if (!isClientRunning()) return { error: 'Client not running', imported: 0 }
  ensureChampionNames()
  const { imported, fetchFailed } = await importGamesForPuuid(puuid)
  if (fetchFailed) console.log('[sync] syncPlayer fetch failed for', puuid.slice(0, 8))
  await apiClient.completeJob(puuid).catch(() => {})
  return { imported }
})

ipcMain.handle('lcu:lookupPlayer', async (_e, gameName: string, tagLine: string) => {
  if (!isClientRunning()) return null
  return lookupSummonerByRiotId(gameName, tagLine)
})

ipcMain.handle('db:patches', () => apiClient.patches())
ipcMain.handle('db:playerStats', (_e, patches?: string[]) => apiClient.playerStats(patches))
ipcMain.handle('db:playerOneStats', (_e, puuid: string, patches?: string[]) => apiClient.playerOneStats(puuid, patches))
ipcMain.handle('db:championStats', (_e, puuid?: string, patches?: string[]) => apiClient.championStats(puuid, patches))
ipcMain.handle('db:recentMatches', (_e, limit?: number, puuid?: string, patches?: string[]) => apiClient.recentMatches(limit, puuid, patches))
ipcMain.handle('db:winRateTrend', (_e, puuid?: string, days?: number) => apiClient.winRateTrend(puuid, days))
ipcMain.handle('db:groupSummary', () => apiClient.groupSummary())
ipcMain.handle('db:championCache', () => apiClient.championCache())
ipcMain.handle('db:augmentCache', () => apiClient.augmentCache())
ipcMain.handle('db:augmentStats', (_e, puuid?: string, championId?: number, patches?: string[]) => apiClient.augmentStats(puuid, championId, patches))
ipcMain.handle('db:searchPlayers', (_e, query: string) => apiClient.searchPlayers(query))

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

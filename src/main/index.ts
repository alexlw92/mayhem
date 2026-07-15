import dotenv from 'dotenv'
import { join, dirname } from 'path'
if (process.env.NODE_ENV !== 'production') {
  // Dev: load .env.dev from project root
  dotenv.config({ path: join(process.cwd(), '.env.dev'), override: true })
} else {
  // Production: load .env next to exe, then one level up, then cwd fallback
  dotenv.config({ path: join(dirname(process.execPath), '.env') })
  dotenv.config({ path: join(dirname(process.execPath), '..', '.env') })
  dotenv.config()
}
import { app, BrowserWindow, ipcMain, shell, protocol, net, desktopCapturer, utilityProcess } from 'electron'
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
  getGameflowSession,
  getChampSelectSession,
} from './lcu'
import {
  isMetaStale,
  saveMetaCache,
  getChampionCache,
  getAugmentCache,
  getItemCache,
  clearMetaCache,
  AugmentInfo,
  ItemInfo
} from './meta'
import { apiClient } from './apiClient'
import { clusterBuilds } from './itemArchetypes'
import { mapGame, importGamesForPuuid, setChampionNames, getChampionNames } from './sync'
import { autoUpdater } from 'electron-updater'

protocol.registerSchemesAsPrivileged([
  { scheme: 'mayhem-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
const archetypeCache = new Map<string, any[]>()
let workerRunning = false
let syncInProgress = false
let syncCancelled = false
let syncAccum = { imported: 0, playerssynced: 0 }
let backendProcess: Electron.UtilityProcess | null = null
let backendReady = false
let windowLoaded = false

function maybeSignalReady() {
  if (!backendReady || !windowLoaded) return
  mainWindow?.webContents.send('db-ready')
  refreshMetadata().catch(() => { mainWindow?.webContents.send('assets-ready') })
  ensureChampionNames()
  repairIncompleteMatches().catch(() => {})
}

const CLIENT_ID = `electron-${os.hostname()}-${process.pid}`

function spawnLocalBackend(): void {
  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3847'
  let hostname: string
  try { hostname = new URL(backendUrl).hostname } catch { backendReady = true; return }
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') { backendReady = true; return }

  const serverPath = join(process.cwd(), 'dist-server', 'server-entry.js')
  if (!fs.existsSync(serverPath)) {
    console.warn('[backend] dist-server/server-entry.js not found — run: npm run server:build')
    backendReady = true
    return
  }

  backendProcess = utilityProcess.fork(serverPath, [], {
    stdio: 'pipe',
    env: { ...process.env },
  })
  backendProcess.stdout?.on('data', (d: Buffer) => process.stdout.write('[backend] ' + d))
  backendProcess.stderr?.on('data', (d: Buffer) => process.stderr.write('[backend] ' + d))
  backendProcess.on('exit', (code: number) => console.log(`[backend] exited (${code})`))
  backendProcess.on('message', (msg: unknown) => {
    if ((msg as any)?.type === 'ready') { backendReady = true; maybeSignalReady() }
  })
}

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

  // Fetch item data from CommunityDragon
  const items: Record<number, ItemInfo> = {}
  try {
    const itemsRes = await axios.get<any[]>(`${CDRAGON_PLUGIN}/v1/items.json`, { timeout: 15000 })
    for (const item of itemsRes.data) {
      if (!item.id || !item.name) continue
      const cats: string[] = item.categories ?? []
      if (cats.includes('Consumable') || cats.includes('Trinket')) continue
      if ((item.priceTotal ?? 0) < 700) continue
      const iconRaw: string = item.iconPath ?? ''
      const iconUrl = iconRaw
        ? `${CDRAGON_PLUGIN}/${iconRaw.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase()}`
        : ''
      const category = cats.includes('Boots') ? 'Boots' : (cats[0] ?? '')
      items[item.id] = { id: item.id, name: item.name, iconPath: iconUrl, category }
    }
  } catch (e) {
    console.warn('[meta] failed to fetch items:', (e as Error).message)
  }

  const imageCacheDir = join(app.getPath('userData'), 'image-cache')
  const championIds = Object.keys(champions)
  const augmentList = Object.values(augments).filter((aug) => aug.iconPath)
  const itemList = Object.values(items).filter((it) => it.iconPath)
  const total = championIds.length + augmentList.length + itemList.length
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

  await Promise.all(itemList.map(async (item) => {
    const dest = join(imageCacheDir, 'item-icons', `${item.id}.png`)
    if (await downloadToCache(item.iconPath, dest)) {
      item.iconPath = `mayhem-asset://item-icons/${item.id}.png`
    }
    mainWindow?.webContents.send('assets-progress', { done: ++done, total })
  }))

  saveMetaCache(champions, augments, items)
  console.log(`[meta] saved: ${Object.keys(champions).length} champions, ${Object.keys(augments).length} augments, ${Object.keys(items).length} items`)
  setChampionNames(champions)
  archetypeCache.clear()
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

function startSyncWorker(): void {
  if (workerRunning) return
  workerRunning = true
  syncWorker().finally(() => { workerRunning = false })
}

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

    let puuid: string | null = null
    let claimed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ;({ puuid } = await apiClient.claimNextJob(CLIENT_ID))
        claimed = true
        break
      } catch (err) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 5_000))
        } else {
          console.warn('[sync] backend unreachable after retries, stopping worker:', (err as Error).message)
          if (draining && syncInProgress) {
            syncInProgress = false
            mainWindow?.webContents.send('sync-complete', { ...syncAccum, reason: 'error' })
          }
          return
        }
      }
    }
    if (!claimed) return

    if (!puuid) {
      if (draining && syncInProgress) {
        syncInProgress = false
        mainWindow?.webContents.send('sync-complete', syncAccum)
      }
      return
    }

    const playerName = (await apiClient.playerName(puuid).catch(() => null)) ?? puuid.slice(0, 8) + '…'

    try {
      const { imported, fetchFailed } = await importGamesForPuuid(puuid, () => syncCancelled)
      if (fetchFailed) {
        console.warn(`[sync] no ARAM history for ${playerName}, skipping`)
        await apiClient.completeJob(puuid)
      } else {
        await apiClient.completeJob(puuid)
        if (draining) {
          syncAccum.playerssynced++
          if (imported > 0) syncAccum.imported += imported
        }
        const { total: queueRemaining } = await apiClient.queueStatus()
        console.log(`[sync] ${playerName}: ${imported} new game${imported !== 1 ? 's' : ''} (${queueRemaining} remaining in queue)`)
        mainWindow?.webContents.send('sync-progress', {
          puuid,
          playerName,
          gamesAdded: syncAccum.imported,
          playersChecked: syncAccum.playerssynced,
          queueRemaining,
        })
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
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F5' || (input.key === 'r' && input.control)) {
        event.preventDefault()
      }
    })
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  spawnLocalBackend()
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

  if (!is.dev) autoUpdater.checkForUpdatesAndNotify()

  mainWindow!.webContents.once('did-finish-load', () => {
    windowLoaded = true
    maybeSignalReady()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { backendProcess?.kill(); backendProcess = null })

app.on('window-all-closed', () => {
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
  if (workerRunning) return { started: false, reason: 'already-running' }
  syncCancelled = false
  syncInProgress = true
  syncAccum = { imported: 0, playerssynced: 0 }
  await apiClient.enqueuePlayer(summoner.puuid)
  mainWindow?.webContents.send('sync-started')
  const { total } = await apiClient.queueStatus()
  console.log(`[sync] started — ${total} player${total !== 1 ? 's' : ''} in queue`)
  startSyncWorker()
  return { started: true }
})

ipcMain.handle('lcu:fullSync', async () => {
  const summoner = await getCurrentSummoner()
  if (!summoner) return { started: false, reason: 'no-summoner' }
  if (workerRunning) return { started: false, reason: 'already-running' }
  syncCancelled = false
  syncInProgress = true
  syncAccum = { imported: 0, playerssynced: 0 }
  await apiClient.clearQueue()
  await apiClient.invalidateSyncTimes()
  await apiClient.enqueuePlayer(summoner.puuid)
  mainWindow?.webContents.send('sync-started')
  const { total } = await apiClient.queueStatus()
  console.log(`[sync] full reload — ${total} player${total !== 1 ? 's' : ''} in queue`)
  startSyncWorker()
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
ipcMain.handle('db:playerBulkStats', (_e, puuids: string[], patches?: string[]) => apiClient.playerBulkStats(puuids, patches))
ipcMain.handle('db:championStats', (_e, puuid?: string, patches?: string[]) => apiClient.championStats(puuid, patches))
ipcMain.handle('db:recentMatches', (_e, limit?: number, puuid?: string, patches?: string[]) => apiClient.recentMatches(limit, puuid, patches))
ipcMain.handle('db:winRateTrend', (_e, puuid?: string, days?: number) => apiClient.winRateTrend(puuid, days))
ipcMain.handle('db:groupSummary', () => apiClient.groupSummary())
ipcMain.handle('db:championCache', () => apiClient.championCache())
ipcMain.handle('db:augmentCache', () => getAugmentCache())
ipcMain.handle('db:itemCache', () => getItemCache())
ipcMain.handle('db:augmentStats', async (_e, puuid?: string, championId?: number, patches?: string[]) => {
  const stats = await apiClient.augmentStats(puuid, championId, patches)
  const cache = getAugmentCache()
  return stats.map((s: any) => ({ ...s, iconPath: cache[s.augmentId]?.iconPath ?? s.iconPath, rarity: cache[s.augmentId]?.rarity ?? s.rarity }))
})
ipcMain.handle('db:augmentChampionStats', (_e, augmentId: number, puuid?: string, patches?: string[]) => apiClient.augmentChampionStats(augmentId, puuid, patches))
ipcMain.handle('db:searchPlayers', (_e, query: string) => apiClient.searchPlayers(query))
ipcMain.handle('db:coplayerStats', (_e, puuid: string, patches?: string[]) => apiClient.coplayerStats(puuid, patches))

ipcMain.handle('db:itemBuilds', async (_e, championId: number, patches?: string[]) => {
  const cache = getItemCache()
  const allowedIds = Object.entries(cache)
    .filter(([, v]) => v.category !== 'Boots')
    .map(([k]) => Number(k))
  const builds = await apiClient.itemBuilds(championId, patches, allowedIds)
  return (builds as any[]).map((b) => ({
    ...b,
    items: (b.build as number[]).map((id) => ({
      id,
      name: cache[id]?.name ?? `Item ${id}`,
      iconPath: cache[id]?.iconPath ?? '',
      category: cache[id]?.category ?? '',
    }))
  }))
})

ipcMain.handle('db:itemPickRates', async (_e, championId: number, patches?: string[]) => {
  const result = await apiClient.itemPickRates(championId, patches)
  const cache = getItemCache()
  return {
    totalGames: result.totalGames,
    items: (result.items as any[])
      .filter((p) => cache[p.itemId])
      .map((p) => ({
        ...p,
        name: cache[p.itemId].name,
        iconPath: cache[p.itemId].iconPath,
        category: cache[p.itemId].category,
      })),
  }
})

ipcMain.handle('db:itemArchetypes', async (_e, championId: number, patches?: string[]) => {
  const key = `${championId}:${patches?.join(',') ?? ''}`
  if (archetypeCache.has(key)) return archetypeCache.get(key)

  const cache = getItemCache()
  const bootIds = Object.entries(cache)
    .filter(([, v]) => v.category === 'Boots')
    .map(([k]) => Number(k))

  const rawBuilds = await apiClient.itemBuildsForArchetypes(championId, patches, bootIds)
  const enriched = (rawBuilds as any[]).map((b) => ({
    ...b,
    items: (b.build as number[]).map((id) => ({
      id,
      name: cache[id]?.name ?? `Item ${id}`,
      iconPath: cache[id]?.iconPath ?? '',
      category: cache[id]?.category ?? '',
    })),
  }))
  const validItemNames = new Set(Object.values(cache).map(v => v.name.toLowerCase()))
  const archetypes = clusterBuilds(enriched, validItemNames)

  // attach per-path boots
  const openerIds = archetypes.map(a => a.openingId)
  const bootsData: { openerId: number; bootId: number; picks: number }[] =
    openerIds.length > 0 && bootIds.length > 0
      ? await apiClient.itemBootsByOpener(championId, openerIds, bootIds, patches).catch(() => [])
      : []

  const topBoot = new Map<number, number>()
  for (const r of bootsData) {
    if (!topBoot.has(r.openerId)) topBoot.set(r.openerId, r.bootId)
  }

  const result = archetypes.map(a => {
    const bootId = topBoot.get(a.openingId) ?? null
    return {
      ...a,
      bootId,
      bootItem: bootId != null
        ? { id: bootId, name: cache[bootId]?.name ?? `Item ${bootId}`, iconPath: cache[bootId]?.iconPath ?? '', category: 'Boots' }
        : null,
    }
  })
  archetypeCache.set(key, result)
  return result
})

const recentsPath = () => join(app.getPath('userData'), 'mayhem-recents.json')
ipcMain.handle('recents:load', () => {
  try { return JSON.parse(fs.readFileSync(recentsPath(), 'utf-8')) }
  catch { return [] }
})
ipcMain.handle('recents:save', (_e, entries: unknown) => {
  fs.writeFileSync(recentsPath(), JSON.stringify(entries), 'utf-8')
})

ipcMain.handle('lcu:currentGame', async () => {
  if (!isClientRunning()) return null
  const session = await getGameflowSession()
  if (!session) return null
  const { phase, gameData } = session as any

  if (phase === 'ChampSelect') {
    const cs = await getChampSelectSession()
    if (!cs) return { phase }
    const mapCS = (p: any) => ({
      puuid: p.puuid,
      championId: p.championId,
      summonerName: p.gameName ? `${p.gameName}#${p.tagLine}` : '',
    })
    return {
      phase,
      myTeam: (cs as any).myTeam.map(mapCS),
      theirTeam: (cs as any).theirTeam.map(mapCS),
    }
  }

  if ((phase === 'InProgress' || phase === 'EndOfGame') && gameData) {
    const mapP = (p: any) => ({
      puuid: p.puuid,
      championId: p.championId,
      summonerName: p.summonerName || p.riotId || '',
      augments: [p.playerAugment1, p.playerAugment2, p.playerAugment3,
                 p.playerAugment4, p.playerAugment5, p.playerAugment6]
                 .filter((a): a is number => !!a),
    })
    const summoner = await getCurrentSummoner()
    const myPuuid = summoner?.puuid
    const teamOne = (gameData.teamOne ?? []).map(mapP)
    const teamTwo = (gameData.teamTwo ?? []).map(mapP)
    const onTeamOne = myPuuid ? teamOne.some((p) => p.puuid === myPuuid) : true
    return {
      phase,
      myTeam: onTeamOne ? teamOne : teamTwo,
      theirTeam: onTeamOne ? teamTwo : teamOne,
    }
  }

  return { phase }
})

ipcMain.handle('lcu:syncCurrentGame', async (_e, puuids: string[]) => {
  if (!Array.isArray(puuids) || puuids.length === 0) return { ok: false }
  await apiClient.enqueuePriority(puuids)
  startSyncWorker()
  return { ok: true }
})

ipcMain.handle('db:currentSummoner', async () => {
  if (!isClientRunning()) return null
  return getCurrentSummoner()
})

ipcMain.handle('meta:refresh', async () => {
  clearMetaCache()
  await refreshMetadata()
  return {
    champions: Object.keys(getChampionCache()).length,
    augments: Object.keys(getAugmentCache()).length,
    items: Object.keys(getItemCache()).length,
  }
})

ipcMain.handle('overlay:captureScreen', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 1920, height: 1080 },
  })
  const lol = sources.find(s => /league.of.legends/i.test(s.name)) ?? sources[0]
  return lol?.thumbnail.toDataURL() ?? null
})

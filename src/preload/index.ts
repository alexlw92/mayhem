import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  lcu: {
    status: () => ipcRenderer.invoke('lcu:status'),
    sync: (puuid?: string) => ipcRenderer.invoke('lcu:sync', puuid),
    fullSync: (puuid?: string) => ipcRenderer.invoke('lcu:fullSync', puuid),
    syncStatus: () => ipcRenderer.invoke('lcu:syncStatus'),
    currentSummoner: () => ipcRenderer.invoke('db:currentSummoner'),
    syncPlayer: (puuid: string) => ipcRenderer.invoke('lcu:syncPlayer', puuid),
    stopSync: () => ipcRenderer.invoke('lcu:stopSync'),
    lookupPlayer: (gameName: string, tagLine: string) =>
      ipcRenderer.invoke('lcu:lookupPlayer', gameName, tagLine),
    currentGame: () => ipcRenderer.invoke('lcu:currentGame'),
    syncCurrentGame: (puuids: string[]) => ipcRenderer.invoke('lcu:syncCurrentGame', puuids),
    captureScreen: () => ipcRenderer.invoke('overlay:captureScreen'),
    ocrScreen: () => ipcRenderer.invoke('overlay:ocrScreen') as Promise<{ text: string | null; dataUrl: string | null }>
  },
  db: {
    patches: () => ipcRenderer.invoke('db:patches'),
    playerStats: (patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:playerStats', patches, queueId),
    playerOneStats: (puuid: string, patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:playerOneStats', puuid, patches, queueId),
    playerBulkStats: (puuids: string[], patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:playerBulkStats', puuids, patches, queueId),
    championStats: (puuid?: string, patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:championStats', puuid, patches, queueId),
    recentMatches: (limit?: number, puuid?: string, patches?: string[], queueId?: number) =>
      ipcRenderer.invoke('db:recentMatches', limit, puuid, patches, queueId),
    championCache: () => ipcRenderer.invoke('db:championCache'),
    augmentCache: () => ipcRenderer.invoke('db:augmentCache'),
    augmentStats: (puuid?: string, championId?: number, patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:augmentStats', puuid, championId, patches, queueId),
    augmentChampionStats: (augmentId: number, puuid?: string, patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:augmentChampionStats', augmentId, puuid, patches, queueId),
    searchPlayers: (query: string) => ipcRenderer.invoke('db:searchPlayers', query),
    coplayerStats: (puuid: string, patches?: string[], queueId?: number) => ipcRenderer.invoke('db:coplayerStats', puuid, patches, queueId),
    itemSummary: (championId: number, patches?: string[], queueId = 2400) => ipcRenderer.invoke('db:itemSummary', championId, patches, queueId),
    eloHistory: (puuid: string, queueId = 2400) => ipcRenderer.invoke('db:eloHistory', puuid, queueId),
    eloLeaderboard: (queueId = 2400) => ipcRenderer.invoke('db:eloLeaderboard', queueId),
    playerPerformance: (puuid: string, patches?: string[], queueId = 2400) =>
      ipcRenderer.invoke('db:playerPerformance', puuid, patches, queueId),
  },
  meta: {
    refresh: () => ipcRenderer.invoke('meta:refresh')
  },
  recents: {
    load: () => ipcRenderer.invoke('recents:load'),
    save: (entries: unknown) => ipcRenderer.invoke('recents:save', entries),
  },
  app: {
    reload: () => ipcRenderer.invoke('app:reload'),
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

// Pipe main-process logs into renderer DevTools
ipcRenderer.on('main-log', (_e, level: string, msg: string) => {
  if (level === 'warn') console.warn('[main]', msg)
  else if (level === 'error') console.error('[main]', msg)
  else console.log('[main]', msg)
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

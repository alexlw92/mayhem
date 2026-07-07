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
    lookupPlayer: (gameName: string, tagLine: string) =>
      ipcRenderer.invoke('lcu:lookupPlayer', gameName, tagLine)
  },
  db: {
    patches: () => ipcRenderer.invoke('db:patches'),
    playerStats: (patches?: string[]) => ipcRenderer.invoke('db:playerStats', patches),
    playerOneStats: (puuid: string, patches?: string[]) => ipcRenderer.invoke('db:playerOneStats', puuid, patches),
    championStats: (puuid?: string, patches?: string[]) => ipcRenderer.invoke('db:championStats', puuid, patches),
    recentMatches: (limit?: number, puuid?: string, patches?: string[]) =>
      ipcRenderer.invoke('db:recentMatches', limit, puuid, patches),
    winRateTrend: (puuid?: string, days?: number) =>
      ipcRenderer.invoke('db:winRateTrend', puuid, days),
    groupSummary: () => ipcRenderer.invoke('db:groupSummary'),
    championCache: () => ipcRenderer.invoke('db:championCache'),
    augmentCache: () => ipcRenderer.invoke('db:augmentCache'),
    augmentStats: (puuid?: string, championId?: number, patches?: string[]) => ipcRenderer.invoke('db:augmentStats', puuid, championId, patches),
    searchPlayers: (query: string) => ipcRenderer.invoke('db:searchPlayers', query)
  },
  meta: {
    refresh: () => ipcRenderer.invoke('meta:refresh')
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

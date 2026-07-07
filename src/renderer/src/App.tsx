import { useState, useEffect, useCallback } from 'react'
import Players from './pages/Players'
import Champions from './pages/Champions'
import Augments from './pages/Augments'
import './App.css'

type Page = 'players' | 'champions' | 'augments'

export type PatchFilter = string[] | undefined

const api = (window as any).api

export interface Player {
  puuid: string
  summonerName: string
  games: number
  syncedFull: boolean
}

export default function App() {
  const [page, setPage] = useState<Page>('players')
  const [clientRunning, setClientRunning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [lastSync, setLastSync] = useState<string>('')
  const [players, setPlayers] = useState<Player[]>([])
  const [syncProgress, setSyncProgress] = useState<{ playerName: string; totalImported: number; playersSearched: number } | null>(null)
  const [patches, setPatches] = useState<string[]>([])
  const [selectedPatches, setSelectedPatches] = useState<string[] | null>(null)
  const [augmentChampionId, setAugmentChampionId] = useState<number | undefined>(undefined)
  const [patchExpanded, setPatchExpanded] = useState(false)
  const [selectedPlayerPuuid, setSelectedPlayerPuuid] = useState<string | null>(null)
  const [selectedPlayerName, setSelectedPlayerName] = useState<string | null>(null)
  const [dbReady, setDbReady] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)
  const [assetsReady, setAssetsReady] = useState(false)
  const [assetsProgress, setAssetsProgress] = useState<{ done: number; total: number } | null>(null)


  const refreshPlayers = useCallback(async () => {
    try {
      const stats = await api.db.playerStats()
      setPlayers((stats as any[]).filter((s) => s.syncedFull))
    } catch { /* silent */ }
  }, [])

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.lcu.status()
      setClientRunning(status?.running ?? false)
    } catch { /* silent — LCU may not be running */ }
  }, [])

  const handleSync = useCallback(async () => {
    const result = await api.lcu.sync()
    if (result.started === false) {
      setLastSync(result.reason === 'no-summoner' ? 'Client not ready' : 'Sync already running…')
      setTimeout(() => setLastSync(''), 3000)
    }
  }, [])

  const handleStopSync = useCallback(async () => {
    setStopping(true)
    await api.lcu.stopSync()
  }, [])

  const handleFullSync = useCallback(async () => {
    const result = await api.lcu.fullSync()
    if (result?.started === false && result?.reason === 'no-summoner') {
      setLastSync('Client not ready')
      setTimeout(() => setLastSync(''), 3000)
    }
  }, [])

  useEffect(() => {
    const unsubReady = api.on('db-ready', () => setDbReady(true))
    const unsubAssetsReady = api.on('assets-ready', () => setAssetsReady(true))
    const unsubAssetsProgress = api.on('assets-progress', (data: { done: number; total: number }) => {
      setAssetsProgress(data)
    })
    const unsubDbError = api.on('db-error', (msg: string) => setDbError(msg))
    return () => { unsubReady(); unsubAssetsReady(); unsubAssetsProgress(); unsubDbError() }
  }, [])

  useEffect(() => {
    if (!dbReady) return
    const fallback = setTimeout(() => setAssetsReady(true), 10_000)
    return () => clearTimeout(fallback)
  }, [dbReady])

  useEffect(() => {
    if (!dbReady) return
    checkStatus()
    refreshPlayers()
    api.db.patches().then((p: string[]) => {
      setPatches(p)
      setSelectedPatches(p.slice(0, 1))
    }).catch(() => {})
    api.lcu.syncStatus().then((s: { syncing: boolean }) => setSyncing(s.syncing)).catch(() => {})

    const interval = setInterval(checkStatus, 10_000)

    const unsubStarted = api.on('sync-started', () => {
      setSyncing(true)
      setSyncProgress(null)
      setLastSync('')
    })

    const unsubProgress = api.on('sync-progress', (data: { playerName: string; totalImported: number; playersSearched: number }) => {
      setSyncProgress(data)
    })

    const unsubComplete = api.on('sync-complete', (data: { imported: number; playerssynced: number; reason?: string }) => {
      setSyncing(false)
      setStopping(false)
      setSyncProgress(null)
      if (data.reason === 'client-offline') {
        setLastSync('Client offline')
      } else if (data.reason === 'no-summoner') {
        setLastSync('Client not ready')
      } else if (data.reason === 'cancelled') {
        setLastSync('Sync stopped')
      } else if (data.reason === 'error') {
        setLastSync('Sync error — check console')
      } else {
        const parts: string[] = []
        if (data.imported > 0) parts.push(`${data.imported} new game${data.imported !== 1 ? 's' : ''}`)
        if (data.playerssynced > 0) parts.push(`${data.playerssynced} player${data.playerssynced !== 1 ? 's' : ''} checked`)
        setLastSync(parts.length ? parts.join(', ') : 'Up to date')
      }
      refreshPlayers()
      api.db.patches().then((p: string[]) => {
        setPatches(p)
        setSelectedPatches((cur) => (cur ?? []).length ? cur : p.slice(0, 1))
      }).catch(() => {})
      setTimeout(() => setLastSync(''), 8000)
    })

    const unsubAutoSync = api.on('matches-synced', (data: { imported: number; playerssynced: number }) => {
      const parts: string[] = []
      if (data.imported > 0) parts.push(`${data.imported} new game${data.imported !== 1 ? 's' : ''}`)
      if (data.playerssynced > 0) parts.push(`${data.playerssynced} player${data.playerssynced !== 1 ? 's' : ''}`)
      setLastSync(`Auto-synced: ${parts.join(', ')}`)
      refreshPlayers()
      setTimeout(() => setLastSync(''), 5000)
    })

    return () => {
      clearInterval(interval)
      unsubStarted()
      unsubProgress()
      unsubComplete()
      unsubAutoSync()
    }
  }, [dbReady, checkStatus, refreshPlayers])

  const navItems: { id: Page; label: string; icon: string }[] = [
    { id: 'players', label: 'Players', icon: '👤' },
    { id: 'champions', label: 'Champions', icon: '🛡' },
    { id: 'augments', label: 'Augments', icon: '✦' },
  ]

  if (dbError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, fontFamily: 'inherit' }}>
        <div style={{ fontSize: 18, color: 'var(--text-primary)' }}>MAYHEM</div>
        <div style={{ color: 'var(--red)' }}>Database error</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{dbError}</div>
      </div>
    )
  }

  if (!dbReady || !assetsReady) {
    const progress = assetsProgress
    const label = assetsProgress
      ? `Loading assets… ${assetsProgress.done} / ${assetsProgress.total}`
      : dbReady
        ? 'Loading assets…'
        : 'Connecting to database…'

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
        <div style={{ fontSize: 18, color: 'var(--text-primary)' }}>MAYHEM</div>
        <div>{label}</div>
        {progress && (
          <div style={{ width: 240, height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="logo">MAYHEM</div>
          <div className="logo-sub">ARAM Stats</div>
        </div>

        <ul className="nav-list">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => {
                  setPage(item.id)
                  if (item.id === 'players') { setSelectedPlayerPuuid(null); setSelectedPlayerName(null) }
                }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
              {item.id === 'players' && page === 'players' && selectedPlayerName && (
                <div className="nav-subtab">↳ {selectedPlayerName.split('#')[0]}</div>
              )}
            </li>
          ))}
        </ul>

        <div className="sidebar-patch">
          <div className="sidebar-patch-header">
            <span className="sidebar-patch-label">Patch</span>
            {patches.length > 0 && selectedPatches !== null && (
              <button
                className="sidebar-patch-all"
                onClick={() => setSelectedPatches(selectedPatches.length === patches.length ? patches.slice(0, 2) : patches)}
              >
                {selectedPatches.length === patches.length ? 'reset' : 'all'}
              </button>
            )}
          </div>
          {patches.length === 0 ? (
            <div className="sidebar-patch-empty">Sync to populate</div>
          ) : (
            <div className="sidebar-patch-list">
              {patches.slice(0, patchExpanded ? 8 : 4).map((p) => {
                const checked = selectedPatches?.includes(p) ?? false
                return (
                  <label key={p} className="sidebar-patch-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedPatches(
                        checked
                          ? (selectedPatches ?? []).filter((x) => x !== p)
                          : [...(selectedPatches ?? []), p]
                      )}
                    />
                    <span>{p}</span>
                  </label>
                )
              })}
              {patches.length > 4 && (
                <button
                  className="sidebar-patch-more"
                  onClick={() => setPatchExpanded((x) => !x)}
                >
                  {patchExpanded ? '− less' : `+ ${Math.min(patches.length - 4, 4)} more`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className={`client-status ${clientRunning ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {clientRunning ? 'Client Online' : 'Client Offline'}
          </div>
          <button
            className={`sync-btn${syncing && !stopping ? ' sync-btn--stop' : ''}`}
            onClick={syncing && !stopping ? handleStopSync : handleSync}
            disabled={(!clientRunning && !syncing) || stopping}
          >
            {stopping ? 'Stopping…' : syncing ? 'Stop Sync' : 'Sync Now'}
          </button>
          <button
            className="sync-btn sync-btn--full"
            onClick={handleFullSync}
            disabled={!clientRunning}
          >
            Full Reload
          </button>
          {syncing && syncProgress && (
            <div className="sync-progress">
              <div className="sync-progress-player">↳ {syncProgress.playerName}</div>
              <div className="sync-progress-stats">
                {syncProgress.totalImported} new · {syncProgress.playersSearched} players
              </div>
            </div>
          )}
          {!syncing && lastSync && <div className="sync-msg">{lastSync}</div>}
        </div>
      </nav>

      <main className="content">
        <div style={{ display: page === 'players' ? 'block' : 'none' }}>
          <Players
            onPlayersChange={refreshPlayers}
            selectedPatches={selectedPatches}
            selectedPuuid={selectedPlayerPuuid}
            onPlayerSelect={(puuid, name) => { setSelectedPlayerPuuid(puuid); setSelectedPlayerName(name) }}
            onPlayerDeselect={() => { setSelectedPlayerPuuid(null); setSelectedPlayerName(null) }}
          />
        </div>
        <div style={{ display: page === 'champions' ? 'block' : 'none' }}>
          <Champions
            players={players}
            selectedPatches={selectedPatches}
            onChampionClick={(championId) => { setAugmentChampionId(championId); setPage('augments') }}
          />
        </div>
        <div style={{ display: page === 'augments' ? 'block' : 'none' }}>
          <Augments
            players={players}
            selectedPatches={selectedPatches}
            initialChampionId={augmentChampionId}
            onMounted={() => setAugmentChampionId(undefined)}
          />
        </div>
      </main>
    </div>
  )
}

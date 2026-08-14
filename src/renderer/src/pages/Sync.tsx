import { useState, useEffect, useCallback } from 'react'

const api = (window as any).api

interface QueuedPlayer {
  puuid: string
  name: string
  queuedAt: number
  priority: number
  claimedBy: string | null
}

interface SyncLogEntry {
  id: number
  puuid: string
  summonerName: string
  gamesImported: number
  durationMs: number | null
  error: string | null
  syncedAt: number
}

interface MetricsData {
  matviewLastRefreshMs: number
  matviewRefreshInProgress: boolean
  pendingMatchCount: number
}

interface SyncProps {
  syncing: boolean
  stopping: boolean
  clientRunning: boolean
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function pendingColor(count: number): string {
  if (count === 0) return '#69db7c'
  if (count <= 50) return '#ffa94d'
  return 'var(--red, #ff6b6b)'
}

export default function Sync({ syncing, stopping, clientRunning }: SyncProps) {
  const [queueStatus, setQueueStatus] = useState<{ total: number; claimed: number } | null>(null)
  const [nextPlayers, setNextPlayers] = useState<QueuedPlayer[]>([])
  const [log, setLog] = useState<SyncLogEntry[]>([])
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [clearing, setClearing] = useState(false)

  const fetchAll = useCallback(async () => {
    try {
      const [status, players, entries, m] = await Promise.all([
        api.sync.queueStatus(),
        api.sync.nextPlayers(20),
        api.sync.log(100),
        api.metrics.get(),
      ])
      setQueueStatus(status)
      setNextPlayers(players)
      setLog(entries)
      setMetrics(m)
    } catch { /* backend not ready */ }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 5_000)
    return () => clearInterval(id)
  }, [fetchAll])

  const handleClearQueue = useCallback(async () => {
    if (!confirm('Clear the sync queue? All pending players will be removed.')) return
    setClearing(true)
    try {
      await api.sync.clearQueue()
      setQueueStatus(s => s ? { ...s, total: 0, claimed: 0 } : s)
      setNextPlayers([])
    } catch { /* ignore */ } finally {
      setClearing(false)
    }
  }, [])

  const handleForceRefresh = useCallback(async () => {
    try { await api.sync.forceRefresh() } catch { /* ignore */ }
  }, [])

  const handleStartSync = useCallback(async () => {
    try { await api.lcu.sync() } catch { /* ignore */ }
  }, [])

  const handlePauseSync = useCallback(async () => {
    try { await api.lcu.stopSync() } catch { /* ignore */ }
  }, [])

  const inProgress = metrics?.matviewRefreshInProgress ?? false
  const pending = metrics?.pendingMatchCount ?? 0
  const lastRefreshMs = metrics?.matviewLastRefreshMs ?? -1

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          className="sync-btn"
          onClick={handleStartSync}
          disabled={syncing}
          style={{ fontSize: 12 }}
        >
          ▶ Start Sync
        </button>
        <button
          className="sync-btn"
          onClick={handlePauseSync}
          disabled={!syncing || stopping}
          style={{ fontSize: 12 }}
        >
          {stopping ? 'Stopping…' : '⏸ Pause Sync'}
        </button>
        <button
          className="sync-btn"
          onClick={handleClearQueue}
          disabled={clearing || (queueStatus?.total ?? 0) === 0}
          style={{ fontSize: 12 }}
        >
          {clearing ? 'Clearing…' : '✕ Clear Queue'}
        </button>
        <button
          className="sync-btn"
          onClick={handleForceRefresh}
          disabled={inProgress}
          style={{ fontSize: 12 }}
        >
          {inProgress ? '↺ Refreshing…' : '↺ Force Refresh'}
        </button>
        <button
          className="sync-btn sync-btn--full"
          onClick={() => api.lcu.fullSync()}
          disabled={!clientRunning}
          style={{ fontSize: 12 }}
        >
          ↺ Full Reload
        </button>
        <div className={`client-status ${clientRunning ? 'online' : 'offline'}`} style={{ marginLeft: 'auto' }}>
          <span className="status-dot" />
          {clientRunning ? 'Client Online' : 'Client Offline'}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {/* Queue */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Queue</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-primary)' }}>
            {queueStatus?.total ?? '—'}
          </div>
          {queueStatus && queueStatus.claimed > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {queueStatus.claimed} in progress
            </div>
          )}
        </div>

        {/* In progress */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>In Progress</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-primary)' }}>
            {queueStatus?.claimed ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>active workers</div>
        </div>

        {/* Matview refresh */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Matview Refresh</span>
            {inProgress && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ffa94d', display: 'inline-block', animation: 'pulse 1s infinite' }} />
            )}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
            {lastRefreshMs === -1 ? 'Not yet run' : `last: ${lastRefreshMs.toLocaleString()}ms`}
          </div>
          <div style={{ fontSize: 12, color: pendingColor(pending) }}>
            {pending === 0 ? '✓ up to date' : `${pending} unprocessed`}
          </div>
        </div>
      </div>

      {/* Next up */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          Next Up
          <div style={{ flex: 1, height: 1, background: 'var(--bg-secondary)' }} />
        </div>
        {nextPlayers.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '8px 0' }}>Queue is empty</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {nextPlayers.map(p => (
              <div key={p.puuid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: 13 }}>
                <span style={{ width: 12, color: '#ffd43b', flexShrink: 0 }}>{p.priority > 0 ? '★' : ''}</span>
                <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.puuid.slice(0, 8) + '…'}</span>
                {p.claimedBy && (
                  <span style={{ fontSize: 11, color: '#ffa94d', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffa94d', display: 'inline-block' }} />
                    syncing
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{timeAgo(p.queuedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          Recent Activity
          <div style={{ flex: 1, height: 1, background: 'var(--bg-secondary)' }} />
        </div>
        {log.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '8px 0' }}>No sync history yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {log.map(entry => (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: 13 }}>
                <span style={{ width: 14, color: entry.error ? 'var(--red, #ff6b6b)' : '#69db7c', flexShrink: 0, fontWeight: 600 }}>
                  {entry.error ? '✗' : '✓'}
                </span>
                <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.summonerName || entry.puuid.slice(0, 8) + '…'}
                </span>
                {entry.error ? (
                  <span style={{ fontSize: 11, color: 'var(--red, #ff6b6b)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.error}>
                    {entry.error}
                  </span>
                ) : (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {entry.gamesImported > 0 ? `+${entry.gamesImported} game${entry.gamesImported !== 1 ? 's' : ''}` : '—'}
                    </span>
                    {entry.durationMs != null && (
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{entry.durationMs.toLocaleString()}ms</span>
                    )}
                  </>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{timeAgo(entry.syncedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

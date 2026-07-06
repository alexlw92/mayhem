import { useState, useEffect, useCallback } from 'react'

const api = (window as any).api

interface PlayerStats {
  puuid: string
  summonerName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDamage: number
  avgGold: number
  syncedFull: boolean
}

type Metric = 'wins' | 'winRate' | 'kda' | 'avgDamage' | 'avgGold'

const METRICS: { key: Metric; label: string }[] = [
  { key: 'winRate', label: 'Win Rate' },
  { key: 'wins', label: 'Wins' },
  { key: 'kda', label: 'KDA' },
  { key: 'avgDamage', label: 'Avg Damage' },
  { key: 'avgGold', label: 'Avg Gold' }
]

function getMetricValue(p: PlayerStats, metric: Metric): number {
  if (metric === 'wins') return p.wins
  if (metric === 'winRate') return p.wins / p.games
  if (metric === 'kda') return p.deaths === 0 ? 999 : (p.kills + p.assists) / p.deaths
  if (metric === 'avgDamage') return p.avgDamage
  if (metric === 'avgGold') return p.avgGold
  return 0
}

function formatMetric(p: PlayerStats, metric: Metric): string {
  const v = getMetricValue(p, metric)
  if (metric === 'winRate') return `${(v * 100).toFixed(1)}%`
  if (metric === 'kda') return v === 999 ? 'Perfect' : v.toFixed(2)
  if (metric === 'avgDamage' || metric === 'avgGold') return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

const MEDALS = ['🥇', '🥈', '🥉']

interface Props {
  selectedPuuid: string | null
  onSelectPlayer: (puuid: string | null) => void
}

export default function Leaderboard({ selectedPuuid, onSelectPlayer }: Props) {
  const [data, setData] = useState<PlayerStats[]>([])
  const [metric, setMetric] = useState<Metric>('winRate')
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const refresh = useCallback(() => {
    api.db.playerStats().then((d: PlayerStats[]) => {
      setData(d)
      setLoading(false)
    })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleSyncPlayer = useCallback(async (e: React.MouseEvent, puuid: string, name: string) => {
    e.stopPropagation()
    setSyncing(puuid)
    setSyncMsg('')
    const result = await api.lcu.syncPlayer(puuid)
    setSyncing(null)
    setSyncMsg(`${name}: ${result.imported} new game${result.imported !== 1 ? 's' : ''} imported`)
    setTimeout(() => setSyncMsg(''), 5000)
    refresh()
  }, [refresh])

  const handleAddPlayer = useCallback(async () => {
    const parts = addInput.trim().split('#')
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      setAddError('Enter a Riot ID in the format Name#TAG')
      return
    }
    const [gameName, tagLine] = parts
    setAddLoading(true)
    setAddError('')
    const summoner = await api.lcu.lookupPlayer(gameName, tagLine)
    if (!summoner?.puuid) {
      setAddError('Player not found — make sure the League client is open')
      setAddLoading(false)
      return
    }
    setSyncing(summoner.puuid)
    const result = await api.lcu.syncPlayer(summoner.puuid)
    setSyncing(null)
    setAddLoading(false)
    setAddInput('')
    setSyncMsg(`Added ${gameName}: ${result.imported} game${result.imported !== 1 ? 's' : ''} imported`)
    setTimeout(() => setSyncMsg(''), 5000)
    refresh()
  }, [addInput, refresh])

  const filtered = data.filter((p) =>
    p.summonerName.toLowerCase().includes(search.toLowerCase())
  )
  const sorted = [...filtered].sort(
    (a, b) => getMetricValue(b, metric) - getMetricValue(a, metric)
  )
  const maxVal = sorted.length > 0 ? getMetricValue(sorted[0], metric) : 1
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <h1 className="page-title">Leaderboard</h1>

      {/* Controls bar */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' }}>
        <input
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '5px 10px', fontSize: 12, outline: 'none', width: 160 }}
          placeholder="Search player…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>|</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Rank by</span>
        {METRICS.map((m) => (
          <button key={m.key} onClick={() => { setMetric(m.key); setPage(0) }} className={`lb-metric-btn ${metric === m.key ? 'active' : ''}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Add player */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
          Add a player by Riot ID
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 12px', fontSize: 13, outline: 'none', flex: 1 }}
            placeholder="Name#TAG"
            value={addInput}
            onChange={(e) => { setAddInput(e.target.value); setAddError('') }}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
          />
          <button
            onClick={handleAddPlayer}
            disabled={addLoading || !addInput.trim()}
            style={{ padding: '6px 16px', background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: addLoading ? 0.5 : 1 }}
          >
            {addLoading ? 'Looking up…' : 'Add & Sync'}
          </button>
        </div>
        {addError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{addError}</div>}
        {syncMsg && <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 6 }}>{syncMsg}</div>}
      </div>

      {/* Leaderboard rows */}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <div>No players yet</div>
          <p>Sync games to populate the leaderboard</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paginated.map((p, i) => {
            const globalRank = page * PAGE_SIZE + i
            const val = getMetricValue(p, metric)
            const pct = maxVal > 0 ? (val / maxVal) * 100 : 0
            const wr = p.wins / p.games
            const isSyncing = syncing === p.puuid
            return (
              <div
                key={p.puuid}
                className={`card lb-row ${selectedPuuid === p.puuid ? 'lb-selected' : ''}`}
                onClick={() => onSelectPlayer(selectedPuuid === p.puuid ? null : p.puuid)}
              >
                <div className="lb-rank">
                  {globalRank < 3 ? MEDALS[globalRank] : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>#{globalRank + 1}</span>}
                </div>

                <div className="lb-info">
                  <div className="lb-name">{p.summonerName.split('#')[0]}</div>
                  <div className="lb-tag">#{p.summonerName.split('#')[1] ?? ''}</div>
                </div>

                <div className="lb-games">
                  {p.games}G · <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%WR</span>
                  {p.syncedFull && <span className="synced-badge" title="Full history synced">✓</span>}
                </div>

                <div className="lb-bar-wrap">
                  <div className="lb-bar">
                    <div className="lb-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="lb-val">{formatMetric(p, metric)}</div>
                </div>

                <button
                  className="lb-sync-btn"
                  onClick={(e) => handleSyncPlayer(e, p.puuid, p.summonerName)}
                  disabled={isSyncing}
                  title="Sync this player's full match history"
                >
                  {isSyncing ? '…' : '↻'}
                </button>
              </div>
            )
          })}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0' }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="lb-page-btn"
              >← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Page {page + 1} of {totalPages} · {sorted.length} players
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="lb-page-btn"
              >Next →</button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .lb-metric-btn {
          padding: 4px 12px;
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .lb-metric-btn:hover { border-color: var(--blue); color: var(--text-primary); }
        .lb-metric-btn.active { background: var(--accent); border-color: var(--accent); color: #0a0e1a; font-weight: 700; }

        .lb-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .lb-row:hover { border-color: var(--blue); }
        .lb-selected { border-color: var(--accent) !important; }

        .lb-rank {
          width: 32px;
          font-size: 18px;
          text-align: center;
          flex-shrink: 0;
        }
        .lb-info {
          width: 150px;
          flex-shrink: 0;
          overflow: hidden;
        }
        .lb-name {
          font-weight: 600;
          color: var(--blue-light);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }
        .lb-tag {
          font-size: 11px;
          color: var(--text-muted);
        }
        .lb-games {
          width: 110px;
          font-size: 12px;
          color: var(--text-secondary);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .synced-badge {
          color: var(--green);
          font-size: 11px;
          font-weight: 700;
          margin-left: 2px;
        }
        .lb-bar-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .lb-bar {
          flex: 1;
          height: 6px;
          background: var(--bg-primary);
          border-radius: 3px;
          overflow: hidden;
        }
        .lb-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--blue), var(--accent));
          border-radius: 3px;
          transition: width 0.4s ease;
        }
        .lb-val {
          width: 65px;
          text-align: right;
          font-weight: 700;
          color: var(--accent);
          font-size: 14px;
          flex-shrink: 0;
        }
        .lb-sync-btn {
          width: 30px;
          height: 30px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg-primary);
          color: var(--text-secondary);
          font-size: 16px;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .lb-sync-btn:hover:not(:disabled) {
          border-color: var(--blue);
          color: var(--blue);
        }
        .lb-sync-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .lb-page-btn {
          padding: 5px 14px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .lb-page-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--text-primary); }
        .lb-page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      `}</style>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Player } from '../App'
import AugmentIcon from '../components/AugmentIcon'
import './Dashboard.css'

const api = (window as any).api

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerStats {
  puuid: string
  summonerName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDpm: number
  avgGold: number
  syncedFull: boolean
}

interface MatchParticipant {
  puuid: string
  summonerName: string
  championId: number
  championName: string
  teamId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  damageDealt: number
  augments: number[]
}

interface MatchView {
  gameId: number
  gameCreation: number
  gameDuration: number
  participants: MatchParticipant[]
}

interface ChampionStat {
  championId: number
  championName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDpm: number
}

interface AugmentStat {
  augmentId: number
  name: string
  rarity: number
  pickCount: number
  wins: number
  avgDpm: number
}

interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

type Metric = 'wins' | 'winRate' | 'kda' | 'avgDpm' | 'avgGold'
type Tab = 'matches' | 'champions' | 'augments'

const RECENT_KEY = 'mayhem-recent-players'
const MAX_RECENT = 5

function loadRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

function saveRecent(riotId: string): string[] {
  const next = [riotId, ...loadRecents().filter((r) => r.toLowerCase() !== riotId.toLowerCase())].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  return next
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function kda(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfect'
  return ((kills + assists) / deaths).toFixed(2)
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor(diff / 3_600_000)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  return 'Just now'
}

const METRICS: { key: Metric; label: string }[] = [
  { key: 'winRate', label: 'Win Rate' },
  { key: 'wins', label: 'Wins' },
  { key: 'kda', label: 'KDA' },
  { key: 'avgDpm', label: 'Avg DPM' },
  { key: 'avgGold', label: 'Avg Gold' },
]

function getMetricValue(p: PlayerStats, metric: Metric): number {
  if (metric === 'wins') return p.wins
  if (metric === 'winRate') return p.wins / p.games
  if (metric === 'kda') return p.deaths === 0 ? 999 : (p.kills + p.assists) / p.deaths
  if (metric === 'avgDpm') return p.avgDpm
  if (metric === 'avgGold') return p.avgGold
  return 0
}

function formatMetric(p: PlayerStats, metric: Metric): string {
  const v = getMetricValue(p, metric)
  if (metric === 'winRate') return `${(v * 100).toFixed(1)}%`
  if (metric === 'kda') return v === 999 ? 'Perfect' : v.toFixed(2)
  if (metric === 'avgDpm') return `${Math.round(v)}/min`
  if (metric === 'avgGold') return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

const MEDALS = ['🥇', '🥈', '🥉']

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  players: Player[]
  onPlayersChange: () => void
  selectedPatches: string[] | null
}

export default function Players({ players, onPlayersChange, selectedPatches }: Props) {
  const [selectedPuuid, setSelectedPuuid] = useState<string | null>(null)

  const selectedPlayer = players.find((p) => p.puuid === selectedPuuid) ?? null

  if (selectedPuuid && selectedPlayer) {
    return (
      <PlayerDetail
        puuid={selectedPuuid}
        player={selectedPlayer}
        selectedPatches={selectedPatches}
        onBack={() => setSelectedPuuid(null)}
      />
    )
  }

  return (
    <PlayerList
      players={players}
      onSelect={setSelectedPuuid}
      onPlayersChange={onPlayersChange}
      selectedPatches={selectedPatches}
    />
  )
}

// ─── Leaderboard view ─────────────────────────────────────────────────────────

function PlayerList({
  players,
  onSelect,
  onPlayersChange,
  selectedPatches,
}: {
  players: Player[]
  onSelect: (puuid: string) => void
  onPlayersChange: () => void
  selectedPatches: string[] | null
}) {
  const [data, setData] = useState<PlayerStats[]>([])
  const [metric, setMetric] = useState<Metric>('winRate')
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const [showRecents, setShowRecents] = useState(false)
  const PAGE_SIZE = 25

  const refresh = useCallback(() => {
    if (selectedPatches === null) return
    setRefreshing(true)
    api.db.playerStats(selectedPatches).then((d: PlayerStats[]) => {
      setData(d)
      setRefreshing(false)
    }).catch(() => setRefreshing(false))
  }, [selectedPatches])

  useEffect(() => { refresh() }, [refresh])

  const handleSyncPlayer = useCallback(async (e: React.MouseEvent, puuid: string, name: string) => {
    e.stopPropagation()
    setSyncing(puuid)
    setSyncMsg('')
    try {
      const result = await api.lcu.syncPlayer(puuid)
      setSyncMsg(`${name}: ${result.imported} new game${result.imported !== 1 ? 's' : ''} imported`)
    } catch {
      setSyncMsg(`${name}: sync failed`)
    }
    setSyncing(null)
    setTimeout(() => setSyncMsg(''), 5000)
    refresh()
    onPlayersChange()
  }, [refresh, onPlayersChange])

  const handleAddPlayer = useCallback(async () => {
    const parts = addInput.trim().split('#')
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      setAddError('Enter a Riot ID in the format Name#TAG')
      return
    }
    const [gameName, tagLine] = parts
    setAddLoading(true)
    setAddError('')
    try {
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
      setRecents(saveRecent(addInput.trim()))
      setAddInput('')
      setSyncMsg(`Added ${gameName}: ${result.imported} game${result.imported !== 1 ? 's' : ''} imported`)
      setTimeout(() => setSyncMsg(''), 5000)
      refresh()
      onPlayersChange()
    } catch {
      setAddError('An error occurred — check that the League client is open')
      setAddLoading(false)
      setSyncing(null)
    }
  }, [addInput, refresh, onPlayersChange])

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Players</h1>
        {refreshing && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Updating…</span>}
      </div>

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

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>Add a player by Riot ID</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 12px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
              placeholder="Name#TAG"
              value={addInput}
              onChange={(e) => { setAddInput(e.target.value); setAddError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
              onFocus={() => setShowRecents(true)}
              onBlur={() => setTimeout(() => setShowRecents(false), 150)}
            />
            {showRecents && recents.length > 0 && (
              <div className="recent-dropdown">
                <div className="recent-label">Recent</div>
                {recents.map((r) => (
                  <div
                    key={r}
                    className="recent-item"
                    onMouseDown={() => { setAddInput(r); setShowRecents(false) }}
                  >
                    {r}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleAddPlayer}
            disabled={addLoading || !addInput.trim()}
            style={{ padding: '6px 16px', background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: addLoading ? 0.5 : 1, flexShrink: 0 }}
          >
            {addLoading ? 'Looking up…' : 'Add & Sync'}
          </button>
        </div>
        {addError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{addError}</div>}
        {syncMsg && <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 6 }}>{syncMsg}</div>}
      </div>

      {sorted.length === 0 && !refreshing ? (
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
                className="card lb-row"
                onClick={() => onSelect(p.puuid)}
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
                  <div className="lb-bar"><div className="lb-bar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="lb-val">{formatMetric(p, metric)}</div>
                </div>
                <button
                  className="lb-sync-btn"
                  onClick={(e) => handleSyncPlayer(e, p.puuid, p.summonerName)}
                  disabled={isSyncing}
                  title="Sync this player"
                >
                  {isSyncing ? '…' : '↻'}
                </button>
              </div>
            )
          })}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0' }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="lb-page-btn">← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages} · {sorted.length} players</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="lb-page-btn">Next →</button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .lb-metric-btn { padding: 4px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s; }
        .lb-metric-btn:hover { border-color: var(--blue); color: var(--text-primary); }
        .lb-metric-btn.active { background: var(--accent); border-color: var(--accent); color: #0a0e1a; font-weight: 700; }
        .lb-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; transition: border-color 0.15s; }
        .lb-row:hover { border-color: var(--blue); }
        .lb-rank { width: 32px; font-size: 18px; text-align: center; flex-shrink: 0; }
        .lb-info { width: 150px; flex-shrink: 0; overflow: hidden; }
        .lb-name { font-weight: 600; color: var(--blue-light); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .lb-tag { font-size: 11px; color: var(--text-muted); }
        .lb-games { width: 110px; font-size: 12px; color: var(--text-secondary); flex-shrink: 0; display: flex; align-items: center; gap: 4px; }
        .synced-badge { color: var(--green); font-size: 11px; font-weight: 700; margin-left: 2px; }
        .lb-bar-wrap { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
        .lb-bar { flex: 1; height: 6px; background: var(--bg-primary); border-radius: 3px; overflow: hidden; }
        .lb-bar-fill { height: 100%; background: linear-gradient(90deg, var(--blue), var(--accent)); border-radius: 3px; transition: width 0.4s ease; }
        .lb-val { width: 65px; text-align: right; font-weight: 700; color: var(--accent); font-size: 14px; flex-shrink: 0; }
        .lb-sync-btn { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-secondary); font-size: 16px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .lb-sync-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
        .lb-sync-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .lb-page-btn { padding: 5px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s; }
        .lb-page-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--text-primary); }
        .lb-page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .recent-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; z-index: 100; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
        .recent-label { padding: 5px 10px 3px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .recent-item { padding: 7px 10px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
        .recent-item:hover { background: var(--bg-primary); color: var(--blue-light); }
      `}</style>
    </div>
  )
}

// ─── Individual player view ───────────────────────────────────────────────────

function PlayerDetail({ puuid, player, onBack, selectedPatches }: { puuid: string; player: Player; onBack: () => void; selectedPatches: string[] | null }) {
  const [tab, setTab] = useState<Tab>('matches')
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [matches, setMatches] = useState<MatchView[]>([])
  const [championStats, setChampionStats] = useState<ChampionStat[]>([])
  const [augmentStats, setAugmentStats] = useState<AugmentStat[]>([])
  const [augmentCache, setAugmentCache] = useState<Record<number, AugmentInfo>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    setChampionStats([])
    setAugmentStats([])
    Promise.all([
      api.db.playerStats(selectedPatches),
      api.db.recentMatches(20, puuid, selectedPatches),
      api.db.augmentCache(),
    ]).then(([allStats, m, cache]: [PlayerStats[], MatchView[], Record<number, AugmentInfo>]) => {
      setStats(allStats.find((s) => s.puuid === puuid) ?? null)
      setMatches(m)
      setAugmentCache(cache)
      setLoading(false)
    }).catch(() => { setLoading(false); setLoadError(true) })
  }, [puuid, selectedPatches])

  useEffect(() => {
    if (selectedPatches === null) return
    if (tab === 'champions' && championStats.length === 0) {
      api.db.championStats(puuid, selectedPatches).then(setChampionStats).catch(() => {})
    }
    if (tab === 'augments' && augmentStats.length === 0) {
      api.db.augmentStats(puuid, undefined, selectedPatches).then(setAugmentStats).catch(() => {})
    }
  }, [tab, puuid, selectedPatches, championStats.length, augmentStats.length])

  const backBtn = (
    <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
      ← Back
    </button>
  )

  if (loading) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>{backBtn}</div>
      <div className="empty-state"><div className="loader" /></div>
    </div>
  )

  if (loadError) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>{backBtn}</div>
      <div className="empty-state">Failed to load player data</div>
    </div>
  )

  const wr = stats ? stats.wins / stats.games : 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {backBtn}
        <h1 className="page-title" style={{ margin: 0 }}>{player.summonerName}</h1>
      </div>

      {stats && (
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <div className="card stat-card">
            <div className="card-title">Games</div>
            <div className="stat-value">{stats.games}</div>
            <div className="stat-label">{stats.wins}W {stats.games - stats.wins}L</div>
          </div>
          <div className="card stat-card">
            <div className="card-title">Win Rate</div>
            <div className={`stat-value ${wr >= 0.5 ? 'win' : 'loss'}`}>{(wr * 100).toFixed(1)}%</div>
            <div className="stat-label">{wr >= 0.5 ? 'Above' : 'Below'} 50%</div>
          </div>
          <div className="card stat-card">
            <div className="card-title">Avg KDA</div>
            <div className="stat-value kda">{kda(stats.kills, stats.deaths, stats.assists)}</div>
            <div className="stat-label">
              {(stats.kills / stats.games).toFixed(1)} /&nbsp;
              {(stats.deaths / stats.games).toFixed(1)} /&nbsp;
              {(stats.assists / stats.games).toFixed(1)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="card-title">Avg DPM</div>
            <div className="stat-value">{Math.round(stats.avgDpm)}</div>
            <div className="stat-label">Damage per minute</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['matches', 'champions', 'augments'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '7px 18px',
              background: tab === t ? 'var(--accent)' : 'var(--bg-card)',
              border: `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 6,
              color: tab === t ? '#0a0e1a' : 'var(--text-secondary)',
              fontWeight: tab === t ? 700 : 400,
              fontSize: 13,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'matches' && (
        matches.length === 0 ? (
          <div className="card"><div className="empty-state"><div>No games yet</div></div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.map((match) => (
              <MatchCard key={match.gameId} match={match} selectedPuuid={puuid} augments={augmentCache} />
            ))}
          </div>
        )
      )}

      {tab === 'champions' && (
        championStats.length === 0 ? (
          <div className="card"><div className="empty-state"><div>No champion data</div></div></div>
        ) : (
          <ChampionTable data={championStats} />
        )
      )}

      {tab === 'augments' && (
        augmentStats.length === 0 ? (
          <div className="card"><div className="empty-state"><div>No augment data</div></div></div>
        ) : (
          <AugmentTable data={augmentStats} augmentCache={augmentCache} />
        )
      )}
    </div>
  )
}

// ─── Champion sub-tab table ───────────────────────────────────────────────────

function ChampionTable({ data }: { data: ChampionStat[] }) {
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Champion</th>
            <th>Games</th>
            <th>Win Rate</th>
            <th>KDA</th>
            <th>K / D / A</th>
            <th>Avg DPM</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => {
            const wr = c.wins / c.games
            return (
              <tr key={c.championId}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img
                      src={`mayhem-asset://champion-icons/${c.championId}.png`}
                      alt={c.championName}
                      style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    {c.championName}
                  </div>
                </td>
                <td>{c.games}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 60, height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? 'var(--green)' : 'var(--red)', borderRadius: 3 }} />
                    </div>
                    <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="kda">{kda(c.kills, c.deaths, c.assists)}</td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  {(c.kills / c.games).toFixed(1)} / {(c.deaths / c.games).toFixed(1)} / {(c.assists / c.games).toFixed(1)}
                </td>
                <td>{Math.round(c.avgDpm)}/min</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Augment sub-tab table ────────────────────────────────────────────────────

function AugmentTable({ data, augmentCache }: { data: AugmentStat[]; augmentCache: Record<number, AugmentInfo> }) {
  const RARITY = ['Silver', 'Gold', 'Prismatic']
  const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Augment</th>
            <th>Rarity</th>
            <th>Picks</th>
            <th>Win Rate</th>
            <th>Avg DPM</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => {
            const wr = a.pickCount > 0 ? a.wins / a.pickCount : 0
            return (
              <tr key={a.augmentId}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AugmentIcon id={a.augmentId} augments={augmentCache} size={24} />
                    {a.name}
                  </div>
                </td>
                <td style={{ color: RARITY_COLOR[a.rarity] ?? RARITY_COLOR[0], fontSize: 12, fontWeight: 600 }}>
                  {RARITY[a.rarity] ?? 'Silver'}
                </td>
                <td>{a.pickCount}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 60, height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? 'var(--green)' : 'var(--red)', borderRadius: 3 }} />
                    </div>
                    <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td>{Math.round(a.avgDpm)}/min</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Match components (migrated from Dashboard.tsx) ──────────────────────────

function MatchCard({ match, selectedPuuid, augments }: { match: MatchView; selectedPuuid: string | null; augments: Record<number, AugmentInfo> }) {
  const blue = match.participants.filter((p) => p.teamId === 100)
  const red = match.participants.filter((p) => p.teamId === 200)
  const blueWon = blue[0]?.win ?? false
  const selectedTeamId = selectedPuuid ? match.participants.find((p) => p.puuid === selectedPuuid)?.teamId : null
  const [teamA, teamB] = selectedTeamId === 200 ? [red, blue] : [blue, red]
  const teamAWon = selectedTeamId === 200 ? !blueWon : blueWon

  return (
    <div className="card match-card">
      <div className="match-header">
        <span className={`result-badge ${teamAWon ? 'win' : 'loss'}`}>{teamAWon ? 'WIN' : 'LOSS'}</span>
        <span className="match-meta">{formatDuration(match.gameDuration)}</span>
        <span className="match-meta time-ago">{timeAgo(match.gameCreation)}</span>
      </div>
      <div className="match-teams">
        <TeamTable participants={teamA} won={teamAWon} selectedPuuid={selectedPuuid} augments={augments} />
        <div className="team-divider" />
        <TeamTable participants={teamB} won={!teamAWon} selectedPuuid={selectedPuuid} augments={augments} />
      </div>
    </div>
  )
}

function TeamTable({ participants, selectedPuuid, augments }: { participants: MatchParticipant[]; won: boolean; selectedPuuid: string | null; augments: Record<number, AugmentInfo> }) {
  return (
    <table className="team-table">
      <tbody>
        {participants.map((p) => (
          <tr key={p.puuid} className={p.puuid === selectedPuuid ? 'selected-player' : ''}>
            <td className="champ-cell" style={{ width: 28 }}>
              <img
                src={`mayhem-asset://champion-icons/${p.championId}.png`}
                alt={p.championName}
                className="champ-icon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </td>
            <td className="summoner-name" style={{ minWidth: 90, maxWidth: 120 }}>{p.summonerName}</td>
            <td>
              <div style={{ display: 'flex', gap: 2 }}>
                {p.augments.map((id) => <AugmentIcon key={id} id={id} augments={augments} size={18} />)}
              </div>
            </td>
            <td className="kda" style={{ whiteSpace: 'nowrap' }}>{p.kills}/{p.deaths}/{p.assists}</td>
            <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
              {(p.damageDealt / 1000).toFixed(1)}k
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

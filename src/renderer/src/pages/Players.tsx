import { useState, useEffect, useCallback } from 'react'
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

export interface ChampionStat {
  championId: number
  championName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDpm: number
}

export interface AugmentStat {
  augmentId: number
  name: string
  rarity: number
  pickCount: number
  wins: number
  avgDpm: number
}

export interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

type Tab = 'matches' | 'champions' | 'augments'
type ChampionSortKey = 'games' | 'winRate' | 'kda' | 'avgDpm'
type AugmentSortKey = 'pickCount' | 'winRate' | 'avgDpm'

const RECENT_KEY = 'mayhem-recent-players'
const MAX_RECENT = 10

interface RecentEntry { riotId: string; puuid: string }

function loadRecents(): RecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (!Array.isArray(raw) || typeof raw[0] === 'string') return []
    return raw as RecentEntry[]
  } catch { return [] }
}

function saveRecent(riotId: string, puuid: string): RecentEntry[] {
  const next = [{ riotId, puuid }, ...loadRecents().filter((r) => r.puuid !== puuid)].slice(0, MAX_RECENT)
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


// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  onPlayersChange: () => void
  selectedPatches: string[] | null
  selectedPuuid: string | null
  onPlayerSelect: (puuid: string, name: string) => void
  onPlayerDeselect: () => void
}

export default function Players({ onPlayersChange, selectedPatches, selectedPuuid, onPlayerSelect, onPlayerDeselect }: Props) {
  const [selectedPlayerData, setSelectedPlayerData] = useState<PlayerStats | null>(null)

  if (selectedPuuid && selectedPlayerData) {
    return (
      <PlayerDetail
        puuid={selectedPuuid}
        player={selectedPlayerData}
        selectedPatches={selectedPatches}
        onBack={() => { setSelectedPlayerData(null); onPlayerDeselect() }}
      />
    )
  }

  return (
    <PlayerList
      onSelect={(puuid, player) => { setSelectedPlayerData(player); onPlayerSelect(puuid, player.summonerName) }}
      onPlayersChange={onPlayersChange}
      selectedPatches={selectedPatches}
    />
  )
}

// ─── Recent player card ───────────────────────────────────────────────────────

function RecentPlayerCard({
  entry,
  selectedPatches,
  onSelect,
  onPlayersChange,
}: {
  entry: RecentEntry
  selectedPatches: string[] | null
  onSelect: (puuid: string, player: PlayerStats) => void
  onPlayersChange: () => void
}) {
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    if (selectedPatches === null) return
    api.db.playerOneStats(entry.puuid, selectedPatches).then(setStats).catch(() => {})
  }, [entry.puuid, selectedPatches])

  const handleSync = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await api.lcu.syncPlayer(entry.puuid)
      setSyncMsg(`${result.imported} new game${result.imported !== 1 ? 's' : ''}`)
      const fresh = await api.db.playerOneStats(entry.puuid, selectedPatches ?? undefined)
      setStats(fresh)
      onPlayersChange()
    } catch {
      setSyncMsg('sync failed')
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 4000)
  }, [entry.puuid, selectedPatches, onPlayersChange])

  const [name, tag] = entry.riotId.split('#')
  const wr = stats ? stats.wins / stats.games : null

  const placeholder: PlayerStats = {
    puuid: entry.puuid, summonerName: entry.riotId,
    games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
    avgDpm: 0, avgGold: 0, syncedFull: false,
  }

  return (
    <div className="card recent-card" onClick={() => onSelect(entry.puuid, stats ?? placeholder)}>
      <div className="recent-card-header">
        <div style={{ minWidth: 0 }}>
          <div className="recent-card-name">{name}</div>
          {tag && <div className="recent-card-tag">#{tag}</div>}
        </div>
        <button
          className="lb-sync-btn"
          onClick={handleSync}
          disabled={syncing}
          title="Sync player"
        >
          {syncing ? '…' : '↻'}
        </button>
      </div>
      {stats ? (
        <div className="recent-card-stats">
          <span>{stats.games}G</span>
          <span className={wr! >= 0.5 ? 'win' : 'loss'}>{((wr!) * 100).toFixed(0)}%WR</span>
          <span>{kda(stats.kills, stats.deaths, stats.assists)} KDA</span>
          <span style={{ color: 'var(--text-muted)' }}>{Math.round(stats.avgDpm)}/min</span>
        </div>
      ) : (
        <div className="recent-card-empty">Loading…</div>
      )}
      {syncMsg && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>{syncMsg}</div>}
    </div>
  )
}

// ─── Player list (recents-based) ──────────────────────────────────────────────

function PlayerList({
  onSelect,
  onPlayersChange,
  selectedPatches,
}: {
  onSelect: (puuid: string, player: PlayerStats) => void
  onPlayersChange: () => void
  selectedPatches: string[] | null
}) {
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [recents, setRecents] = useState<RecentEntry[]>(loadRecents)
  const [showRecents, setShowRecents] = useState(false)

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
      setSyncing(true)
      const result = await api.lcu.syncPlayer(summoner.puuid)
      setSyncing(false)
      setAddLoading(false)
      const riotId = `${gameName}#${tagLine}`
      const updated = saveRecent(riotId, summoner.puuid)
      setRecents(updated)
      setAddInput('')
      setSyncMsg(`Added ${gameName}: ${result.imported} game${result.imported !== 1 ? 's' : ''} imported`)
      setTimeout(() => setSyncMsg(''), 5000)
      onPlayersChange()
    } catch {
      setAddError('An error occurred — check that the League client is open')
      setAddLoading(false)
      setSyncing(false)
    }
  }, [addInput, onPlayersChange])

  const handleSelect = useCallback((puuid: string, player: PlayerStats) => {
    setRecents(saveRecent(player.summonerName, puuid))
    onSelect(puuid, player)
  }, [onSelect])

  return (
    <div>
      <h1 className="page-title">Players</h1>

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
                    key={r.puuid}
                    className="recent-item"
                    onMouseDown={() => { setAddInput(r.riotId); setShowRecents(false) }}
                  >
                    {r.riotId}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleAddPlayer}
            disabled={addLoading || syncing || !addInput.trim()}
            style={{ padding: '6px 16px', background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: (addLoading || syncing) ? 0.5 : 1, flexShrink: 0 }}
          >
            {addLoading ? 'Looking up…' : syncing ? 'Syncing…' : 'Add & Sync'}
          </button>
        </div>
        {addError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{addError}</div>}
        {syncMsg && <div style={{ color: 'var(--green)', fontSize: 12, marginTop: 6 }}>{syncMsg}</div>}
      </div>

      {recents.length === 0 ? (
        <div className="empty-state">
          <div>No recent players</div>
          <p>Add a player above to get started</p>
        </div>
      ) : (
        <div className="recent-cards-grid">
          {recents.map((r) => (
            <RecentPlayerCard
              key={r.puuid}
              entry={r}
              selectedPatches={selectedPatches}
              onSelect={handleSelect}
              onPlayersChange={onPlayersChange}
            />
          ))}
        </div>
      )}

      <style>{`
        .recent-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
        .recent-card { padding: 14px 16px; cursor: pointer; transition: border-color 0.15s; display: flex; flex-direction: column; gap: 8px; }
        .recent-card:hover { border-color: var(--blue); }
        .recent-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .recent-card-name { font-weight: 700; font-size: 15px; color: var(--blue-light); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .recent-card-tag { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
        .recent-card-stats { display: flex; flex-wrap: wrap; gap: 6px 10px; font-size: 12px; color: var(--text-secondary); }
        .recent-card-empty { font-size: 12px; color: var(--text-muted); }
        .lb-sync-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-secondary); font-size: 15px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .lb-sync-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
        .lb-sync-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .recent-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; z-index: 100; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
        .recent-label { padding: 5px 10px 3px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .recent-item { padding: 7px 10px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
        .recent-item:hover { background: var(--bg-primary); color: var(--blue-light); }
      `}</style>
    </div>
  )
}

// ─── Individual player view ───────────────────────────────────────────────────

function PlayerDetail({ puuid, player, onBack, selectedPatches }: { puuid: string; player: PlayerStats; onBack: () => void; selectedPatches: string[] | null }) {
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
      api.db.playerOneStats(puuid, selectedPatches),
      api.db.recentMatches(20, puuid, selectedPatches),
      api.db.augmentCache(),
    ]).then(([s, m, cache]: [PlayerStats | null, MatchView[], Record<number, AugmentInfo>]) => {
      setStats(s)
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

export function ChampionTable({ data }: { data: ChampionStat[] }) {
  const [sortKey, setSortKey] = useState<ChampionSortKey>('games')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const sorted = [...data].sort((a, b) => {
    const aVal = sortKey === 'winRate' ? a.wins / a.games
      : sortKey === 'kda' ? (a.kills + a.assists) / Math.max(1, a.deaths)
      : sortKey === 'avgDpm' ? a.avgDpm
      : a.games
    const bVal = sortKey === 'winRate' ? b.wins / b.games
      : sortKey === 'kda' ? (b.kills + b.assists) / Math.max(1, b.deaths)
      : sortKey === 'avgDpm' ? b.avgDpm
      : b.games
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal
  })

  const onSort = (key: ChampionSortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const arrow = (key: ChampionSortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  const thStyle = { cursor: 'pointer', userSelect: 'none' as const }

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Champion</th>
            <th style={thStyle} onClick={() => onSort('games')}>Games{arrow('games')}</th>
            <th style={thStyle} onClick={() => onSort('winRate')}>Win Rate{arrow('winRate')}</th>
            <th style={thStyle} onClick={() => onSort('kda')}>KDA{arrow('kda')}</th>
            <th>K / D / A</th>
            <th style={thStyle} onClick={() => onSort('avgDpm')}>Avg DPM{arrow('avgDpm')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
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

export function AugmentTable({ data, augmentCache }: { data: AugmentStat[]; augmentCache: Record<number, AugmentInfo> }) {
  const [sortKey, setSortKey] = useState<AugmentSortKey>('pickCount')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const sorted = [...data].sort((a, b) => {
    const aVal = sortKey === 'winRate' ? (a.pickCount > 0 ? a.wins / a.pickCount : 0)
      : sortKey === 'avgDpm' ? a.avgDpm
      : a.pickCount
    const bVal = sortKey === 'winRate' ? (b.pickCount > 0 ? b.wins / b.pickCount : 0)
      : sortKey === 'avgDpm' ? b.avgDpm
      : b.pickCount
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal
  })

  const onSort = (key: AugmentSortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const arrow = (key: AugmentSortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  const thStyle = { cursor: 'pointer', userSelect: 'none' as const }

  const RARITY = ['Silver', 'Gold', 'Prismatic']
  const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Augment</th>
            <th>Rarity</th>
            <th style={thStyle} onClick={() => onSort('pickCount')}>Picks{arrow('pickCount')}</th>
            <th style={thStyle} onClick={() => onSort('winRate')}>Win Rate{arrow('winRate')}</th>
            <th style={thStyle} onClick={() => onSort('avgDpm')}>Avg DPM{arrow('avgDpm')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
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

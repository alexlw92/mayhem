import { useState, useEffect, useCallback } from 'react'
import AugmentIcon from '../components/AugmentIcon'
import AugmentStatsTable from '../components/AugmentStatsTable'
import ChampionStatsTable from '../components/ChampionStatsTable'
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
  syncedAt: number
  elo: number | null
}

interface EloEntry {
  gameId: number
  elo_before: number
  elo_after: number
  delta: number
  gameCreation: number
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

export interface MatchView {
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
  wilsonScore: number
}

export interface AugmentStat {
  augmentId: number
  name: string
  rarity: number
  pickCount: number
  wins: number
  avgDpm: number
  wilsonScore: number
}

export interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

export interface CoplayerStat {
  puuid: string
  summonerName: string
  games: number
  wins: number
}

type Tab = 'matches' | 'champions' | 'augments' | 'coplayers' | 'elo'
type PlayerListView = 'recent' | 'leaderboard'

interface LeaderboardEntry {
  puuid: string
  summonerName: string
  elo: number
  gamesRated: number
  games: number
  wins: number
}
type CoplayerSortKey = 'games' | 'winRate'

const RECENT_KEY = 'mayhem-recent-players'
const MAX_RECENT = 10

interface RecentEntry { riotId: string; puuid: string }

async function loadRecents(): Promise<RecentEntry[]> {
  if (api?.recents) return (await api.recents.load()) ?? []
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (!Array.isArray(raw) || typeof raw[0] === 'string') return []
    return raw as RecentEntry[]
  } catch { return [] }
}

function persistRecents(entries: RecentEntry[]): void {
  if (api?.recents) { api.recents.save(entries); return }
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries))
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
  selectedMode?: number
  selectedPuuid: string | null
  onPlayerSelect: (puuid: string, name: string) => void
  onPlayerDeselect: () => void
  onAugmentClick?: (augmentId: number) => void
}

export default function Players({ onPlayersChange, selectedPatches, selectedMode, selectedPuuid, onPlayerSelect, onPlayerDeselect, onAugmentClick }: Props) {
  const [selectedPlayerData, setSelectedPlayerData] = useState<PlayerStats | null>(null)

  if (selectedPuuid && selectedPlayerData) {
    return (
      <PlayerDetail
        puuid={selectedPuuid}
        player={selectedPlayerData}
        selectedPatches={selectedPatches}
        selectedMode={selectedMode}
        onBack={() => { setSelectedPlayerData(null); onPlayerDeselect() }}
        onAugmentClick={onAugmentClick}
        onPlayerClick={(newPuuid, name) => {
          const placeholder: PlayerStats = {
            puuid: newPuuid, summonerName: name,
            games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
            avgDpm: 0, avgGold: 0, syncedFull: false, syncedAt: 0, elo: null,
          }
          setSelectedPlayerData(placeholder)
          onPlayerSelect(newPuuid, name)
        }}
      />
    )
  }

  return (
    <PlayerList
      onSelect={(puuid, player) => { setSelectedPlayerData(player); onPlayerSelect(puuid, player.summonerName) }}
      onPlayersChange={onPlayersChange}
      selectedPatches={selectedPatches}
      selectedMode={selectedMode}
    />
  )
}

// ─── Recent player card ───────────────────────────────────────────────────────

function RecentPlayerCard({
  entry,
  selectedPatches,
  selectedMode,
  onSelect,
  onPlayersChange,
  onRemove,
}: {
  entry: RecentEntry
  selectedPatches: string[] | null
  selectedMode?: number
  onSelect: (puuid: string, player: PlayerStats) => void
  onPlayersChange: () => void
  onRemove: (puuid: string) => void
}) {
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    if (selectedPatches === null) return
    api.db.playerOneStats(entry.puuid, selectedPatches, selectedMode ?? 2400).then(setStats).catch(() => {})
  }, [entry.puuid, selectedPatches, selectedMode])

  const handleSync = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await api.lcu.syncPlayer(entry.puuid)
      setSyncMsg(`${result.imported} new game${result.imported !== 1 ? 's' : ''}`)
      const fresh = await api.db.playerOneStats(entry.puuid, selectedPatches ?? undefined, selectedMode ?? 2400)
      setStats(fresh)
      onPlayersChange()
    } catch {
      setSyncMsg('sync failed')
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 4000)
  }, [entry.puuid, selectedPatches, selectedMode, onPlayersChange])

  const [name, tag] = entry.riotId.split('#')
  const wr = stats ? stats.wins / stats.games : null

  const placeholder: PlayerStats = {
    puuid: entry.puuid, summonerName: entry.riotId,
    games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
    avgDpm: 0, avgGold: 0, syncedFull: false, syncedAt: 0, elo: null,
  }

  return (
    <div className="card recent-card" onClick={() => onSelect(entry.puuid, stats ?? placeholder)}>
      <div className="recent-card-info">
        <div className="recent-card-header">
          <div className="recent-card-name">{name}</div>
          {tag && <div className="recent-card-tag">#{tag}</div>}
        </div>
        {stats ? (
          <div className="recent-card-stats">
            <span>{stats.games}G</span>
            <span className={wr! >= 0.5 ? 'win' : 'loss'}>{((wr!) * 100).toFixed(0)}%WR</span>
            <span>{kda(stats.kills, stats.deaths, stats.assists)} KDA</span>
            <span style={{ color: 'var(--text-muted)' }}>{Math.round(stats.avgDpm)}/min</span>
            {stats.elo != null && (
              <span style={{ color: 'var(--blue-light)', fontWeight: 600 }}>{Math.round(stats.elo)} ELO</span>
            )}
          </div>
        ) : (
          <div className="recent-card-empty">Loading…</div>
        )}
        {syncMsg && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>{syncMsg}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="lb-sync-btn"
            onClick={handleSync}
            disabled={syncing}
            title="Sync player"
          >
            {syncing ? '…' : '↻'}
          </button>
          <button
            className="lb-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(entry.puuid) }}
            title="Remove from recents"
          >
            ×
          </button>
        </div>
        {stats && stats.syncedAt > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(stats.syncedAt)}</span>
        )}
      </div>
    </div>
  )
}

// ─── Player list (recents-based) ──────────────────────────────────────────────

function PlayerList({
  onSelect,
  onPlayersChange,
  selectedPatches,
  selectedMode,
}: {
  onSelect: (puuid: string, player: PlayerStats) => void
  onPlayersChange: () => void
  selectedPatches: string[] | null
  selectedMode?: number
}) {
  const [view, setView] = useState<PlayerListView>('recent')
  const [leaderboardPuuids, setLeaderboardPuuids] = useState<string[]>([])
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [showRecents, setShowRecents] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ puuid: string; summonerName: string }[]>([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [searchFired, setSearchFired] = useState(false)

  useEffect(() => { loadRecents().then(setRecents) }, [])

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      setSearchFired(false)
      setShowSearchDropdown(false)
      return
    }
    const timer = setTimeout(() => {
      api.db.searchPlayers(searchQuery)
        .then((results: { puuid: string; summonerName: string }[]) => {
          setSearchResults(results)
          setSearchFired(true)
          setShowSearchDropdown(true)
        })
        .catch((err: unknown) => {
          console.error('[search]', err)
          setSearchFired(true)
          setShowSearchDropdown(true)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

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
      const updated = [{ riotId, puuid: summoner.puuid }, ...recents.filter(r => r.puuid !== summoner.puuid)].slice(0, MAX_RECENT)
      setRecents(updated)
      persistRecents(updated)
      setAddInput('')
      setSyncMsg(`Added ${gameName}: ${result.imported} game${result.imported !== 1 ? 's' : ''} imported`)
      setTimeout(() => setSyncMsg(''), 5000)
      onPlayersChange()
    } catch {
      setAddError('An error occurred — check that the League client is open')
      setAddLoading(false)
      setSyncing(false)
    }
  }, [addInput, onPlayersChange, recents])

  const handleSyncAll = useCallback(async () => {
    const puuids = view === 'leaderboard' ? leaderboardPuuids : recents.map(r => r.puuid)
    if (puuids.length === 0) return
    setSyncingAll(true)
    try {
      await api.lcu.syncCurrentGame(puuids)
    } finally {
      setSyncingAll(false)
    }
  }, [view, leaderboardPuuids, recents])

  const handleSelect = useCallback((puuid: string, player: PlayerStats) => {
    const next = [{ riotId: player.summonerName, puuid }, ...recents.filter(r => r.puuid !== puuid)].slice(0, MAX_RECENT)
    setRecents(next)
    persistRecents(next)
    onSelect(puuid, player)
  }, [onSelect, recents])

  return (
    <div>
      <h1 className="page-title">Players</h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, alignItems: 'center' }}>
        <button className={`mode-btn${view === 'recent' ? ' active' : ''}`} onClick={() => setView('recent')}>Recent</button>
        <button className={`mode-btn${view === 'leaderboard' ? ' active' : ''}`} onClick={() => setView('leaderboard')}>Leaderboard</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSyncAll}
          disabled={syncingAll || (view === 'leaderboard' ? leaderboardPuuids.length === 0 : recents.length === 0)}
          style={{ padding: '4px 12px', background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: syncingAll ? 0.5 : 1 }}
        >
          {syncingAll ? 'Queued…' : view === 'leaderboard' ? 'Sync Leaderboard' : 'Sync Recent Players'}
        </button>
      </div>

      {view === 'leaderboard' ? (
        <EloLeaderboard selectedMode={selectedMode} onDataLoaded={setLeaderboardPuuids} onPlayerSelect={(puuid, name) => {
          const placeholder: PlayerStats = { puuid, summonerName: name, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, avgDpm: 0, avgGold: 0, syncedFull: false, syncedAt: 0, elo: null }
          onSelect(puuid, placeholder)
        }} />
      ) : (<>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        <div className="card" style={{ flex: 2, padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>Search players</div>
          <div style={{ position: 'relative' }}>
            <input
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 12px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
              placeholder="Search by name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowSearchDropdown(true) }}
              onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
            />
            {showSearchDropdown && (
              <div className="recent-dropdown">
                {searchResults.length > 0
                  ? searchResults.map((r) => (
                      <div
                        key={r.puuid}
                        className="recent-item"
                        onMouseDown={() => {
                          const placeholder: PlayerStats = {
                            puuid: r.puuid, summonerName: r.summonerName,
                            games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
                            avgDpm: 0, avgGold: 0, syncedFull: false, syncedAt: 0, elo: null,
                          }
                          const next = [{ riotId: r.summonerName, puuid: r.puuid }, ...recents.filter(e => e.puuid !== r.puuid)].slice(0, MAX_RECENT)
                          setRecents(next)
                          persistRecents(next)
                          setSearchQuery('')
                          setShowSearchDropdown(false)
                          onSelect(r.puuid, placeholder)
                        }}
                      >
                        {r.summonerName}
                      </div>
                    ))
                  : <div className="recent-label" style={{ padding: '8px 10px' }}>No players found</div>
                }
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ flex: 1, padding: '12px 16px' }}>
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
      </div>

      {recents.length === 0 ? (
        <div className="empty-state">
          <div>No recent players</div>
          <p>Add a player above to get started</p>
        </div>
      ) : (
        <div className="recent-list">
          {recents.map((r) => (
            <RecentPlayerCard
              key={r.puuid}
              entry={r}
              selectedPatches={selectedPatches}
              selectedMode={selectedMode}
              onSelect={handleSelect}
              onPlayersChange={onPlayersChange}
              onRemove={(puuid) => {
                const next = recents.filter(r => r.puuid !== puuid)
                setRecents(next)
                persistRecents(next)
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        .player-search { width: 100%; box-sizing: border-box; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); padding: 8px 12px; font-size: 13px; outline: none; margin-bottom: 12px; }
        .player-search:focus { border-color: var(--blue); }
        .recent-list { display: flex; flex-direction: column; gap: 8px; }
        .recent-card { padding: 12px 16px; cursor: pointer; transition: border-color 0.15s; display: flex; align-items: center; gap: 12px; }
        .recent-card:hover { border-color: var(--blue); }
        .recent-card-info { flex: 1; min-width: 0; }
        .recent-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .recent-card-name { font-weight: 700; font-size: 14px; color: var(--blue-light); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .recent-card-tag { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
        .recent-card-stats { display: flex; flex-wrap: wrap; gap: 6px 10px; font-size: 12px; color: var(--text-secondary); }
        .recent-card-empty { font-size: 12px; color: var(--text-muted); }
        .lb-sync-btn, .lb-remove-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-primary); font-size: 15px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .lb-sync-btn { color: var(--text-secondary); }
        .lb-sync-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
        .lb-sync-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .lb-remove-btn { color: var(--text-muted); }
        .lb-remove-btn:hover { border-color: var(--red); color: var(--red); }
        .recent-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; z-index: 100; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
        .recent-label { padding: 5px 10px 3px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .recent-item { padding: 7px 10px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
        .recent-item:hover { background: var(--bg-primary); color: var(--blue-light); }
      `}</style>
      </>)}
    </div>
  )
}

// ─── Elo leaderboard ─────────────────────────────────────────────────────────

function EloLeaderboard({ selectedMode, onPlayerSelect, onDataLoaded }: {
  selectedMode?: number
  onPlayerSelect: (puuid: string, name: string) => void
  onDataLoaded?: (puuids: string[]) => void
}) {
  const [data, setData] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.db.eloLeaderboard(selectedMode ?? 2400)
      .then(rows => { setData(rows); onDataLoaded?.(rows.map(r => r.puuid)) })
      .catch(() => { setData([]); onDataLoaded?.([]) })
      .finally(() => setLoading(false))
  }, [selectedMode])

  if (loading) return <div className="empty-state"><div>Loading…</div></div>

  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div>No elo ratings yet</div>
        <p>Elo ratings will appear after your next sync</p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ padding: '8px 12px', textAlign: 'right', width: 36 }}>#</th>
            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Player</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Elo</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Games</th>
            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const wr = row.games > 0 ? row.wins / row.games : 0
            return (
              <tr
                key={row.puuid}
                onClick={() => onPlayerSelect(row.puuid, row.summonerName)}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-primary)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                <td style={{ padding: '9px 12px', color: 'var(--blue-light)', fontWeight: 600 }}>{row.summonerName}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--blue-light)', fontWeight: 700 }}>{Math.round(row.elo)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>{row.gamesRated}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                  <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Individual player view ───────────────────────────────────────────────────

function PlayerDetail({ puuid, player, onBack, selectedPatches, selectedMode, onAugmentClick, onPlayerClick }: { puuid: string; player: PlayerStats; onBack: () => void; selectedPatches: string[] | null; selectedMode?: number; onAugmentClick?: (augmentId: number) => void; onPlayerClick?: (puuid: string, name: string) => void }) {
  const [tab, setTab] = useState<Tab>('matches')
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [matches, setMatches] = useState<MatchView[]>([])
  const [championStats, setChampionStats] = useState<ChampionStat[]>([])
  const [augmentStats, setAugmentStats] = useState<AugmentStat[]>([])
  const [augmentCache, setAugmentCache] = useState<Record<number, AugmentInfo>>({})
  const [coplayerStats, setCoplayerStats] = useState<CoplayerStat[]>([])
  const [eloHistory, setEloHistory] = useState<EloEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    setChampionStats([])
    setAugmentStats([])
    setCoplayerStats([])
    Promise.all([
      api.db.playerOneStats(puuid, selectedPatches, selectedMode ?? 2400),
      api.db.recentMatches(20, puuid, selectedPatches, selectedMode ?? 2400),
      api.db.augmentCache(),
    ]).then(([s, m, cache]: [PlayerStats | null, MatchView[], Record<number, AugmentInfo>]) => {
      setStats(s)
      setMatches(m)
      setAugmentCache(cache)
      setLoading(false)
    }).catch(() => { setLoading(false); setLoadError(true) })
  }, [puuid, selectedPatches, selectedMode])

  useEffect(() => {
    if (selectedPatches === null) return
    if (tab === 'champions' && championStats.length === 0) {
      api.db.championStats(puuid, selectedPatches, selectedMode ?? 2400).then(setChampionStats).catch(() => {})
    }
    if (tab === 'augments' && augmentStats.length === 0) {
      api.db.augmentStats(puuid, undefined, selectedPatches, selectedMode ?? 2400).then(setAugmentStats).catch(() => {})
    }
    if (tab === 'coplayers' && coplayerStats.length === 0) {
      api.db.coplayerStats(puuid, selectedPatches ?? undefined, selectedMode ?? 2400).then(setCoplayerStats).catch(() => {})
    }
    if (tab === 'elo' && eloHistory.length === 0) {
      api.db.eloHistory(puuid, selectedMode ?? 2400).then(setEloHistory).catch(() => {})
    }
  }, [tab, puuid, selectedPatches, selectedMode, championStats.length, augmentStats.length, coplayerStats.length, eloHistory.length])

  const handleDetailSync = useCallback(async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await api.lcu.syncPlayer(puuid)
      setSyncMsg(`${result.imported} new game${result.imported !== 1 ? 's' : ''}`)
      const fresh = await api.db.playerOneStats(puuid, selectedPatches ?? undefined, selectedMode ?? 2400)
      if (fresh) setStats(fresh)
    } catch {
      setSyncMsg('sync failed')
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 4000)
  }, [puuid, selectedPatches])

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
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {(stats?.syncedAt ?? 0) > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>synced {timeAgo(stats!.syncedAt)}</span>
          )}
          <button
            onClick={handleDetailSync}
            disabled={syncing}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', opacity: syncing ? 0.5 : 1 }}
          >
            {syncing ? '…' : '↻ Sync'}
          </button>
          {syncMsg && <span style={{ fontSize: 11, color: 'var(--green)' }}>{syncMsg}</span>}
        </div>
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
          {stats.elo != null && (
            <div className="card stat-card">
              <div className="card-title">Elo</div>
              <div className="stat-value" style={{ color: 'var(--blue-light)' }}>{Math.round(stats.elo)}</div>
              <div className="stat-label">Rating</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['matches', 'champions', 'augments', 'coplayers', 'elo'] as Tab[]).map((t) => (
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
              <MatchCard key={match.gameId} match={match} selectedPuuid={puuid} augments={augmentCache} onPlayerClick={onPlayerClick} />
            ))}
          </div>
        )
      )}

      {tab === 'champions' && (
        <ChampionStatsTable data={championStats} />
      )}

      {tab === 'augments' && (
        <AugmentStatsTable data={augmentStats} augmentCache={augmentCache} onAugmentClick={onAugmentClick} showRarityFilter />
      )}

      {tab === 'coplayers' && (
        coplayerStats.length === 0 ? (
          <div className="card"><div className="empty-state"><div>No coplayer data</div></div></div>
        ) : (
          <CoplayerTable data={coplayerStats} onPlayerClick={onPlayerClick} />
        )
      )}

      {tab === 'elo' && (
        <EloHistoryChart data={eloHistory} />
      )}
    </div>
  )
}

// ─── Elo history chart ────────────────────────────────────────────────────────

function EloHistoryChart({ data }: { data: EloEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <div>No Elo history yet</div>
          <p>Sync games to compute your rating</p>
        </div>
      </div>
    )
  }

  const width = 700
  const height = 220
  const pad = { top: 20, right: 16, bottom: 32, left: 52 }
  const inner = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom }

  const elos = data.map(d => d.elo_after)
  const minElo = Math.min(...elos)
  const maxElo = Math.max(...elos)
  const eloRange = maxElo - minElo || 100
  const yMin = minElo - eloRange * 0.1
  const yMax = maxElo + eloRange * 0.1

  const xScale = (i: number) => (i / (data.length - 1 || 1)) * inner.w
  const yScale = (v: number) => inner.h - ((v - yMin) / (yMax - yMin)) * inner.h

  const points = data.map((d, i) => `${xScale(i)},${yScale(d.elo_after)}`).join(' ')
  const current = Math.round(data[data.length - 1].elo_after)
  const first = Math.round(data[0].elo_before)
  const delta = current - first

  const yTicks = 4
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yMax - yMin) * (i / yTicks))

  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue-light)' }}>{current}</span>
        <span style={{ fontSize: 13, color: delta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
          {delta >= 0 ? '+' : ''}{delta} all-time
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{data.length} rated games</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, display: 'block', overflow: 'visible' }}>
        <g transform={`translate(${pad.left},${pad.top})`}>
          {yTickValues.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={inner.w} y1={yScale(v)} y2={yScale(v)} stroke="var(--border)" strokeWidth={1} strokeDasharray="3,3" />
              <text x={-8} y={yScale(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">{Math.round(v)}</text>
            </g>
          ))}
          <line x1={0} x2={0} y1={0} y2={inner.h} stroke="var(--border)" strokeWidth={1} />
          <line x1={0} x2={inner.w} y1={inner.h} y2={inner.h} stroke="var(--border)" strokeWidth={1} />
          <polyline points={points} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.length < 80 && data.map((d, i) => (
            <circle
              key={i}
              cx={xScale(i)}
              cy={yScale(d.elo_after)}
              r={3}
              fill={d.delta >= 0 ? 'var(--green)' : 'var(--red)'}
              stroke="var(--bg-card)"
              strokeWidth={1}
            />
          ))}
        </g>
      </svg>
    </div>
  )
}

// ─── Match components (migrated from Dashboard.tsx) ──────────────────────────

export function MatchCard({ match, selectedPuuid, augments, onPlayerClick }: { match: MatchView; selectedPuuid: string | null; augments: Record<number, AugmentInfo>; onPlayerClick?: (puuid: string, name: string) => void }) {
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
        <TeamTable participants={teamA} won={teamAWon} selectedPuuid={selectedPuuid} augments={augments} onPlayerClick={onPlayerClick} />
        <div className="team-divider" />
        <TeamTable participants={teamB} won={!teamAWon} selectedPuuid={selectedPuuid} augments={augments} onPlayerClick={onPlayerClick} />
      </div>
    </div>
  )
}

function TeamTable({ participants, selectedPuuid, augments, onPlayerClick }: { participants: MatchParticipant[]; won: boolean; selectedPuuid: string | null; augments: Record<number, AugmentInfo>; onPlayerClick?: (puuid: string, name: string) => void }) {
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
            <td className="summoner-name" style={{ minWidth: 90, maxWidth: 120 }}>
              {onPlayerClick && p.puuid !== selectedPuuid ? (
                <span
                  style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--text-muted)' }}
                  onClick={() => onPlayerClick(p.puuid, p.summonerName)}
                >
                  {p.summonerName}
                </span>
              ) : p.summonerName}
            </td>
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

// ─── Coplayer sub-tab table ───────────────────────────────────────────────────

export function CoplayerTable({ data, onPlayerClick }: { data: CoplayerStat[]; onPlayerClick?: (puuid: string, name: string) => void }) {
  const [sortKey, setSortKey] = useState<CoplayerSortKey>('games')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const onSort = (key: CoplayerSortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const arrow = (key: CoplayerSortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  const thStyle = { cursor: 'pointer', userSelect: 'none' as const }

  const sorted = [...data].sort((a, b) => {
    const aVal = sortKey === 'winRate' ? (a.games > 0 ? a.wins / a.games : 0) : a.games
    const bVal = sortKey === 'winRate' ? (b.games > 0 ? b.wins / b.games : 0) : b.games
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal
  })

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th style={thStyle} onClick={() => onSort('games')}>Games{arrow('games')}</th>
            <th style={thStyle} onClick={() => onSort('winRate')}>Win Rate{arrow('winRate')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const wr = r.games > 0 ? r.wins / r.games : 0
            return (
              <tr key={r.puuid}>
                <td style={{ fontWeight: 500 }}>
                  {onPlayerClick ? (
                    <span
                      style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--text-muted)' }}
                      onClick={() => onPlayerClick(r.puuid, r.summonerName)}
                    >
                      {r.summonerName}
                    </span>
                  ) : r.summonerName}
                </td>
                <td>{r.games}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 60, height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? 'var(--green)' : 'var(--red)', borderRadius: 3 }} />
                    </div>
                    <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Player } from '../App'

const api = (window as any).api

interface ChampionStat {
  championId: number
  championName: string
  puuid: string
  summonerName: string
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
  avgDpm: number
}

type SortKey = 'games' | 'winRate' | 'kda' | 'avgDpm'

function kda(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfect'
  return ((kills + assists) / deaths).toFixed(2)
}

interface Props {
  players: Player[]
  selectedPatches: string[] | null
  onChampionClick?: (championId: number) => void
}

export default function Champions({ players, selectedPatches, onChampionClick }: Props) {
  const [selectedPuuid, setSelectedPuuid] = useState<string | undefined>(undefined)
  const [data, setData] = useState<ChampionStat[]>([])
  const [sort, setSort] = useState<SortKey>('games')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    api.db.championStats(selectedPuuid, selectedPatches).then((d: ChampionStat[]) => {
      setData(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedPuuid, selectedPatches])

  const filtered = data
    .filter((c) => c.championName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'games') return b.games - a.games
      if (sort === 'winRate') return b.wins / b.games - a.wins / a.games
      if (sort === 'kda') {
        const kdaA = a.deaths === 0 ? 999 : (a.kills + a.assists) / a.deaths
        const kdaB = b.deaths === 0 ? 999 : (b.kills + b.assists) / b.deaths
        return kdaB - kdaA
      }
      if (sort === 'avgDpm') return b.avgDpm - a.avgDpm
      return 0
    })

  return (
    <div>
      <h1 className="page-title">Champions</h1>

      <div className="filters card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' }}>
        <select
          value={selectedPuuid ?? ''}
          onChange={(e) => setSelectedPuuid(e.target.value || undefined)}
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 10px', fontSize: 12, outline: 'none' }}
        >
          <option value="">All Players</option>
          {players.map((p) => (
            <option key={p.puuid} value={p.puuid}>{p.summonerName}</option>
          ))}
        </select>
        <input
          className="search-input"
          placeholder="Search champion…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 'auto' }}>Sort by</label>
        {(['games', 'winRate', 'kda', 'avgDpm'] as SortKey[]).map((key) => (
          <button
            key={key}
            className={`sort-btn ${sort === key ? 'active' : ''}`}
            onClick={() => setSort(key)}
          >
            {key === 'winRate' ? 'Win Rate' : key === 'avgDpm' ? 'DPM' : key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div>No champion data</div>
            <p>Sync some games first</p>
          </div>
        ) : (
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
              {filtered.map((c) => {
                const wr = c.wins / c.games
                return (
                  <tr
                    key={`${c.championId}-${c.puuid || 'all'}`}
                    onClick={() => onChampionClick?.(c.championId)}
                    style={onChampionClick ? { cursor: 'pointer' } : undefined}
                    className={onChampionClick ? 'champ-row' : undefined}
                  >
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
                        <div className="wr-bar">
                          <div className="wr-fill" style={{ width: `${wr * 100}%`, background: wr >= 0.5 ? 'var(--green)' : 'var(--red)' }} />
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
        )}
      </div>

      <style>{`
        .search-input { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); padding: 6px 12px; font-size: 13px; outline: none; width: 200px; }
        .search-input:focus { border-color: var(--blue); }
        .sort-btn { padding: 5px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); font-size: 12px; transition: all 0.15s; cursor: pointer; }
        .sort-btn:hover { border-color: var(--blue); color: var(--text-primary); }
        .sort-btn.active { border-color: var(--accent); color: var(--accent); }
        .wr-bar { width: 60px; height: 6px; background: var(--bg-primary); border-radius: 3px; overflow: hidden; }
        .wr-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
        .champ-row:hover td { background: var(--bg-primary); }
        .champ-row:hover td:first-child { color: var(--blue-light); }
      `}</style>
    </div>
  )
}

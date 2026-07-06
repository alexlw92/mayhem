import { useState, useEffect } from 'react'

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
  avgDamage: number
}

type SortKey = 'games' | 'winRate' | 'kda' | 'avgDamage'

function kda(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfect'
  return ((kills + assists) / deaths).toFixed(2)
}

interface Props {
  selectedPuuid: string | null
}

export default function ChampionStats({ selectedPuuid }: Props) {
  const [data, setData] = useState<ChampionStat[]>([])
  const [sort, setSort] = useState<SortKey>('games')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.db.championStats(selectedPuuid ?? undefined).then((d: ChampionStat[]) => {
      setData(d)
      setLoading(false)
    })
  }, [selectedPuuid])

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
      if (sort === 'avgDamage') return b.avgDamage - a.avgDamage
      return 0
    })

  return (
    <div>
      <h1 className="page-title">Champion Stats</h1>

      <div className="filters card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px' }}>
        <input
          className="search-input"
          placeholder="Search champion…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ color: 'var(--text-secondary)', fontSize: 12, marginLeft: 'auto' }}>Sort by</label>
        {(['games', 'winRate', 'kda', 'avgDamage'] as SortKey[]).map((key) => (
          <button
            key={key}
            className={`sort-btn ${sort === key ? 'active' : ''}`}
            onClick={() => setSort(key)}
          >
            {key === 'winRate' ? 'Win Rate' : key === 'avgDamage' ? 'Damage' : key.charAt(0).toUpperCase() + key.slice(1)}
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
                <th>Avg Damage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const wr = c.wins / c.games
                return (
                  <tr key={`${c.championId}-${c.puuid || 'all'}`}>
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
                          <div
                            className="wr-fill"
                            style={{ width: `${wr * 100}%`, background: wr >= 0.5 ? 'var(--green)' : 'var(--red)' }}
                          />
                        </div>
                        <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="kda">{kda(c.kills, c.deaths, c.assists)}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      {(c.kills / c.games).toFixed(1)} / {(c.deaths / c.games).toFixed(1)} / {(c.assists / c.games).toFixed(1)}
                    </td>
                    <td>{(c.avgDamage / 1000).toFixed(1)}k</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .search-input {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-primary);
          padding: 6px 12px;
          font-size: 13px;
          outline: none;
          width: 200px;
        }
        .search-input:focus { border-color: var(--blue); }
        .sort-btn {
          padding: 5px 12px;
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 12px;
          transition: all 0.15s;
        }
        .sort-btn:hover { border-color: var(--blue); color: var(--text-primary); }
        .sort-btn.active { border-color: var(--accent); color: var(--accent); }
        .wr-bar {
          width: 60px;
          height: 6px;
          background: var(--bg-primary);
          border-radius: 3px;
          overflow: hidden;
        }
        .wr-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s;
        }
      `}</style>
    </div>
  )
}

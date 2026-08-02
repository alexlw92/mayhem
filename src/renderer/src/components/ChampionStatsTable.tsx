import { useState } from 'react'

export interface ChampionStat {
  championId: number
  championName: string
  games: number
  wins: number
  kills?: number
  deaths?: number
  assists?: number
  avgDpm: number
  puuid?: string
}

interface Props {
  data: ChampionStat[]
  onChampionClick?: (championId: number, championName: string) => void
  showKda?: boolean
}

type SortKey = 'championName' | 'games' | 'winRate' | 'kda' | 'avgDpm'

function kda(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfect'
  return ((kills + assists) / deaths).toFixed(2)
}

export default function ChampionStatsTable({ data, onChampionClick, showKda = true }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('games')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir(key === 'championName' ? 'asc' : 'desc') }
  }
  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  const thStyle = { cursor: 'pointer', userSelect: 'none' as const }

  const sorted = [...data].sort((a, b) => {
    if (sortKey === 'championName') {
      return sortDir === 'asc'
        ? a.championName.localeCompare(b.championName)
        : b.championName.localeCompare(a.championName)
    }
    const aVal = sortKey === 'winRate' ? a.wins / a.games
      : sortKey === 'kda' ? (a.kills! + a.assists!) / Math.max(1, a.deaths!)
      : sortKey === 'avgDpm' ? a.avgDpm
      : a.games
    const bVal = sortKey === 'winRate' ? b.wins / b.games
      : sortKey === 'kda' ? (b.kills! + b.assists!) / Math.max(1, b.deaths!)
      : sortKey === 'avgDpm' ? b.avgDpm
      : b.games
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal
  })

  return (
    <div className="card">
      {sorted.length === 0 ? (
        <div className="empty-state"><div>No champion data</div></div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={thStyle} onClick={() => onSort('championName')}>Champion{arrow('championName')}</th>
              <th style={thStyle} onClick={() => onSort('games')}>Games{arrow('games')}</th>
              <th style={thStyle} onClick={() => onSort('winRate')}>Win Rate{arrow('winRate')}</th>
              {showKda && <th style={thStyle} onClick={() => onSort('kda')}>KDA{arrow('kda')}</th>}
              {showKda && <th>K / D / A</th>}
              <th style={thStyle} onClick={() => onSort('avgDpm')}>Avg DPM{arrow('avgDpm')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const wr = c.wins / c.games
              return (
                <tr
                  key={`${c.championId}-${c.puuid ?? 'all'}`}
                  onClick={() => onChampionClick?.(c.championId, c.championName)}
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
                  {showKda && (
                    <td className="kda">{kda(c.kills ?? 0, c.deaths ?? 0, c.assists ?? 0)}</td>
                  )}
                  {showKda && (
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      {((c.kills ?? 0) / c.games).toFixed(1)} / {((c.deaths ?? 0) / c.games).toFixed(1)} / {((c.assists ?? 0) / c.games).toFixed(1)}
                    </td>
                  )}
                  <td>{Math.round(c.avgDpm)}/min</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

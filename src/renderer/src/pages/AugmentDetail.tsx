import { useState, useEffect } from 'react'
import AugmentIcon from '../components/AugmentIcon'
import './Dashboard.css'

const api = (window as any).api

interface AugmentChampionStat {
  championId: number
  championName: string
  games: number
  wins: number
  avgDpm: number
}

interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

interface Props {
  augmentId: number
  puuid?: string
  selectedPatches: string[] | null
  onBack: () => void
}

type SortKey = 'championName' | 'games' | 'winRate'

const RARITY_LABEL = ['Silver', 'Gold', 'Prismatic']
const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']

export default function AugmentDetail({ augmentId, puuid, selectedPatches, onBack }: Props) {
  const [data, setData] = useState<AugmentChampionStat[]>([])
  const [augmentCache, setAugmentCache] = useState<Record<number, AugmentInfo>>({})
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('games')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  useEffect(() => {
    api.db.augmentCache().then(setAugmentCache).catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    api.db.augmentChampionStats(augmentId, puuid, selectedPatches)
      .then((d: AugmentChampionStat[]) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [augmentId, puuid, selectedPatches])

  const augment = augmentCache[augmentId]
  const rarityColor = augment ? (RARITY_COLOR[augment.rarity] ?? RARITY_COLOR[0]) : RARITY_COLOR[0]
  const rarityLabel = augment ? (RARITY_LABEL[augment.rarity] ?? 'Silver') : ''

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir(key === 'championName' ? 'asc' : 'desc') }
  }
  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  const thStyle = { cursor: 'pointer', userSelect: 'none' as const }

  const sorted = [...data].sort((a, b) => {
    const aVal = sortKey === 'championName' ? a.championName
      : sortKey === 'winRate' ? (a.games > 0 ? a.wins / a.games : 0)
      : a.games
    const bVal = sortKey === 'championName' ? b.championName
      : sortKey === 'winRate' ? (b.games > 0 ? b.wins / b.games : 0)
      : b.games
    if (typeof aVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal)
    }
    return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
  })

  const totalGames = data.reduce((s, r) => s + r.games, 0)
  const totalWins = data.reduce((s, r) => s + r.wins, 0)
  const overallWr = totalGames > 0 ? totalWins / totalGames : 0
  const overallDpm = data.length > 0
    ? data.reduce((s, r) => s + r.avgDpm * r.games, 0) / totalGames
    : 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-secondary)', padding: '6px 12px', fontSize: 13, cursor: 'pointer'
          }}
        >
          ←
        </button>
        <AugmentIcon id={augmentId} augments={augmentCache} size={36} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {augment?.name ?? `Augment ${augmentId}`}
          </div>
          {augment && (
            <div style={{ fontSize: 12, color: rarityColor, fontWeight: 600, marginTop: 2 }}>
              {rarityLabel}
            </div>
          )}
        </div>
      </div>

      {totalGames > 0 && (
        <div className="grid-4" style={{ marginBottom: 16 }}>
          {[
            { label: 'Total Picks', value: totalGames },
            { label: 'Win Rate', value: `${(overallWr * 100).toFixed(1)}%`, className: overallWr >= 0.5 ? 'win' : 'loss' },
            { label: 'Avg DPM', value: `${Math.round(overallDpm)}/min` },
            { label: 'Champions', value: data.length },
          ].map(({ label, value, className }) => (
            <div key={label} className="card">
              <div className="stat-label">{label}</div>
              <div className={`stat-value ${className ?? ''}`} style={{ fontSize: 22 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : data.length === 0 ? (
          <div className="empty-state">
            <div>No data</div>
            <p>No games found for this augment with the current filters</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => onSort('championName')}>Champion{arrow('championName')}</th>
                <th style={thStyle} onClick={() => onSort('games')}>Games{arrow('games')}</th>
                <th style={thStyle} onClick={() => onSort('winRate')}>Win Rate{arrow('winRate')}</th>
                <th>Avg DPM</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const wr = r.games > 0 ? r.wins / r.games : 0
                return (
                  <tr key={r.championId}>
                    <td style={{ fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                          <img
                            src={`mayhem-asset://champion-icons/${r.championId}.png`}
                            alt={r.championName}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        </div>
                        {r.championName}
                      </div>
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
                    <td>{Math.round(r.avgDpm)}/min</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

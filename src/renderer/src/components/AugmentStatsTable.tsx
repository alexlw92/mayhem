import { useState, useMemo } from 'react'
import AugmentIcon from './AugmentIcon'

export interface AugmentStat {
  augmentId: number
  name: string
  rarity: number
  iconPath?: string
  pickCount: number
  wins: number
  avgDpm: number
  wilsonScore: number
}

interface Props {
  data: AugmentStat[]
  augmentCache?: Record<number, { name: string; iconPath: string; rarity: number }>
  onAugmentClick?: (augmentId: number) => void
  showRarityFilter?: boolean
}

type SortKey = 'pickCount' | 'winRate' | 'avgDpm' | 'wilson'

const RARITY_LABEL = ['Silver', 'Gold', 'Prismatic']
const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']

function scoreStyle(score: number): React.CSSProperties {
  return {
    color: `hsl(${score * 12}, 70%, 45%)`,
    fontWeight: 600,
  }
}

export default function AugmentStatsTable({ data, augmentCache, onAugmentClick, showRarityFilter = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('wilson')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [rarityFilter, setRarityFilter] = useState<number | null>(null)

  const cache = useMemo(() => {
    if (augmentCache) return augmentCache
    const c: Record<number, { name: string; iconPath: string; rarity: number }> = {}
    data.forEach((a) => {
      if (a.iconPath) c[a.augmentId] = { name: a.name, iconPath: a.iconPath, rarity: a.rarity }
    })
    return c
  }, [augmentCache, data])

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  const thStyle = { cursor: 'pointer', userSelect: 'none' as const }

  const sorted = [...data]
    .filter((a) => rarityFilter === null || a.rarity === rarityFilter)
    .sort((a, b) => {
      const aVal = sortKey === 'winRate' ? (a.pickCount > 0 ? a.wins / a.pickCount : 0)
        : sortKey === 'avgDpm' ? a.avgDpm
        : sortKey === 'wilson' ? a.wilsonScore
        : a.pickCount
      const bVal = sortKey === 'winRate' ? (b.pickCount > 0 ? b.wins / b.pickCount : 0)
        : sortKey === 'avgDpm' ? b.avgDpm
        : sortKey === 'wilson' ? b.wilsonScore
        : b.pickCount
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })

  return (
    <div className="card">
      {showRarityFilter && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Rarity</span>
          <button
            className={`aug-btn ${rarityFilter === null ? 'active' : ''}`}
            onClick={() => setRarityFilter(null)}
          >
            All
          </button>
          {[0, 1, 2].map((r) => (
            <button
              key={r}
              className={`aug-btn ${rarityFilter === r ? 'active' : ''}`}
              style={rarityFilter === r ? { borderColor: RARITY_COLOR[r], color: RARITY_COLOR[r] } : {}}
              onClick={() => setRarityFilter(rarityFilter === r ? null : r)}
            >
              {RARITY_LABEL[r]}
            </button>
          ))}
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="empty-state"><div>No augment data</div></div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Augment</th>
              <th>Rarity</th>
              <th style={thStyle} onClick={() => onSort('pickCount')}>Picks{arrow('pickCount')}</th>
              <th style={thStyle} onClick={() => onSort('winRate')}>Win Rate{arrow('winRate')}</th>
              <th style={thStyle} onClick={() => onSort('avgDpm')}>Avg DPM{arrow('avgDpm')}</th>
              <th style={thStyle} onClick={() => onSort('wilson')}>Score{arrow('wilson')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const wr = a.pickCount > 0 ? a.wins / a.pickCount : 0
              const rarityColor = RARITY_COLOR[a.rarity] ?? RARITY_COLOR[0]
              return (
                <tr
                  key={a.augmentId}
                  style={{ cursor: onAugmentClick ? 'pointer' : undefined }}
                  onClick={() => onAugmentClick?.(a.augmentId)}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AugmentIcon id={a.augmentId} augments={cache} size={24} />
                      {a.name}
                    </div>
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                      fontSize: 11, fontWeight: 600, color: rarityColor,
                      border: `1px solid ${rarityColor}`, opacity: 0.9,
                    }}>
                      {RARITY_LABEL[a.rarity] ?? 'Silver'}
                    </span>
                  </td>
                  <td>{a.pickCount}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="wr-bar">
                        <div className="wr-fill" style={{ width: `${wr * 100}%`, background: wr >= 0.5 ? 'var(--green)' : 'var(--red)' }} />
                      </div>
                      <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>{Math.round(a.avgDpm)}/min</td>
                  <td style={scoreStyle(a.wilsonScore)}>{a.wilsonScore.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

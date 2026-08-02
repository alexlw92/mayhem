import { useState, useEffect } from 'react'
import AugmentIcon from '../components/AugmentIcon'
import ChampionStatsTable, { ChampionStat } from '../components/ChampionStatsTable'
import './Dashboard.css'

const api = (window as any).api

interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

interface Props {
  augmentId: number
  puuid?: string
  selectedPatches: string[] | null
  selectedMode?: number
  onBack: () => void
}

const RARITY_LABEL = ['Silver', 'Gold', 'Prismatic']
const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']

export default function AugmentDetail({ augmentId, puuid, selectedPatches, selectedMode, onBack }: Props) {
  const [data, setData] = useState<ChampionStat[]>([])
  const [augmentCache, setAugmentCache] = useState<Record<number, AugmentInfo>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.db.augmentCache().then(setAugmentCache).catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    api.db.augmentChampionStats(augmentId, puuid, selectedPatches, selectedMode ?? 2400)
      .then((d: ChampionStat[]) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [augmentId, puuid, selectedPatches, selectedMode])

  const augment = augmentCache[augmentId]
  const rarityColor = augment ? (RARITY_COLOR[augment.rarity] ?? RARITY_COLOR[0]) : RARITY_COLOR[0]
  const rarityLabel = augment ? (RARITY_LABEL[augment.rarity] ?? 'Silver') : ''

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

      {loading ? (
        <div className="card"><div className="empty-state">Loading…</div></div>
      ) : (
        <ChampionStatsTable data={data} showKda={false} />
      )}
    </div>
  )
}

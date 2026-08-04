import { useState, useEffect } from 'react'

const api = (window as any).api

interface ChampionPool {
  championId: number
  championName: string
  games: number
  share: number
}

interface ClassBucket {
  class: string
  games: number
  wins: number
  winRate: number
}

interface PlayerPerformance {
  championPickQuality: number
  augmentPickQuality: number
  kpDelta: number
  dpmDelta: number
  gpmDelta: number
  poolUniqueChampions: number
  poolTop3Concentration: number
  poolTopChampions: ChampionPool[]
  classBuckets: ClassBucket[]
}

interface Props {
  puuid: string
  patches: string[] | null
  queueId: number
}

function DeltaCard({ label, value, format }: {
  label: string; value: number; format: (v: number) => string
}) {
  const color = value > 0.005
    ? 'var(--green, #4caf50)'
    : value < -0.005
    ? 'var(--red, #f44336)'
    : 'var(--text-secondary)'
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '10px 14px', flex: '1 1 0', minWidth: 90 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color }}>{format(value)}</div>
    </div>
  )
}

function PoolCard({ unique, concentration }: { unique: number; concentration: number }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '10px 14px', flex: '1 1 0', minWidth: 90 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Champion Pool</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{unique}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{(concentration * 100).toFixed(0)}% on top 3</div>
    </div>
  )
}

function RoleBarChart({ buckets }: { buckets: ClassBucket[] }) {
  if (buckets.length === 0) return null
  const sorted = [...buckets].sort((a, b) => b.games - a.games)
  const maxGames = sorted[0].games

  return (
    <div style={{ width: '100%' }}>
      {sorted.map(b => (
        <div key={b.class} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 72, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{b.class}</div>
          <div style={{ flex: 1, height: 14, background: 'var(--bg-tertiary, #1a1a2a)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ display: 'flex', height: '100%', width: `${(b.games / maxGames) * 100}%` }}>
              <div style={{ width: `${(b.wins / b.games) * 100}%`, background: 'var(--accent, #7b68ee)' }} />
              <div style={{ flex: 1, background: 'var(--bg-card, #2a2a3a)' }} />
            </div>
          </div>
          <div style={{ width: 36, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
            {(b.winRate * 100).toFixed(0)}%
          </div>
        </div>
      ))}
    </div>
  )
}

function PoolDepth({ champions }: { champions: ChampionPool[] }) {
  return (
    <div style={{ flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Top Champions</div>
      {champions.map(c => (
        <div key={c.championId} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: 'var(--text-primary)' }}>{c.championName}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{c.games}g</span>
          </div>
          <div style={{ height: 3, background: 'var(--bg-tertiary, #1a1a2a)', borderRadius: 2 }}>
            <div style={{ width: `${Math.round(c.share * 100)}%`, height: '100%', background: 'var(--accent, #7b68ee)', borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PerformancePanel({ puuid, patches, queueId }: Props) {
  const [data, setData] = useState<PlayerPerformance | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setData(null)
    api.db.playerPerformance(puuid, patches ?? undefined, queueId)
      .then((d: PlayerPerformance) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [puuid, patches, queueId])

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: '12px 0', fontSize: 12 }}>Loading performance…</div>
  }
  if (!data || data.poolUniqueChampions === 0) return null

  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  const fmtNum = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <DeltaCard label="Champ Picks" value={data.championPickQuality} format={fmtPct} />
        <DeltaCard label="Aug Picks" value={data.augmentPickQuality} format={fmtPct} />
        <DeltaCard label="KP% Δ" value={data.kpDelta} format={fmtPct} />
        <DeltaCard label="DPM Δ" value={data.dpmDelta} format={fmtNum} />
        <DeltaCard label="GPM Δ" value={data.gpmDelta} format={fmtNum} />
        <PoolCard unique={data.poolUniqueChampions} concentration={data.poolTop3Concentration} />
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Win Rate by Role</div>
          <RoleBarChart buckets={data.classBuckets} />
        </div>
        <PoolDepth champions={data.poolTopChampions} />
      </div>
    </div>
  )
}

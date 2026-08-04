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

const ROLES = ['Fighter', 'Mage', 'Assassin', 'Tank', 'Marksman', 'Support']

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

function RadarChart({ buckets }: { buckets: ClassBucket[] }) {
  const size = 180
  const cx = size / 2, cy = size / 2
  const R = size * 0.37
  const n = ROLES.length
  const byRole = new Map(buckets.map(b => [b.class, b]))

  const spokes = ROLES.map((role, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    const b = byRole.get(role)
    const r = b ? Math.min(b.winRate, 1) * R : 0
    return {
      role,
      px: cx + r * Math.cos(angle),
      py: cy + r * Math.sin(angle),
      sx: cx + R * Math.cos(angle),
      sy: cy + R * Math.sin(angle),
      lx: cx + (R + 22) * Math.cos(angle),
      ly: cy + (R + 22) * Math.sin(angle),
      hasData: !!b,
      games: b?.games ?? 0,
    }
  })

  const refRing = ROLES.map((_, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    const r = 0.5 * R
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`
  }).join(' ')

  const poly = spokes.filter(s => s.hasData).map(s => `${s.px},${s.py}`).join(' ')

  return (
    <svg width={size + 60} height={size + 50} viewBox={`-30 -25 ${size + 60} ${size + 50}`}>
      {spokes.map((s, i) => (
        <line key={i} x1={cx} y1={cy} x2={s.sx} y2={s.sy}
          stroke="var(--border, #2a2a3a)" strokeWidth={1} />
      ))}
      <polygon points={refRing} fill="none"
        stroke="var(--text-muted, #444)" strokeWidth={1} strokeDasharray="3,3" />
      {poly && (
        <polygon points={poly}
          fill="var(--accent, #7b68ee)" fillOpacity={0.2}
          stroke="var(--accent, #7b68ee)" strokeWidth={2} />
      )}
      {spokes.filter(s => s.hasData).map((s, i) => (
        <circle key={i} cx={s.px} cy={s.py}
          r={Math.max(3, Math.log(s.games + 1) * 2)}
          fill="var(--accent, #7b68ee)" />
      ))}
      {spokes.map((s, i) => (
        <text key={i} x={s.lx} y={s.ly}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={9}
          fill={s.hasData ? 'var(--text-primary)' : 'var(--text-muted, #555)'}>
          {s.role}
        </text>
      ))}
    </svg>
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
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Performance
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <DeltaCard label="Champ Picks" value={data.championPickQuality} format={fmtPct} />
        <DeltaCard label="Aug Picks" value={data.augmentPickQuality} format={fmtPct} />
        <DeltaCard label="KP% Δ" value={data.kpDelta} format={fmtPct} />
        <DeltaCard label="DPM Δ" value={data.dpmDelta} format={fmtNum} />
        <DeltaCard label="GPM Δ" value={data.gpmDelta} format={fmtNum} />
        <PoolCard unique={data.poolUniqueChampions} concentration={data.poolTop3Concentration} />
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Win Rate by Role</div>
          <RadarChart buckets={data.classBuckets} />
        </div>
        <PoolDepth champions={data.poolTopChampions} />
      </div>
    </div>
  )
}

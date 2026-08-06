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
  dpmPct: number
  gpmPct: number
  poolUniqueChampions: number
  poolTop3Concentration: number
  poolTopChampions: ChampionPool[]
  classBuckets: ClassBucket[]
  percentiles: {
    cpq: number | null
    apq: number | null
    kpDelta: number | null
    dpmPct: number | null
    gpmPct: number | null
  } | null
}

interface Props {
  puuid: string
  patches: string[] | null
  queueId: number
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function PercentileCard({ label, percentile, rawValue, delta }: {
  label: string; percentile: number | null; rawValue: number; delta: string
}) {
  const color = percentile !== null
    ? percentile >= 67 ? 'var(--green, #4caf50)'
      : percentile <= 33 ? 'var(--red, #f44336)'
      : 'var(--text-primary)'
    : rawValue > 0.005 ? 'var(--green, #4caf50)'
      : rawValue < -0.005 ? 'var(--red, #f44336)'
      : 'var(--text-secondary)'
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '10px 14px', flex: '1 1 0', minWidth: 90 }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      {percentile !== null ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 600, color }}>{ordinal(percentile)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{delta}</div>
        </>
      ) : (
        <div style={{ fontSize: 18, fontWeight: 600, color }}>{delta}</div>
      )}
    </div>
  )
}

const ALL_ROLES = ['Fighter', 'Mage', 'Assassin', 'Tank', 'Marksman', 'Support']

function RoleBarChart({ buckets }: { buckets: ClassBucket[] }) {
  const byClass = Object.fromEntries(buckets.map(b => [b.class, b]))
  const rows = ALL_ROLES.map(role => byClass[role] ?? { class: role, games: 0, wins: 0, winRate: 0 })
  const maxGames = Math.max(...rows.map(r => r.games), 1)

  return (
    <div style={{ width: '100%' }}>
      {rows.map(b => {
        const hasData = b.games > 0
        return (
          <div key={b.class} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 72, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{b.class}</div>
            <div style={{ flex: 1, height: 14, background: 'var(--bg-tertiary, #1a1a2a)', borderRadius: 3, overflow: 'hidden' }}>
              {hasData && (
                <div style={{ display: 'flex', height: '100%', width: `${(b.games / maxGames) * 100}%` }}>
                  <div style={{ width: `${(b.wins / b.games) * 100}%`, background: '#4ecdc4' }} />
                  <div style={{ flex: 1, background: '#7a3a40' }} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
              <div style={{ width: 34, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', opacity: hasData ? 1 : 0.35 }}>
                {hasData ? `${(b.winRate * 100).toFixed(0)}%` : '—'}
              </div>
              <div style={{ width: 28, fontSize: 11, color: 'var(--text-secondary)', opacity: hasData ? 1 : 0.35 }}>
                {b.wins}/{b.games}
              </div>
            </div>
          </div>
        )
      })}
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

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <PercentileCard label="Champ Picks" percentile={data.percentiles?.cpq ?? null}    rawValue={data.championPickQuality} delta={fmtPct(data.championPickQuality)} />
        <PercentileCard label="Aug Picks"   percentile={data.percentiles?.apq ?? null}    rawValue={data.augmentPickQuality}   delta={fmtPct(data.augmentPickQuality)} />
        <PercentileCard label="KP% Δ"       percentile={data.percentiles?.kpDelta ?? null} rawValue={data.kpDelta}             delta={fmtPct(data.kpDelta)} />
        <PercentileCard label="DPM Δ"       percentile={data.percentiles?.dpmPct ?? null}  rawValue={data.dpmPct}              delta={fmtPct(data.dpmPct)} />
        <PercentileCard label="GPM Δ"       percentile={data.percentiles?.gpmPct ?? null}  rawValue={data.gpmPct}              delta={fmtPct(data.gpmPct)} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Win Rate by Role</div>
        <RoleBarChart buckets={data.classBuckets} />
      </div>
    </div>
  )
}

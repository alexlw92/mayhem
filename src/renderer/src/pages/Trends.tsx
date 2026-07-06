import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'

const api = (window as any).api

interface TrendPoint {
  date: string
  winRate: number
  games: number
}

interface PlayerStats {
  puuid: string
  summonerName: string
  games: number
}

const COLORS = ['#4fa3e0', '#c89b3c', '#3cb878', '#d44c4c', '#9b59b6']

interface Props {
  initialPuuid: string | null
  players: PlayerStats[]
}

export default function Trends({ initialPuuid, players }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [trends, setTrends] = useState<Record<string, TrendPoint[]>>({})
  const [days, setDays] = useState(30)
  const loading = players.length === 0

  useEffect(() => {
    if (players.length === 0) return
    setSelected(initialPuuid ? [initialPuuid] : [players[0].puuid])
  }, [initialPuuid, players])

  useEffect(() => {
    if (selected.length === 0) return

    Promise.all(
      selected.map((puuid) =>
        api.db.winRateTrend(puuid, days).then((data: TrendPoint[]) => ({ puuid, data }))
      )
    ).then((results) => {
      const map: Record<string, TrendPoint[]> = {}
      for (const r of results) map[r.puuid] = r.data
      setTrends(map)
    })
  }, [selected, days])

  const togglePlayer = (puuid: string) => {
    setSelected((prev) =>
      prev.includes(puuid) ? prev.filter((p) => p !== puuid) : [...prev, puuid]
    )
  }

  // Merge all selected players' trend data by date
  const allDates = [
    ...new Set(
      selected.flatMap((puuid) => (trends[puuid] ?? []).map((p) => p.date))
    )
  ].sort()

  const chartData = allDates.map((date) => {
    const point: Record<string, string | number> = { date }
    for (const puuid of selected) {
      const match = (trends[puuid] ?? []).find((p) => p.date === date)
      const player = players.find((p) => p.puuid === puuid)
      if (match && player) {
        point[player.summonerName] = parseFloat(match.winRate.toFixed(1))
      }
    }
    return point
  })

  if (loading) return <div className="empty-state">Loading…</div>

  return (
    <div>
      <h1 className="page-title">Win Rate Trends</h1>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Players</span>
        {players.map((p, i) => (
          <button
            key={p.puuid}
            onClick={() => togglePlayer(p.puuid)}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: `1px solid ${selected.includes(p.puuid) ? COLORS[i % COLORS.length] : 'var(--border)'}`,
              background: selected.includes(p.puuid)
                ? `${COLORS[i % COLORS.length]}22`
                : 'var(--bg-primary)',
              color: selected.includes(p.puuid) ? COLORS[i % COLORS.length] : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: selected.includes(p.puuid) ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {p.summonerName}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${days === d ? 'var(--accent)' : 'var(--border)'}`,
                background: days === d ? 'rgba(200,155,60,0.15)' : 'var(--bg-primary)',
                color: days === d ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: '20px 8px' }}>
        {chartData.length === 0 ? (
          <div className="empty-state">
            <div>No trend data</div>
            <p>Play more games to see trends</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#8a9bb5', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1e3a5f' }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#8a9bb5', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1e3a5f' }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a2235',
                  border: '1px solid #1e3a5f',
                  borderRadius: 8,
                  fontSize: 12
                }}
                formatter={(value: number) => [`${value}%`, undefined]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: '#8a9bb5', paddingTop: 16 }}
              />
              {selected.map((puuid, i) => {
                const player = players.find((p) => p.puuid === puuid)
                if (!player) return null
                return (
                  <Line
                    key={puuid}
                    type="monotone"
                    dataKey={player.summonerName}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: COLORS[i % COLORS.length] }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

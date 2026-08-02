import { useState, useEffect } from 'react'
import ChampionStatsTable, { ChampionStat } from '../components/ChampionStatsTable'

const api = (window as any).api

const MIN_GAMES_OPTIONS = [0, 20, 50, 100]

interface Props {
  selectedPatches: string[] | null
  selectedMode?: number
  onChampionClick?: (championId: number, championName: string) => void
}

export default function Champions({ selectedPatches, selectedMode, onChampionClick }: Props) {
  const [data, setData] = useState<ChampionStat[]>([])
  const [search, setSearch] = useState('')
  const [minGames, setMinGames] = useState(20)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    api.db.championStats(undefined, selectedPatches, selectedMode ?? 2400).then((d: ChampionStat[]) => {
      setData(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedPatches, selectedMode])

  const filtered = data.filter(
    (c) => c.games >= minGames && c.championName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h1 className="page-title">Champions</h1>

      <div className="filters card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' }}>
        <input
          className="search-input"
          placeholder="Search champion…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Min games</span>
        {MIN_GAMES_OPTIONS.map((n) => (
          <button
            key={n}
            className={`sort-btn ${minGames === n ? 'active' : ''}`}
            onClick={() => setMinGames(n)}
          >
            {n === 0 ? 'All' : n}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">Loading…</div></div>
      ) : data.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div>No champion data</div>
            <p>Sync some games first</p>
          </div>
        </div>
      ) : (
        <ChampionStatsTable data={filtered} onChampionClick={onChampionClick} />
      )}
    </div>
  )
}

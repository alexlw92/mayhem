import { useState, useEffect } from 'react'
import AugmentStatsTable, { AugmentStat } from '../components/AugmentStatsTable'

const api = (window as any).api

interface ChampionOption {
  championId: number
  championName: string
}

const championListCache = new Map<string, ChampionOption[]>()
const augmentStatsCache = new Map<string, AugmentStat[]>()
api.on('sync-complete', () => {
  championListCache.clear()
  augmentStatsCache.clear()
})

const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']

const SELECT_STYLE = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  padding: '6px 10px',
  fontSize: 12,
  outline: 'none',
}

interface Props {
  selectedPatches: string[] | null
  selectedMode?: number
  initialChampionId?: number
  onMounted?: () => void
  onAugmentClick?: (augmentId: number) => void
}

export default function Augments({ selectedPatches, selectedMode, initialChampionId, onMounted, onAugmentClick }: Props) {
  const [selectedChampionId, setSelectedChampionId] = useState<number | undefined>(initialChampionId)
  const [champions, setChampions] = useState<ChampionOption[]>([])
  const [data, setData] = useState<AugmentStat[]>([])
  const [rarityFilter, setRarityFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [minPicks, setMinPicks] = useState(20)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (initialChampionId !== undefined) {
      setSelectedChampionId(initialChampionId)
      onMounted?.()
    }
  }, [initialChampionId])

  useEffect(() => {
    if (selectedPatches === null) return
    const key = `${selectedMode ?? 2400}:${selectedPatches.join(',')}`
    const cached = championListCache.get(key)
    if (cached) { setChampions(cached); return }
    api.db.championStats(undefined, selectedPatches, selectedMode ?? 2400).then((stats: { championId: number; championName: string }[]) => {
      const sorted = stats
        .map((s) => ({ championId: s.championId, championName: s.championName }))
        .sort((a, b) => a.championName.localeCompare(b.championName))
      championListCache.set(key, sorted)
      setChampions(sorted)
    }).catch(() => {})
  }, [selectedPatches, selectedMode])

  useEffect(() => {
    if (selectedPatches === null) return
    const key = `${selectedMode ?? 2400}:${selectedPatches.join(',')}-${selectedChampionId ?? 'all'}`
    const cached = augmentStatsCache.get(key)
    if (cached) { setData(cached); setLoading(false); return }
    setLoading(true)
    api.db.augmentStats(undefined, selectedChampionId, selectedPatches, selectedMode ?? 2400).then((d: AugmentStat[]) => {
      augmentStatsCache.set(key, d)
      setData(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedChampionId, selectedPatches, selectedMode])

  const filtered = data.filter((a) => {
    if (a.pickCount < minPicks) return false
    if (rarityFilter !== null && a.rarity !== rarityFilter) return false
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div>
      <h1 className="page-title">Augments</h1>

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedChampionId ?? ''}
            onChange={(e) => setSelectedChampionId(e.target.value ? Number(e.target.value) : undefined)}
            style={SELECT_STYLE}
          >
            <option value="">All Champions</option>
            {champions.map((c) => (
              <option key={c.championId} value={c.championId}>{c.championName}</option>
            ))}
          </select>

          <input
            style={{ ...SELECT_STYLE, width: 180, padding: '6px 12px' }}
            placeholder="Search augment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
              {['Silver', 'Gold', 'Prismatic'][r]}
            </button>
          ))}

          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />

          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Min picks</span>
          {[0, 20, 50, 100].map((n) => (
            <button
              key={n}
              className={`aug-btn ${minPicks === n ? 'active' : ''}`}
              onClick={() => setMinPicks(n)}
            >
              {n === 0 ? 'All' : n}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty-state">Loading…</div></div>
      ) : data.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div>No augment data</div>
            <p>Sync some games first</p>
          </div>
        </div>
      ) : (
        <AugmentStatsTable data={filtered} onAugmentClick={onAugmentClick} />
      )}
    </div>
  )
}

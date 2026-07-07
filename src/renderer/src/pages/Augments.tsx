import { useState, useEffect } from 'react'
import { Player } from '../App'

const api = (window as any).api

interface AugmentStat {
  augmentId: number
  name: string
  rarity: number
  iconPath: string
  pickCount: number
  wins: number
  avgDpm: number
}

interface ChampionOption {
  championId: number
  championName: string
}

type SortKey = 'pickCount' | 'winRate' | 'avgDpm'

const RARITY_LABEL = ['Silver', 'Gold', 'Prismatic']
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
  players: Player[]
  selectedPatches: string[] | null
  initialChampionId?: number
  onMounted?: () => void
  onAugmentClick?: (augmentId: number) => void
}

export default function Augments({ players, selectedPatches, initialChampionId, onMounted, onAugmentClick }: Props) {
  const [selectedPuuid, setSelectedPuuid] = useState<string | undefined>(undefined)
  const [selectedChampionId, setSelectedChampionId] = useState<number | undefined>(initialChampionId)
  const [champions, setChampions] = useState<ChampionOption[]>([])
  const [data, setData] = useState<AugmentStat[]>([])
  const [sort, setSort] = useState<SortKey>('pickCount')
  const [rarityFilter, setRarityFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (initialChampionId !== undefined) {
      setSelectedChampionId(initialChampionId)
      onMounted?.()
    }
  }, [initialChampionId])

  useEffect(() => {
    if (selectedPatches === null) return
    api.db.championStats(selectedPuuid, selectedPatches).then((stats: { championId: number; championName: string }[]) => {
      setChampions(
        stats
          .map((s) => ({ championId: s.championId, championName: s.championName }))
          .sort((a, b) => a.championName.localeCompare(b.championName))
      )
      setSelectedChampionId(undefined)
    }).catch(() => {})
  }, [selectedPuuid, selectedPatches])

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    api.db.augmentStats(selectedPuuid, selectedChampionId, selectedPatches).then((d: AugmentStat[]) => {
      setData(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedPuuid, selectedChampionId, selectedPatches])

  const filtered = data
    .filter((a) => {
      if (rarityFilter !== null && a.rarity !== rarityFilter) return false
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      if (sort === 'pickCount') return b.pickCount - a.pickCount
      if (sort === 'winRate') {
        const wrA = a.pickCount > 0 ? a.wins / a.pickCount : 0
        const wrB = b.pickCount > 0 ? b.wins / b.pickCount : 0
        return wrB - wrA
      }
      if (sort === 'avgDpm') return b.avgDpm - a.avgDpm
      return 0
    })

  return (
    <div>
      <h1 className="page-title">Augments</h1>

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Row 1: data filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedPuuid ?? ''}
            onChange={(e) => setSelectedPuuid(e.target.value || undefined)}
            style={SELECT_STYLE}
          >
            <option value="">All Players</option>
            {players.map((p) => (
              <option key={p.puuid} value={p.puuid}>{p.summonerName}</option>
            ))}
          </select>

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

        {/* Row 2: rarity + sort */}
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
              {RARITY_LABEL[r]}
            </button>
          ))}

          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />

          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Sort</span>
          {(['pickCount', 'winRate', 'avgDpm'] as SortKey[]).map((key) => (
            <button
              key={key}
              className={`aug-btn ${sort === key ? 'active' : ''}`}
              onClick={() => setSort(key)}
            >
              {key === 'pickCount' ? 'Picks' : key === 'winRate' ? 'Win Rate' : 'DPM'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div>No augment data</div>
            <p>{data.length > 0 ? 'No augments match the current filters' : 'Sync some games first'}</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Augment</th>
                <th>Rarity</th>
                <th>Picks</th>
                <th>Win Rate</th>
                <th>Avg DPM</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
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
                        <div style={{
                          width: 24, height: 24, borderRadius: 4, border: `1px solid ${rarityColor}`,
                          overflow: 'hidden', flexShrink: 0, background: 'var(--bg-primary)',
                        }}>
                          {a.iconPath && (
                            <img
                              src={a.iconPath}
                              alt={a.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          )}
                        </div>
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
                        <div style={{ width: 60, height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${wr * 100}%`, height: '100%', background: wr >= 0.5 ? 'var(--green)' : 'var(--red)', borderRadius: 3 }} />
                        </div>
                        <span className={wr >= 0.5 ? 'win' : 'loss'}>{(wr * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td>{Math.round(a.avgDpm)}/min</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .aug-btn { padding: 4px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s; }
        .aug-btn:hover { border-color: var(--blue); color: var(--text-primary); }
        .aug-btn.active { border-color: var(--accent); color: var(--accent); }
      `}</style>
    </div>
  )
}

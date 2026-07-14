import { useState, useEffect } from 'react'

const api = (window as any).api

interface ItemMeta {
  id: number
  name: string
  iconPath: string
  category: string
}

interface BuildRow {
  build: number[]
  games: number
  wins: number
  items: ItemMeta[]
}

interface Archetype {
  coreIds: [number, number, number]
  coreItems: [ItemMeta, ItemMeta, ItemMeta]
  variants: BuildRow[]
  games: number
  wins: number
}

interface PickRow {
  itemId: number
  picks: number
  wins: number
  name: string
  iconPath: string
  category: string
}

interface Props {
  championId: number
  selectedPatches: string[] | null
  metaKey?: number
}

export default function Items({ championId, selectedPatches, metaKey }: Props) {
  const [archetypes, setArchetypes] = useState<Archetype[]>([])
  const [picks, setPicks] = useState<PickRow[]>([])
  const [loading, setLoading] = useState(false)
  const [totalGames, setTotalGames] = useState(0)

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    Promise.all([
      api.db.itemArchetypes(championId, selectedPatches),
      api.db.itemPickRates(championId, selectedPatches),
    ]).then(([a, p]: [Archetype[], PickRow[]]) => {
      setArchetypes(a)
      setPicks(p)
      const maxPicks = p.length > 0 ? Math.max(...p.map((r) => r.picks)) : 0
      setTotalGames(maxPicks)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [championId, selectedPatches, metaKey])

  if (loading) return <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '16px 0' }}>Loading…</div>

  if (picks.length === 0) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '16px 0' }}>
        No item data yet — only games synced after this feature was enabled will have items.
      </div>
    )
  }

  const boots = picks.filter((p) => p.category === 'Boots')
  const regularItems = picks.filter((p) => p.category !== 'Boots')

  return (
    <div>
      {boots.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Boots</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px', fontWeight: 400 }}>Item</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>Picks</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>Pick%</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>WR%</th>
              </tr>
            </thead>
            <tbody>
              {boots.map((b) => (
                <tr key={b.itemId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ItemIcon iconPath={b.iconPath} name={b.name} size={28} />
                      <span>{b.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{b.picks}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {totalGames > 0 ? `${((b.picks / totalGames) * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: b.picks > 0 ? wrColor(b.wins / b.picks) : 'var(--text-secondary)' }}>
                    {b.picks > 0 ? `${((b.wins / b.picks) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {archetypes.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Build Paths</div>
          <BuildPaths archetypes={archetypes} totalGames={totalGames} />
        </section>
      )}

      {regularItems.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Most Built</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px', fontWeight: 400 }}>Item</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>Picks</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>Pick%</th>
                <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>WR%</th>
              </tr>
            </thead>
            <tbody>
              {regularItems.slice(0, 20).map((item) => (
                <tr key={item.itemId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ItemIcon iconPath={item.iconPath} name={item.name} size={28} />
                      <span>{item.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{item.picks}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {totalGames > 0 ? `${((item.picks / totalGames) * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: item.picks > 0 ? wrColor(item.wins / item.picks) : 'var(--text-secondary)' }}>
                    {item.picks > 0 ? `${((item.wins / item.picks) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function BuildPaths({ archetypes, totalGames }: { archetypes: Archetype[]; totalGames: number }) {
  const minGames = Math.max(totalGames * 0.01, 5)
  const visible = archetypes.filter(a => a.games >= minGames)

  if (visible.length === 0) {
    return null
  }

  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const globalFreq = new Map<number, number>()
  for (const arch of visible) {
    for (const v of arch.variants) {
      for (const id of v.build) {
        globalFreq.set(id, (globalFreq.get(id) ?? 0) + v.games)
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {visible.map((arch, ai) => {
        const wr = arch.games > 0 ? arch.wins / arch.games : 0
        const sortedCore = [...arch.coreItems].sort(
          (a, b) => (globalFreq.get(b.id) ?? 0) - (globalFreq.get(a.id) ?? 0)
        )
        const isOpen = expanded.has(ai)
        const toggle = () => setExpanded(prev => {
          const next = new Set(prev)
          isOpen ? next.delete(ai) : next.add(ai)
          return next
        })
        return (
          <div key={ai} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div
              onClick={toggle}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-secondary)', cursor: 'pointer', userSelect: 'none' }}
            >
              <ItemIcon iconPath={sortedCore[0].iconPath} name={sortedCore[0].name} size={32} />
              <ItemIcon iconPath={sortedCore[1].iconPath} name={sortedCore[1].name} size={32} />
              <ItemIcon iconPath={sortedCore[2].iconPath} name={sortedCore[2].name} size={32} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>
                {arch.games} games
              </span>
              <span style={{ fontSize: 12, color: wrColor(wr), marginLeft: 4 }}>
                {(wr * 100).toFixed(1)}% WR
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>
            {isOpen && (() => {
              const flexStats = new Map<number, { item: ItemMeta; picks: number; wins: number }>()
              for (const v of arch.variants) {
                for (const fi of v.items.filter(i => !arch.coreIds.includes(i.id))) {
                  const s = flexStats.get(fi.id) ?? { item: fi, picks: 0, wins: 0 }
                  s.picks += v.games
                  s.wins += v.wins
                  flexStats.set(fi.id, s)
                }
              }
              const sortedFlex = [...flexStats.values()].sort((a, b) => b.picks - a.picks)
              if (sortedFlex.length === 0) return null
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {sortedFlex.map(({ item: fi, picks, wins }) => (
                      <tr key={fi.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 12 }}>+</span>
                            <ItemIcon iconPath={fi.iconPath} name={fi.name} size={26} />
                            <span style={{ fontSize: 12 }}>{fi.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{picks} picks</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', color: picks > 0 ? wrColor(wins / picks) : 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {picks > 0 ? `${((wins / picks) * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

function ItemIcon({ iconPath, name, size }: { iconPath: string; name: string; size: number }) {
  return (
    <div title={name} style={{ width: size, height: size, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
      {iconPath ? (
        <img
          src={iconPath}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--text-secondary)' }}>?</div>
      )}
    </div>
  )
}

function wrColor(wr: number): string {
  if (wr >= 0.55) return 'var(--green)'
  if (wr <= 0.45) return 'var(--red)'
  return 'var(--text-primary)'
}

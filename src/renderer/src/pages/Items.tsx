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

function clusterBuilds(builds: BuildRow[]): Archetype[] {
  const trioMap = new Map<string, { ids: [number, number, number]; games: number; wins: number; combos: BuildRow[] }>()
  for (const b of builds) {
    const items = b.build
    for (let i = 0; i < items.length - 2; i++)
      for (let j = i + 1; j < items.length - 1; j++)
        for (let k = j + 1; k < items.length; k++) {
          const key = `${items[i]}-${items[j]}-${items[k]}`
          const entry = trioMap.get(key) ?? { ids: [items[i], items[j], items[k]], games: 0, wins: 0, combos: [] }
          entry.games += b.games
          entry.wins += b.wins
          entry.combos.push(b)
          trioMap.set(key, entry)
        }
  }

  const sortedTrios = [...trioMap.values()].sort((a, b) => b.games - a.games)
  const assigned = new Set<BuildRow>()
  const archetypes: Archetype[] = []

  for (const trio of sortedTrios) {
    if (archetypes.length >= 10) break
    const unassigned = trio.combos.filter(b => !assigned.has(b))
    if (unassigned.length === 0) continue
    unassigned.forEach(b => assigned.add(b))
    const findItem = (id: number): ItemMeta =>
      unassigned.flatMap(b => b.items).find(i => i.id === id) ?? { id, name: `Item ${id}`, iconPath: '', category: '' }
    archetypes.push({
      coreIds: trio.ids,
      coreItems: [findItem(trio.ids[0]), findItem(trio.ids[1]), findItem(trio.ids[2])],
      variants: [...unassigned].sort((a, b) => b.games - a.games),
      games: unassigned.reduce((s, b) => s + b.games, 0),
      wins: unassigned.reduce((s, b) => s + b.wins, 0),
    })
  }

  const sorted = archetypes.sort((a, b) => b.games - a.games)
  const minGames = (sorted[0]?.games ?? 0) * 0.01
  return sorted.filter(a => a.games >= minGames)
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
  const [builds, setBuilds] = useState<BuildRow[]>([])
  const [picks, setPicks] = useState<PickRow[]>([])
  const [loading, setLoading] = useState(false)
  const [totalGames, setTotalGames] = useState(0)

  useEffect(() => {
    if (selectedPatches === null) return
    setLoading(true)
    Promise.all([
      api.db.itemBuilds(championId, selectedPatches),
      api.db.itemPickRates(championId, selectedPatches),
    ]).then(([b, p]: [BuildRow[], PickRow[]]) => {
      setBuilds(b)
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

      {builds.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Build Paths</div>
          <BuildPaths builds={builds} />
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

function BuildPaths({ builds }: { builds: BuildRow[] }) {
  const archetypes = builds.length >= 3 ? clusterBuilds(builds) : []

  if (archetypes.length === 0) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
            <th style={{ padding: '4px 8px', fontWeight: 400 }}>Items</th>
            <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>Games</th>
            <th style={{ padding: '4px 8px', fontWeight: 400, textAlign: 'right' }}>WR%</th>
          </tr>
        </thead>
        <tbody>
          {builds.map((b, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px' }}>
                <div style={{ display: 'flex', gap: 4 }}>{b.items.map(item => <ItemIcon key={item.id} iconPath={item.iconPath} name={item.name} size={32} />)}</div>
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{b.games}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: b.games > 0 ? wrColor(b.wins / b.games) : 'var(--text-secondary)' }}>
                {b.games > 0 ? `${((b.wins / b.games) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const globalFreq = new Map<number, number>()
  for (const b of builds) {
    for (const id of b.build) {
      globalFreq.set(id, (globalFreq.get(id) ?? 0) + b.games)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {archetypes.map((arch, ai) => {
        const wr = arch.games > 0 ? arch.wins / arch.games : 0
        const sortedCore = [...arch.coreItems].sort(
          (a, b) => (globalFreq.get(b.id) ?? 0) - (globalFreq.get(a.id) ?? 0)
        )
        return (
          <div key={ai} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-secondary)' }}>
              <ItemIcon iconPath={sortedCore[0].iconPath} name={sortedCore[0].name} size={32} />
              <ItemIcon iconPath={sortedCore[1].iconPath} name={sortedCore[1].name} size={32} />
              <ItemIcon iconPath={sortedCore[2].iconPath} name={sortedCore[2].name} size={32} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>
                {arch.games} games
              </span>
              <span style={{ fontSize: 12, color: wrColor(wr), marginLeft: 4 }}>
                {(wr * 100).toFixed(1)}% WR
              </span>
            </div>
            {(() => {
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

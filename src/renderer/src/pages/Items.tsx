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
  openingId: number
  openingItem: ItemMeta
  archetypeLabel: string | null
  starterId?: number | null
  coreIds: number[]
  coreItems: ItemMeta[]
  variants: BuildRow[]
  games: number
  wins: number
  orGroups?: ItemMeta[][]
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

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 8,
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
    ]).then(([a, pr]: [Archetype[], { totalGames: number; items: PickRow[] }]) => {
      setArchetypes(a)
      setPicks(pr.items)
      setTotalGames(pr.totalGames)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [championId, selectedPatches, metaKey])

  if (loading) return <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '16px 0' }}>Loading…</div>

  if (picks.length === 0 && archetypes.length === 0) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '16px 0' }}>
        No item data yet — only games synced after this feature was enabled will have items.
      </div>
    )
  }

  const minBootPicks = Math.max(totalGames * 0.05, 10)
  const boots = picks.filter((p) => p.category === 'Boots' && p.picks >= minBootPicks)
  const regularItems = picks.filter((p) => p.category !== 'Boots')

  return (
    <div>
      {archetypes.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Build Paths</div>
          <BuildPaths archetypes={archetypes} totalGames={totalGames} />
        </section>
      )}

      {archetypes.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Item Archetypes</div>
          <ItemArchetypes archetypes={archetypes} totalGames={totalGames} />
        </section>
      )}

      {boots.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Boots Stats</div>
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

      {regularItems.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Item Stats</div>
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
              {regularItems.filter(item => item.picks >= Math.max(totalGames * 0.01, 2)).slice(0, 20).map((item) => (
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

function ItemArchetypes({ archetypes, totalGames }: { archetypes: Archetype[]; totalGames: number }) {
  const visible = archetypes
    .sort((a, b) => b.games - a.games)
    .filter(a => a.games >= Math.max(totalGames * 0.00, 2))
    .slice(0, 8)
  if (visible.length === 0) return null

  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {visible.map((arch, i) => {
        const wr = arch.games > 0 ? arch.wins / arch.games : 0
        const isOpen = expanded.has(i)
        const toggle = () => setExpanded(prev => {
          const next = new Set(prev)
          isOpen ? next.delete(i) : next.add(i)
          return next
        })

        const shownIds = new Set([arch.openingId, ...arch.coreIds])
        const flexStats = new Map<number, { item: ItemMeta; picks: number; wins: number }>()
        for (const v of arch.variants) {
          for (const fi of v.items.filter(item => !shownIds.has(item.id) && item.category !== 'Boots' && item.name !== '')) {
            const s = flexStats.get(fi.id) ?? { item: fi, picks: 0, wins: 0 }
            s.picks += v.games
            s.wins += v.wins
            flexStats.set(fi.id, s)
          }
        }
        const minFlexPicks = Math.max(arch.games * 0.01, 2)
        const sortedFlex = [...flexStats.values()]
          .sort((a, b) => b.picks - a.picks)
          .filter(f => f.picks >= minFlexPicks)

        return (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div
              onClick={toggle}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-secondary)', cursor: 'pointer', userSelect: 'none' }}
            >
              <ItemIcon iconPath={arch.openingItem.iconPath} name={arch.openingItem.name} size={30} />
              {arch.coreItems.map(ci => (
                <span key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Arrow />
                  <ItemIcon iconPath={ci.iconPath} name={ci.name} size={30} />
                </span>
              ))}
              {arch.archetypeLabel && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-primary)', borderRadius: 3, padding: '1px 5px', marginLeft: 2 }}>
                  {arch.archetypeLabel}
                </span>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                {arch.games} games
              </span>
              <span style={{ fontSize: 12, color: wrColor(wr), marginLeft: 8 }}>
                {(wr * 100).toFixed(1)}% WR
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 8 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>

            {isOpen && sortedFlex.length > 0 && (() => {
              const orItemIds = new Set((arch.orGroups ?? []).flatMap(g => g.map(i => i.id)))
              const nonOrFlex = sortedFlex.filter(f => !orItemIds.has(f.item.id))
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {(arch.orGroups ?? []).map((group, gi) => {
                      const members = group
                        .map(item => flexStats.get(item.id))
                        .filter((s): s is { item: ItemMeta; picks: number; wins: number } => s != null)
                        .sort((a, b) => b.picks - a.picks)
                      if (members.length < 2) return null
                      return (
                        <tr key={`or-${gi}`} style={{ borderTop: '1px solid var(--border)' }}>
                          <td colSpan={3} style={{ padding: '6px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {members.map((s, si) => (
                                <span key={s.item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {si > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>or</span>}
                                  <ItemIcon iconPath={s.item.iconPath} name={s.item.name} size={22} />
                                  <span style={{ fontSize: 12 }}>{s.item.name}</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                    ({s.picks} · {s.picks > 0 ? `${((s.wins / s.picks) * 100).toFixed(0)}%` : '—'})
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {nonOrFlex.map(({ item: fi, picks, wins }) => (
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


function BuildPaths({ archetypes, totalGames }: { archetypes: Archetype[]; totalGames: number }) {
  const minGames = Math.max(totalGames * 0.01, 2)
  const visible = archetypes.filter(a => a.games >= minGames).slice(0, 8)

  if (visible.length === 0) return null

  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {visible.map((arch, ai) => {
        const wr = arch.games > 0 ? arch.wins / arch.games : 0
        const isOpen = expanded.has(ai)
        const toggle = () => setExpanded(prev => {
          const next = new Set(prev)
          isOpen ? next.delete(ai) : next.add(ai)
          return next
        })

        // Order archetype items: starter (from ITEM_ARCHETYPES) first, then rest in frequency order
        const archetypeItems = [arch.openingItem, ...arch.coreItems].filter(Boolean) as ItemMeta[]
        const starterIdx = (arch.starterId ?? null) != null
          ? archetypeItems.findIndex(i => i.id === arch.starterId)
          : -1
        const orderedArch = starterIdx > 0
          ? [archetypeItems[starterIdx], ...archetypeItems.filter((_, i) => i !== starterIdx)]
          : archetypeItems

        // Top boot from variants
        const bootFreq = new Map<number, { item: ItemMeta; picks: number }>()
        for (const v of arch.variants) {
          for (const item of v.items) {
            if (item.category !== 'Boots') continue
            const s = bootFreq.get(item.id) ?? { item, picks: 0 }
            s.picks += v.games
            bootFreq.set(item.id, s)
          }
        }
        const topBoot = [...bootFreq.values()].sort((a, b) => b.picks - a.picks)[0]?.item ?? null

        // 5-slot sequence: [starter/arch1] → [boots] → [arch2] → [arch3] → [arch4]
        const archIds = new Set(archetypeItems.map(i => i.id))
        const displayItems = [orderedArch[0], topBoot, orderedArch[1], orderedArch[2], orderedArch[3]]
          .filter((x): x is ItemMeta => x != null)

        return (
          <div key={ai} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div
              onClick={toggle}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-secondary)', cursor: 'pointer', userSelect: 'none' }}
            >
              <>
                {displayItems.map((item, idx) => (
                  <span key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {idx > 0 && <Arrow />}
                    <ItemIcon iconPath={item.iconPath} name={item.name} size={30} />
                  </span>
                ))}
              </>

              {arch.archetypeLabel && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', background: 'var(--bg-primary)', borderRadius: 3, padding: '1px 5px', marginLeft: 2 }}>
                  {arch.archetypeLabel}
                </span>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                {arch.games} games
              </span>
              <span style={{ fontSize: 12, color: wrColor(wr), marginLeft: 8 }}>
                {(wr * 100).toFixed(1)}% WR
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 8 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>

            {isOpen && (() => {
              const flexStats = new Map<number, { item: ItemMeta; picks: number; wins: number }>()
              for (const v of arch.variants) {
                for (const fi of v.items.filter(i => !archIds.has(i.id) && i.category !== 'Boots' && i.name !== '')) {
                  const s = flexStats.get(fi.id) ?? { item: fi, picks: 0, wins: 0 }
                  s.picks += v.games
                  s.wins += v.wins
                  flexStats.set(fi.id, s)
                }
              }
              const minFlexPicks = Math.max(arch.games * 0.01, 2)
              const sortedFlex = [...flexStats.values()]
                .sort((a, b) => b.picks - a.picks)
                .filter(f => f.picks >= minFlexPicks)
              if (sortedFlex.length === 0 && arch.orGroups.length === 0) return null
              const orItemIds = new Set((arch.orGroups ?? []).flatMap(g => g.map(i => i.id)))
              const nonOrFlex = sortedFlex.filter(f => !orItemIds.has(f.item.id))
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {(arch.orGroups ?? []).map((group, gi) => {
                      const members = group
                        .map(item => flexStats.get(item.id))
                        .filter((s): s is { item: ItemMeta; picks: number; wins: number } => s != null)
                        .sort((a, b) => b.picks - a.picks)
                      if (members.length < 2) return null
                      return (
                        <tr key={`or-${gi}`} style={{ borderTop: '1px solid var(--border)' }}>
                          <td colSpan={3} style={{ padding: '6px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {members.map((s, si) => (
                                <span key={s.item.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {si > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>or</span>}
                                  <ItemIcon iconPath={s.item.iconPath} name={s.item.name} size={22} />
                                  <span style={{ fontSize: 12 }}>{s.item.name}</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                    ({s.picks} · {s.picks > 0 ? `${((s.wins / s.picks) * 100).toFixed(0)}%` : '—'})
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {nonOrFlex.map(({ item: fi, picks, wins }) => (
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

function Arrow() {
  return (
    <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>›</span>
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
  if (wr > 0.5) return 'var(--green)'
  if (wr < 0.5) return 'var(--red)'
  return 'var(--text-primary)'
}

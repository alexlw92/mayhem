import { useState, useEffect } from 'react'

const api = (window as any).api

interface ItemMeta {
  id: number
  name: string
  iconPath: string
  category: string
}

interface Archetype {
  openingId: number
  openingItem: ItemMeta
  coreIds: number[]
  coreItems: ItemMeta[]
  games: number
  wins: number
  boots: { item: ItemMeta; picks: number; pickRate: number; wins: number }[]
  fifthItems: { item: ItemMeta; picks: number; pickRate: number; wins: number }[]
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
      <style>{`
        .item-wr-bar { display: inline-block; width: 48px; height: 5px; background: var(--bg-primary); border-radius: 3px; overflow: hidden; vertical-align: middle; margin-left: 6px; }
        .item-wr-fill { height: 100%; border-radius: 3px; }
      `}</style>

      {archetypes.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Build Paths</div>
          <BuildPaths archetypes={archetypes} totalGames={totalGames} />
        </section>
      )}

      {boots.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Boots Stats</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              <col style={{ width: 56 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: 110 }} />
            </colgroup>
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
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {b.picks > 0 ? (
                      <>
                        <span className="item-wr-bar" style={{ marginLeft: 0, marginRight: 6 }}>
                          <span className="item-wr-fill" style={{ width: `${(b.wins / b.picks) * 100}%`, background: b.wins / b.picks >= 0.5 ? 'var(--green)' : 'var(--red)' }} />
                        </span>
                        <span style={{ color: wrColor(b.wins / b.picks) }}>{((b.wins / b.picks) * 100).toFixed(1)}%</span>
                      </>
                    ) : '—'}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              <col style={{ width: 56 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: 110 }} />
            </colgroup>
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
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {item.picks > 0 ? (
                      <>
                        <span className="item-wr-bar" style={{ marginLeft: 0, marginRight: 6 }}>
                          <span className="item-wr-fill" style={{ width: `${(item.wins / item.picks) * 100}%`, background: item.wins / item.picks >= 0.5 ? 'var(--green)' : 'var(--red)' }} />
                        </span>
                        <span style={{ color: wrColor(item.wins / item.picks) }}>{((item.wins / item.picks) * 100).toFixed(1)}%</span>
                      </>
                    ) : '—'}
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
  const minGames = Math.max(totalGames * 0.005, 2)
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

        const boots = arch.boots ?? []
        const fifthItems = arch.fifthItems ?? []
        const topBoots = boots[0]?.item ?? null
        const topFifth = fifthItems[0]?.item ?? null

        return (
          <div key={ai} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <div
              onClick={toggle}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-secondary)', cursor: 'pointer', userSelect: 'none' }}
            >
              {/* Group 1: Opener */}
              <ItemIcon iconPath={arch.openingItem.iconPath} name={arch.openingItem.name} size={30} />
              <Arrow />
              {/* Group 2: Boots slot */}
              {topBoots
                ? <ItemIcon iconPath={topBoots.iconPath} name={topBoots.name} size={30} />
                : <PlaceholderIcon size={30} />
              }
              <Arrow />
              {/* Group 3: Core items 2–4 */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {arch.coreItems.map((item) => (
                  <ItemIcon key={item.id} iconPath={item.iconPath} name={item.name} size={30} />
                ))}
              </span>
              <Arrow />
              {/* Group 4: Top 5th item slot */}
              {topFifth
                ? <ItemIcon iconPath={topFifth.iconPath} name={topFifth.name} size={30} />
                : <PlaceholderIcon size={30} />
              }
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                {arch.games} games
                {totalGames > 0 && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                    ({((arch.games / totalGames) * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, color: wrColor(wr), marginLeft: 8 }}>
                {(wr * 100).toFixed(1)}% WR
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 8 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>

            {isOpen && (boots.length > 0 || fifthItems.length > 0) && (
              <div style={{ borderTop: '1px solid var(--border)', display: 'flex' }}>
                {/* Boots column */}
                <div style={{ flex: 1, borderRight: boots.length > 0 && fifthItems.length > 0 ? '1px solid var(--border)' : 'none' }}>
                  {boots.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 10px 2px' }}>Boots</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <tbody>
                          {boots.slice(0, 3).map(({ item, picks, pickRate, wins }) => (
                            <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <ItemIcon iconPath={item.iconPath} name={item.name} size={24} />
                                  <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                                </div>
                              </td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{picks}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{(pickRate * 100).toFixed(0)}%</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {picks > 0 ? <span style={{ color: wrColor(wins / picks) }}>{((wins / picks) * 100).toFixed(1)}%</span> : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
                {/* 5th Item column */}
                <div style={{ flex: 1 }}>
                  {fifthItems.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 10px 2px' }}>5th Item</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <tbody>
                          {fifthItems.slice(0, 5).map(({ item, picks, pickRate, wins }) => (
                            <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '5px 10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <ItemIcon iconPath={item.iconPath} name={item.name} size={24} />
                                  <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                                </div>
                              </td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{picks}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{(pickRate * 100).toFixed(0)}%</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {picks > 0 ? <span style={{ color: wrColor(wins / picks) }}>{((wins / picks) * 100).toFixed(1)}%</span> : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Arrow() {
  return (
    <span style={{ fontSize: 16, color: 'var(--text-secondary)', flexShrink: 0 }}>›</span>
  )
}

function PlaceholderIcon({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, flexShrink: 0, borderRadius: 4, background: 'var(--bg-primary)', border: '1px dashed var(--border)' }} />
  )
}

function ItemIcon({ iconPath, name, size, accentBorder }: { iconPath: string; name: string; size: number; accentBorder?: boolean }) {
  return (
    <div title={name} style={{ width: size, height: size, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-secondary)', boxSizing: 'border-box', border: accentBorder ? '2px solid var(--accent)' : 'none' }}>
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

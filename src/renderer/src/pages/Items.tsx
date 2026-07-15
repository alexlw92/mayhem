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
  boots: { item: ItemMeta; picks: number; pickRate: number; wins: number }[]
  flexPairs: { items: [ItemMeta, ItemMeta]; picks: number; pickRate: number; wins: number }[]
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
        const orderedArch = (() => {
          if ((arch.starterId ?? null) == null) return archetypeItems
          const idx = archetypeItems.findIndex(i => i.id === arch.starterId)
          if (idx > 0) return [archetypeItems[idx], ...archetypeItems.filter((_, i) => i !== idx)]
          if (idx === -1) {
            // Starter detected in variants but not in the core 3 — find and prepend it
            const starterMeta = arch.variants.flatMap(v => v.items).find(i => i.id === arch.starterId)
            if (starterMeta) return [starterMeta, ...archetypeItems.slice(0, 3)]
          }
          return archetypeItems
        })()

        const boots = arch.boots ?? []
        const flexPairs = arch.flexPairs ?? []
        const topBoot = boots[0]?.item ?? null

        // 4-slot sequence: [starter/core1] → [boots] → [core2] → [core3]
        const displayItems = [orderedArch[0], topBoot, orderedArch[1], orderedArch[2]]
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

            {isOpen && (boots.length > 0 || flexPairs.length > 0) && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {boots.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      {boots.slice(0, 3).map(({ item, picks, pickRate, wins }) => (
                        <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <ItemIcon iconPath={item.iconPath} name={item.name} size={26} />
                              <span style={{ fontSize: 12 }}>{item.name}</span>
                            </div>
                          </td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{picks} picks</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{(pickRate * 100).toFixed(0)}%</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: picks > 0 ? wrColor(wins / picks) : 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                            {picks > 0 ? `${((wins / picks) * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {flexPairs.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      {flexPairs.map(({ items, picks, pickRate, wins }, fi) => (
                        <tr key={fi} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <ItemIcon iconPath={items[0].iconPath} name={items[0].name} size={26} />
                              <ItemIcon iconPath={items[1].iconPath} name={items[1].name} size={26} />
                            </div>
                          </td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{picks} picks</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{(pickRate * 100).toFixed(0)}%</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', color: picks > 0 ? wrColor(wins / picks) : 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                            {picks > 0 ? `${((wins / picks) * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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

import { useState, useEffect, useRef, Fragment } from 'react'
import './Dashboard.css'

const api = (window as any).api

interface GameParticipant {
  puuid: string
  championId: number
  summonerName?: string
}

interface AugmentInfo {
  name: string
  iconPath: string
  rarity: number
}

interface AugmentStat {
  augmentId: number
  name: string
  rarity: number
  iconPath: string
  pickCount: number
  wins: number
  avgDpm: number
}

interface GameState {
  phase: string
  myTeam?: GameParticipant[]
  theirTeam?: GameParticipant[]
}

interface PlayerStats {
  games: number
  wins: number
  avgDpm: number
  summonerName?: string
}

interface ChampionStat {
  championId: number
  games: number
  wins: number
}

interface GlobalChampStat {
  games: number
  wins: number
}

interface Props {
  selectedPatches: string[] | null
}

type AugmentCache = Record<number, AugmentInfo>
type SortKey = 'pickCount' | 'winRate' | 'avgDpm'

const RARITY_LABEL = ['Silver', 'Gold', 'Prismatic']
const RARITY_COLOR = ['#c0c0c0', '#f0b429', '#b44be1']

const POLL_MS = 3000

const SELECT_STYLE = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  padding: '6px 10px',
  fontSize: 12,
  outline: 'none',
}

export default function CurrentGame({ selectedPatches }: Props) {
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerStats | null>>({})
  const [championStats, setChampionStats] = useState<Record<string, ChampionStat[]>>({})
  const [globalChampStats, setGlobalChampStats] = useState<Record<number, GlobalChampStat>>({})
  const [augmentCache, setAugmentCache] = useState<AugmentCache>({})
  const [championCache, setChampionCache] = useState<Record<number, string>>({})
  const [myPuuid, setMyPuuid] = useState<string | null>(null)
  const [champAugStats, setChampAugStats] = useState<{ data: AugmentStat[] | undefined; championId: number } | null>(null)
  const [rarityFilter, setRarityFilter] = useState<number | null>(null)
  const [augSort, setAugSort] = useState<SortKey>('pickCount')
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.db.augmentCache().then(setAugmentCache).catch(() => {})
    api.db.championCache().then(setChampionCache).catch(() => {})
    api.lcu.currentSummoner().then((s: any) => { if (s?.puuid) setMyPuuid(s.puuid) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedPatches?.length) return
    api.db.championStats(undefined, selectedPatches)
      .then((rows: { championId: number; games: number; wins: number }[]) => {
        const map: Record<number, GlobalChampStat> = {}
        for (const r of rows) map[r.championId] = { games: r.games, wins: r.wins }
        setGlobalChampStats(map)
      })
      .catch(() => {})
  }, [selectedPatches])

  const prevPhaseRef = useRef<string | null>(null)
  const allPuuidsRef = useRef<string[]>([])
  const nameCacheRef = useRef<Record<string, string>>({})
  const hasSyncedChampSelectRef = useRef(false)
  const hasSyncedGameStartRef = useRef(false)
  const fetchedPuuidsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (cancelled) return
      try {
        const state: GameState | null = await api.lcu.currentGame()
        if (cancelled) return
        setGameState(state)

        const prevPhase = prevPhaseRef.current
        const currentPhase = state?.phase ?? null

        if (prevPhase === 'InProgress' && currentPhase === 'EndOfGame' && allPuuidsRef.current.length > 0) {
          api.lcu.syncCurrentGame(allPuuidsRef.current).catch(() => {})
        }
        prevPhaseRef.current = currentPhase

        const participants = [...(state?.myTeam ?? []), ...(state?.theirTeam ?? [])]
        const puuids = participants.map((p) => p.puuid).filter(Boolean)
        allPuuidsRef.current = puuids

        if (currentPhase === 'ChampSelect' && !hasSyncedChampSelectRef.current && puuids.length > 0) {
          hasSyncedChampSelectRef.current = true
          api.lcu.syncCurrentGame(puuids).catch(() => {})
        }
        if (prevPhase === 'ChampSelect' && currentPhase !== 'ChampSelect') {
          hasSyncedChampSelectRef.current = false
        }

        if (currentPhase === 'InProgress' && !hasSyncedGameStartRef.current && puuids.length > 0) {
          hasSyncedGameStartRef.current = true
          api.lcu.syncCurrentGame(puuids).catch(() => {})
        }
        if (!currentPhase || currentPhase === 'None' || currentPhase === 'Lobby' || currentPhase === 'Matchmaking') {
          hasSyncedGameStartRef.current = false
        }

        for (const p of participants) {
          if (p.puuid && p.summonerName) nameCacheRef.current[p.puuid] = p.summonerName
        }

        const newPuuids = participants
          .map((p) => p.puuid)
          .filter((puuid) => puuid && !fetchedPuuidsRef.current.has(puuid))

        if (newPuuids.length > 0) {
          for (const puuid of newPuuids) fetchedPuuidsRef.current.add(puuid)
          setPlayerStats((prev) => {
            const next = { ...prev }
            for (const puuid of newPuuids) next[puuid] = undefined as any
            return next
          })
          api.db.playerBulkStats(newPuuids, selectedPatches ?? undefined)
            .then((map: Record<string, PlayerStats>) => {
              setPlayerStats((prev) => {
                const next = { ...prev }
                for (const puuid of newPuuids) {
                  const s = map[puuid] ?? null
                  next[puuid] = s
                  if (s?.summonerName && !nameCacheRef.current[puuid]) nameCacheRef.current[puuid] = s.summonerName
                }
                return next
              })
            })
            .catch(() => setPlayerStats((prev) => {
              const next = { ...prev }
              for (const puuid of newPuuids) next[puuid] = null
              return next
            }))
        }

        for (const p of participants) {
          if (!p.puuid) continue
          if (p.championId && p.championId !== 0) {
            setChampionStats((prev) => {
              if (p.puuid in prev) return prev
              api.db.championStats(p.puuid, selectedPatches ?? undefined)
                .then((rows: ChampionStat[]) => setChampionStats((cur) => ({ ...cur, [p.puuid]: rows })))
                .catch(() => setChampionStats((cur) => ({ ...cur, [p.puuid]: [] })))
              return { ...prev, [p.puuid]: undefined as any }
            })
          }
        }
      } catch { /* silent */ }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [selectedPatches])

  useEffect(() => {
    setPlayerStats({})
    setChampionStats({})
    setGlobalChampStats({})
    setChampAugStats(null)
    setSearch('')
    fetchedPuuidsRef.current = new Set()
  }, [selectedPatches])

  useEffect(() => {
    const unsub = api.on('sync-progress', ({ puuid }: { puuid: string }) => {
      if (!puuid || !fetchedPuuidsRef.current.has(puuid)) return

      api.db.playerBulkStats([puuid], selectedPatches ?? undefined)
        .then((map: Record<string, PlayerStats>) => {
          const s = map[puuid] ?? null
          setPlayerStats((prev) => ({ ...prev, [puuid]: s }))
          if (s?.summonerName) nameCacheRef.current[puuid] = s.summonerName
        })
        .catch(() => {})

      api.db.championStats(puuid, selectedPatches ?? undefined)
        .then((rows: ChampionStat[]) => setChampionStats((prev) => ({ ...prev, [puuid]: rows })))
        .catch(() => {})

      setMyPuuid((cur) => {
        if (puuid === cur) setChampAugStats(null)
        return cur
      })
    })
    return unsub
  }, [selectedPatches])

  useEffect(() => {
    if (!myPuuid || !gameState) return
    const allParticipants = [...(gameState.myTeam ?? []), ...(gameState.theirTeam ?? [])]
    const me = allParticipants.find((p) => p.puuid === myPuuid)
    const champId = me?.championId ?? 0
    if (!champId) return
    if (champAugStats?.championId === champId) return
    setChampAugStats({ data: undefined, championId: champId })
    api.db.augmentStats(undefined, champId, selectedPatches ?? undefined)
      .then((rows: AugmentStat[]) => setChampAugStats({ data: rows, championId: champId }))
      .catch(() => setChampAugStats({ data: [], championId: champId }))
  }, [myPuuid, gameState, selectedPatches, champAugStats?.championId])

  const phase = gameState?.phase

  if (!phase || phase === 'None' || phase === 'Lobby' || phase === 'Matchmaking' || phase === 'ReadyCheck') {
    return (
      <div>
        <h2 style={{ marginBottom: 16 }}>Live Game</h2>
        <div className="card">
          <div className="empty-state">
            <div>No active game</div>
            <p>Start a game to see live player stats here</p>
          </div>
        </div>
      </div>
    )
  }

  const myTeam = gameState?.myTeam ?? []
  const theirTeam = gameState?.theirTeam ?? []
  const rowCount = Math.max(myTeam.length, theirTeam.length, 5)

  const myParticipant = myPuuid ? [...myTeam, ...theirTeam].find((p) => p.puuid === myPuuid) : null
  const myChampId = myParticipant?.championId ?? 0
  const champName = myChampId ? (championCache[myChampId] ?? 'Your Champion') : 'Your Champion'

  const filteredAugs = champAugStats?.data
    ? champAugStats.data
        .filter((a) => {
          if (rarityFilter !== null && a.rarity !== rarityFilter) return false
          if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
          return true
        })
        .sort((a, b) => {
          if (augSort === 'pickCount') return b.pickCount - a.pickCount
          if (augSort === 'winRate') return (b.wins / b.pickCount) - (a.wins / a.pickCount)
          if (augSort === 'avgDpm') return b.avgDpm - a.avgDpm
          return 0
        })
    : []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Live Game</h2>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
          {phase === 'InProgress' ? 'In Game' : phase === 'EndOfGame' ? 'Game Over' : phase}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-light)', textTransform: 'uppercase', letterSpacing: 1 }}>Your Team</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: 1 }}>Enemy Team</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        {Array.from({ length: rowCount }, (_, i) => (
          <Fragment key={i}>
            {myTeam[i] ? (
              <ParticipantCard
                participant={myTeam[i]}
                stats={playerStats[myTeam[i].puuid] ?? null}
                champStats={championStats[myTeam[i].puuid]}
                globalChampRow={myTeam[i].championId ? globalChampStats[myTeam[i].championId] : undefined}
                resolvedName={nameCacheRef.current[myTeam[i].puuid] || myTeam[i].summonerName || ''}
              />
            ) : phase === 'InProgress' && i < 5 ? <HiddenPlayerCard /> : <div />}
            {theirTeam[i] ? (
              <ParticipantCard
                participant={theirTeam[i]}
                stats={playerStats[theirTeam[i].puuid] ?? null}
                champStats={championStats[theirTeam[i].puuid]}
                globalChampRow={theirTeam[i].championId ? globalChampStats[theirTeam[i].championId] : undefined}
                resolvedName={nameCacheRef.current[theirTeam[i].puuid] || theirTeam[i].summonerName || ''}
              />
            ) : phase === 'InProgress' && i < 5 ? <HiddenPlayerCard /> : <div />}
          </Fragment>
        ))}
      </div>

      {myChampId !== 0 && (
        <div>
          <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{champName} — Augments</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ ...SELECT_STYLE, width: 180, padding: '6px 12px' }}
                placeholder="Search augment…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 2 }}>Rarity</span>
              <button className={`aug-btn ${rarityFilter === null ? 'active' : ''}`} onClick={() => setRarityFilter(null)}>All</button>
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
                <button key={key} className={`aug-btn ${augSort === key ? 'active' : ''}`} onClick={() => setAugSort(key)}>
                  {key === 'pickCount' ? 'Picks' : key === 'winRate' ? 'Win Rate' : 'DPM'}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            {champAugStats?.data === undefined ? (
              <div className="empty-state">Loading…</div>
            ) : filteredAugs.length === 0 ? (
              <div className="empty-state">
                <div>No augment data</div>
                <p>{champAugStats.data.length > 0 ? 'No augments match the current filters' : 'No data for this champion'}</p>
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
                  {filteredAugs.map((a) => {
                    const wr = a.pickCount > 0 ? a.wins / a.pickCount : 0
                    const rarityColor = RARITY_COLOR[a.rarity] ?? RARITY_COLOR[0]
                    return (
                      <tr key={a.augmentId}>
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
        </div>
      )}

      <style>{`
        .aug-btn { padding: 4px 12px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s; }
        .aug-btn:hover { border-color: var(--blue); color: var(--text-primary); }
        .aug-btn.active { border-color: var(--accent); color: var(--accent); }
      `}</style>
    </div>
  )
}

function HiddenPlayerCard() {
  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)', flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Hidden Player</div>
      </div>
    </div>
  )
}

function ParticipantCard({ participant, stats, champStats, globalChampRow, resolvedName }: {
  participant: GameParticipant
  stats: PlayerStats | null | undefined
  champStats: ChampionStat[] | undefined
  globalChampRow: GlobalChampStat | undefined
  resolvedName: string
}) {
  const { puuid, championId } = participant
  const hasPick = championId && championId !== 0

  const champRow = hasPick && champStats
    ? champStats.find((c) => c.championId === championId)
    : null

  const overallWr = stats && stats.games > 0 ? stats.wins / stats.games : null
  const champWr = champRow && champRow.games > 0 ? champRow.wins / champRow.games : null
  const globalWr = globalChampRow && globalChampRow.games > 0 ? globalChampRow.wins / globalChampRow.games : null

  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
          {hasPick ? (
            <img
              src={`mayhem-asset://champion-icons/${championId}.png`}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'var(--bg-secondary)' }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {resolvedName || (puuid ? puuid.slice(0, 12) + '…' : '—')}
          </div>

          {stats === undefined && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {stats === null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No data</div>
          )}
          {stats && stats.games === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No ARAM data</div>
          )}
          {stats && stats.games > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {stats.games}g · <span className={overallWr! >= 0.5 ? 'win' : 'loss'}>{(overallWr! * 100).toFixed(0)}% WR</span> · {Math.round(stats.avgDpm)}/min
            </div>
          )}

          {hasPick && globalWr !== null && globalChampRow && (
            <div style={{ fontSize: 11, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)' }}>Champ: </span>
              <span style={{ color: 'var(--text-secondary)' }}>{globalChampRow.games}g · </span>
              <span className={globalWr >= 0.5 ? 'win' : 'loss'}>{(globalWr * 100).toFixed(0)}% WR</span>
              <span style={{ color: 'var(--text-muted)' }}> (all)</span>
            </div>
          )}

          {champWr !== null && champRow && (
            <div style={{ fontSize: 11, marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)' }}>You: </span>
              <span style={{ color: 'var(--text-secondary)' }}>{champRow.games}g · </span>
              <span className={champWr >= 0.5 ? 'win' : 'loss'}>{(champWr * 100).toFixed(0)}% WR</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

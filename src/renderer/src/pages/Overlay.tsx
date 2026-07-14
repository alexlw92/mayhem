import { useEffect, useRef, useState } from 'react'
import { matchAugments } from './ocrUtils'

const api = (window as any).api

interface Participant {
  puuid: string
  championId: number
  summonerName?: string
  augments?: number[]
}

interface GameState {
  phase: string
  myTeam?: Participant[]
  theirTeam?: Participant[]
}

interface ChampStat { games: number; wins: number; avgDpm: number }
interface AugStatEntry { wins: number; pickCount: number; iconPath: string; rarity: number }
interface AugInfo { id: number; name: string; desc: string; iconPath: string; rarity: number }

type ChampStatsMap = Record<number, ChampStat>
type AugStatsMap = Record<number, AugStatEntry>
type ChampCacheMap = Record<number, string>
type AugCacheMap = Record<number, AugInfo>

const RARITY_COLOR = ['#7c7c8a', '#c9a71a', '#b44be1']

function pct(n: number) { return `${Math.round(n * 100)}%` }

function AugIcon({
  id, augStats, augCache, highlight,
}: {
  id: number; augStats: AugStatsMap; augCache: AugCacheMap; highlight?: boolean
}) {
  const info = augCache[id]
  const stat = augStats[id]
  const src = info?.iconPath || stat?.iconPath || ''
  const wr = stat && stat.pickCount > 0 ? stat.wins / stat.pickCount : null
  const rarityCol = RARITY_COLOR[info?.rarity ?? 0] ?? RARITY_COLOR[0]

  return (
    <div
      title={`${info?.name ?? `Augment ${id}`}${wr !== null ? ` — ${pct(wr)} WR` : ''}`}
      style={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}
    >
      {src ? (
        <img
          src={src}
          width={24}
          height={24}
          style={{ borderRadius: 3, border: `1px solid ${highlight ? '#4caf50' : rarityCol}`, display: 'block' }}
        />
      ) : (
        <div style={{ width: 24, height: 24, background: '#2a2a3a', borderRadius: 3, border: `1px solid ${rarityCol}` }} />
      )}
      {wr !== null && (
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          background: 'rgba(0,0,0,0.85)', fontSize: 7,
          color: wr >= 0.5 ? '#66bb6a' : '#ef5350',
          padding: '0 1px', lineHeight: '9px', borderRadius: '2px 0 3px 0', pointerEvents: 'none',
        }}>
          {Math.round(wr * 100)}
        </div>
      )}
    </div>
  )
}

function PlayerRow({
  p, champStats, champCache,
}: {
  p: Participant; champStats: ChampStatsMap; champCache: ChampCacheMap
}) {
  const cs = champStats[p.championId]
  const name = champCache[p.championId] ?? `#${p.championId}`
  const hasChamp = p.championId > 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '2px 6px', gap: 5 }}>
      {hasChamp ? (
        <img
          src={`mayhem-asset://champion-icons/${p.championId}.png`}
          width={26}
          height={26}
          style={{ borderRadius: 4, flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 26, height: 26, background: '#2a2a3a', borderRadius: 4, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          fontSize: 11, color: '#ddd',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 88, flexShrink: 1,
        }}>
          {p.summonerName || name}
        </span>
        {cs && cs.games > 0 && (
          <>
            <span style={{ fontSize: 11, flexShrink: 0, color: cs.wins / cs.games >= 0.5 ? '#66bb6a' : '#ef5350' }}>
              {pct(cs.wins / cs.games)}
            </span>
            <span style={{ fontSize: 10, color: '#555', flexShrink: 0 }}>
              {cs.games}g
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function TeamColumn({
  title, players, champStats, champCache,
}: {
  title: string; players: Participant[]; champStats: ChampStatsMap; champCache: ChampCacheMap
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em',
        padding: '3px 6px 4px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {title}
      </div>
      {players.map((p, i) => (
        <PlayerRow key={p.puuid || i} p={p} champStats={champStats} champCache={champCache} />
      ))}
    </div>
  )
}

function OcrPanel({
  augIds, augStats, augCache,
}: {
  augIds: number[]; augStats: AugStatsMap; augCache: AugCacheMap
}) {
  const sorted = [...augIds].sort((a, b) => {
    const wa = augStats[a] ? augStats[a].wins / augStats[a].pickCount : 0
    const wb = augStats[b] ? augStats[b].wins / augStats[b].pickCount : 0
    return wb - wa
  })

  return (
    <div style={{ padding: '6px 10px' }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Augment Picks
        </span>
      </div>
      {sorted.map((id, i) => {
        const info = augCache[id]
        const stat = augStats[id]
        const wr = stat && stat.pickCount > 0 ? stat.wins / stat.pickCount : null
        const best = i === 0
        return (
          <div key={id} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0',
            borderLeft: `3px solid ${best ? '#4caf50' : 'transparent'}`,
            paddingLeft: best ? 5 : 8,
          }}>
            <AugIcon id={id} augStats={augStats} augCache={augCache} highlight={best} />
            <div>
              <div style={{ fontSize: 11, color: best ? '#81c784' : '#ccc' }}>
                {info?.name ?? `Augment ${id}`}
              </div>
              {wr !== null && (
                <div style={{ fontSize: 10, color: '#666' }}>
                  {pct(wr)} WR · {stat!.pickCount}g
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Overlay() {
  const [game, setGame] = useState<GameState | null>(null)
  const [champStats, setChampStats] = useState<ChampStatsMap>({})
  const [champAugStats, setChampAugStats] = useState<AugStatsMap>({})
  const [champCache, setChampCache] = useState<ChampCacheMap>({})
  const [augCache, setAugCache] = useState<AugCacheMap>({})
  const [ocrRecs, setOcrRecs] = useState<number[] | null>(null)

  const tesseractRef = useRef<any>(null)
  const prevAugCountRef = useRef(0)
  const prevPhaseRef = useRef<string | null>(null)
  const ocrDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const augCacheRef = useRef<AugCacheMap>({})

  useEffect(() => { augCacheRef.current = augCache }, [augCache])

  // Load static data on mount
  useEffect(() => {
    Promise.all([
      api.db.championStats(),
      api.db.championCache(),
      api.db.augmentCache(),
    ]).then(([csArr, cc, ac]: any[]) => {
      const csMap: ChampStatsMap = {}
      for (const s of csArr) {
        if (s.games > 0) csMap[Number(s.championId)] = { games: s.games, wins: s.wins, avgDpm: s.avgDpm ?? 0 }
      }
      setChampStats(csMap)
      setChampCache(cc)
      setAugCache(ac)
    }).catch(console.error)
  }, [])

  // Game state polling — runs once on mount
  useEffect(() => {
    let cancelled = false

    async function poll() {
      while (!cancelled) {
        const g: GameState | null = await api.lcu.currentGame().catch(() => null)
        if (cancelled) break
        setGame(g)

        const phase = g?.phase ?? null
        const prevPhase = prevPhaseRef.current

        if (!phase || ['None', 'Lobby', 'Matchmaking', 'WaitingForStats', 'EndOfGame'].includes(phase)) {
          api.lcu.hideOverlay?.()
        } else if (phase === 'ChampSelect' && prevPhase !== 'ChampSelect') {
          api.lcu.showOverlay?.()
          api.lcu.resizeOverlay?.(180, 200)
        } else if (phase === 'InProgress' && prevPhase !== 'InProgress') {
          api.lcu.hideOverlay?.()  // shown only when ocrRecs fires
        }
        prevPhaseRef.current = phase

        // Dismiss OCR recs when a new augment is picked
        const augCount = g?.myTeam?.[0]?.augments?.length ?? 0
        if (augCount > prevAugCountRef.current) {
          setOcrRecs(null)
          if (ocrDismissTimerRef.current) { clearTimeout(ocrDismissTimerRef.current); ocrDismissTimerRef.current = null }
        }
        prevAugCountRef.current = augCount

        await new Promise(r => setTimeout(r, 3000))
      }
    }

    poll()
    return () => { cancelled = true }
  }, [])

  // OCR polling during InProgress when no recommendations are showing
  useEffect(() => {
    if (!game?.myTeam?.length || game.phase !== 'InProgress' || ocrRecs !== null) return

    let cancelled = false

    const runOcr = async () => {
      if (cancelled || !api.lcu.captureScreen) return
      try {
        const dataUrl: string | null = await api.lcu.captureScreen()
        if (!dataUrl || cancelled) return

        if (!tesseractRef.current) {
          const { createWorker } = await import('tesseract.js')
          tesseractRef.current = await createWorker('eng', 1, { logger: () => {} })
        }

        const img = new Image()
        img.src = dataUrl
        await new Promise<void>((res, rej) => {
          img.onload = () => res()
          img.onerror = () => rej(new Error('img load failed'))
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = Math.floor(img.height * 0.75)
        canvas.getContext('2d')!.drawImage(img, 0, 0, img.width, canvas.height, 0, 0, canvas.width, canvas.height)

        const { data: { text } } = await tesseractRef.current.recognize(canvas.toDataURL())
        if (cancelled) return

        const matched = matchAugments(text, augCacheRef.current)

        if (matched.length === 3) {
          setOcrRecs(matched)
          ocrDismissTimerRef.current = setTimeout(() => setOcrRecs(null), 35_000)
        }
      } catch { /* OCR errors are non-critical */ }
    }

    const id = setInterval(runOcr, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [game?.phase, ocrRecs])

  // Show/hide overlay during InProgress based on whether OCR recs are active
  useEffect(() => {
    if (game?.phase !== 'InProgress') return
    if (ocrRecs) {
      api.lcu.showOverlay?.()
      api.lcu.resizeOverlay?.(220, 130)
    } else {
      api.lcu.hideOverlay?.()
    }
  }, [ocrRecs, game?.phase])

  // Load champion-specific augment stats when the player's champion is known
  useEffect(() => {
    const championId = game?.myTeam?.[0]?.championId
    if (!championId || game?.phase !== 'InProgress') return
    api.db.augmentStats(undefined, championId).then((asArr: any[]) => {
      const asMap: AugStatsMap = {}
      for (const s of asArr) {
        if (s.pickCount > 0) asMap[Number(s.augmentId)] = {
          wins: s.wins, pickCount: s.pickCount, iconPath: s.iconPath ?? '', rarity: s.rarity ?? 0,
        }
      }
      setChampAugStats(asMap)
    }).catch(console.error)
  }, [game?.myTeam?.[0]?.championId, game?.phase])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      tesseractRef.current?.terminate()
      if (ocrDismissTimerRef.current) clearTimeout(ocrDismissTimerRef.current)
    }
  }, [])

  const phase = game?.phase
  const myTeam = game?.myTeam ?? []

  const shell = {
    background: 'rgba(0,0,0,0.82)',
    borderRadius: 8,
    fontFamily: 'system-ui, sans-serif',
    userSelect: 'none' as const,
    overflow: 'hidden',
  }

  // InProgress: window is hidden except when ocrRecs is active
  if (phase === 'InProgress') {
    if (!ocrRecs) return <div />
    return (
      <div style={shell}>
        <OcrPanel augIds={ocrRecs} augStats={champAugStats} augCache={augCache} />
      </div>
    )
  }

  // ChampSelect: own team only
  if (phase === 'ChampSelect') {
    return (
      <div style={shell}>
        <TeamColumn title="My Team" players={myTeam} champStats={champStats} champCache={champCache} />
      </div>
    )
  }

  // All other phases — window is hidden
  return <div />
}

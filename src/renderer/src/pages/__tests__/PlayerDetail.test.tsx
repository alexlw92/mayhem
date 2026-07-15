// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ChampionTable, AugmentTable, CoplayerTable, MatchCard, ChampionStat, AugmentStat, AugmentInfo, CoplayerStat, MatchView } from '../Players'

afterEach(() => cleanup())

const champions: ChampionStat[] = [
  { championId: 1, championName: 'Annie',    games: 10, wins: 7, kills: 50, deaths: 20, assists: 40, avgDpm: 800 },
  { championId: 2, championName: 'Teemo',    games: 5,  wins: 2, kills: 20, deaths: 25, assists: 10, avgDpm: 600 },
  { championId: 3, championName: 'Lux',      games: 8,  wins: 5, kills: 30, deaths: 15, assists: 60, avgDpm: 950 },
]

const augments: AugmentStat[] = [
  { augmentId: 1, name: 'Iron Will',     rarity: 0, pickCount: 12, wins: 8,  avgDpm: 700 },
  { augmentId: 2, name: 'Gold Rush',     rarity: 1, pickCount: 6,  wins: 2,  avgDpm: 900 },
  { augmentId: 3, name: 'Prismatic Eye', rarity: 2, pickCount: 9,  wins: 6,  avgDpm: 500 },
]

const augmentCache: Record<number, AugmentInfo> = {
  1: { name: 'Iron Will',     iconPath: 'mayhem-asset://augment-icons/1.png', rarity: 0 },
  2: { name: 'Gold Rush',     iconPath: 'mayhem-asset://augment-icons/2.png', rarity: 1 },
  3: { name: 'Prismatic Eye', iconPath: 'mayhem-asset://augment-icons/3.png', rarity: 2 },
}

// ─── ChampionTable ────────────────────────────────────────────────────────────

describe('ChampionTable', () => {
  it('default render — sorted by games descending', () => {
    const { container } = render(<ChampionTable data={champions} />)
    expect(container).toMatchSnapshot()
  })

  it('click Win Rate — reorders rows and shows ▼ on header', () => {
    const { container, getByText } = render(<ChampionTable data={champions} />)
    fireEvent.click(getByText(/Win Rate/))
    expect(container).toMatchSnapshot()
  })

  it('click Win Rate twice — shows ▲ (ascending)', () => {
    const { container, getByText } = render(<ChampionTable data={champions} />)
    const header = getByText(/Win Rate/)
    fireEvent.click(header)
    fireEvent.click(header)
    expect(container).toMatchSnapshot()
  })

  it('click Avg DPM — reorders rows by DPM descending', () => {
    const { container, getByText } = render(<ChampionTable data={champions} />)
    fireEvent.click(getByText(/Avg DPM/))
    expect(container).toMatchSnapshot()
  })
})

// ─── AugmentTable ─────────────────────────────────────────────────────────────

describe('AugmentTable', () => {
  it('default render — sorted by picks descending, All rarity active', () => {
    const { container } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    expect(container).toMatchSnapshot()
  })

  it('click Win Rate — reorders by win rate descending', () => {
    const { container, getByText } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    fireEvent.click(getByText(/Win Rate/))
    expect(container).toMatchSnapshot()
  })

  it('click Avg DPM — reorders by DPM descending', () => {
    const { container, getByText } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    fireEvent.click(getByText(/Avg DPM/))
    expect(container).toMatchSnapshot()
  })

  it('click Silver — shows only Silver augments', () => {
    const { container, getByRole } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    fireEvent.click(getByRole('button', { name: 'Silver' }))
    expect(container).toMatchSnapshot()
  })

  it('click Gold — shows only Gold augments', () => {
    const { container, getByRole } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    fireEvent.click(getByRole('button', { name: 'Gold' }))
    expect(container).toMatchSnapshot()
  })

  it('click Prismatic — shows only Prismatic augments', () => {
    const { container, getByRole } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    fireEvent.click(getByRole('button', { name: 'Prismatic' }))
    expect(container).toMatchSnapshot()
  })

  it('click Silver twice — returns to All (all rows visible)', () => {
    const { container, getByRole } = render(<AugmentTable data={augments} augmentCache={augmentCache} />)
    const btn = getByRole('button', { name: 'Silver' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(container).toMatchSnapshot()
  })
})

// ─── CoplayerTable ────────────────────────────────────────────────────────────

const coplayers: CoplayerStat[] = [
  { puuid: 'p1', summonerName: 'Alice#NA1', games: 12, wins: 8 },
  { puuid: 'p2', summonerName: 'Bob#NA1',   games: 5,  wins: 4 },
  { puuid: 'p3', summonerName: 'Carol#NA1', games: 9,  wins: 3 },
]

describe('CoplayerTable', () => {
  it('default render — sorted by games descending', () => {
    const { container } = render(<CoplayerTable data={coplayers} />)
    expect(container).toMatchSnapshot()
  })

  it('click Win Rate — reorders by win rate descending', () => {
    const { container, getByText } = render(<CoplayerTable data={coplayers} />)
    fireEvent.click(getByText(/Win Rate/))
    expect(container).toMatchSnapshot()
  })

  it('click Games twice — shows ▲ (ascending)', () => {
    const { container, getByText } = render(<CoplayerTable data={coplayers} />)
    const header = getByText(/Games/)
    fireEvent.click(header)
    fireEvent.click(header)
    expect(container).toMatchSnapshot()
  })

  it('renders names as clickable spans when onPlayerClick is provided', () => {
    const { container } = render(<CoplayerTable data={coplayers} onPlayerClick={vi.fn()} />)
    expect(container).toMatchSnapshot()
  })

  it('fires onPlayerClick with puuid and name when a coplayer name is clicked', () => {
    const handler = vi.fn()
    const { getByText } = render(<CoplayerTable data={coplayers} onPlayerClick={handler} />)
    fireEvent.click(getByText('Alice#NA1'))
    expect(handler).toHaveBeenCalledWith('p1', 'Alice#NA1')
  })
})

// ─── MatchCard ────────────────────────────────────────────────────────────────

const matchFixture: MatchView = {
  gameId: 1001,
  gameCreation: Date.now() - 3600_000,
  gameDuration: 1200,
  participants: [
    { puuid: 'me', summonerName: 'Me#NA1', championId: 1, championName: 'Annie', teamId: 100, win: true, kills: 5, deaths: 1, assists: 3, damageDealt: 30000, augments: [] },
    { puuid: 'ally', summonerName: 'Ally#NA1', championId: 2, championName: 'Teemo', teamId: 100, win: true, kills: 3, deaths: 2, assists: 6, damageDealt: 20000, augments: [] },
    { puuid: 'foe', summonerName: 'Foe#NA1', championId: 3, championName: 'Lux', teamId: 200, win: false, kills: 1, deaths: 4, assists: 0, damageDealt: 15000, augments: [] },
  ],
}

describe('MatchCard', () => {
  it('renders without onPlayerClick — names are plain text', () => {
    const { container } = render(<MatchCard match={matchFixture} selectedPuuid="me" augments={{}} />)
    expect(container).toMatchSnapshot()
  })

  it('renders with onPlayerClick — other players have clickable spans', () => {
    const { container } = render(<MatchCard match={matchFixture} selectedPuuid="me" augments={{}} onPlayerClick={vi.fn()} />)
    expect(container).toMatchSnapshot()
  })

  it('fires onPlayerClick when an ally name is clicked', () => {
    const handler = vi.fn()
    const { getByText } = render(<MatchCard match={matchFixture} selectedPuuid="me" augments={{}} onPlayerClick={handler} />)
    fireEvent.click(getByText('Ally#NA1'))
    expect(handler).toHaveBeenCalledWith('ally', 'Ally#NA1')
  })

  it('fires onPlayerClick when an enemy name is clicked', () => {
    const handler = vi.fn()
    const { getByText } = render(<MatchCard match={matchFixture} selectedPuuid="me" augments={{}} onPlayerClick={handler} />)
    fireEvent.click(getByText('Foe#NA1'))
    expect(handler).toHaveBeenCalledWith('foe', 'Foe#NA1')
  })

  it('does not make the selected player name clickable', () => {
    const handler = vi.fn()
    const { getByText } = render(<MatchCard match={matchFixture} selectedPuuid="me" augments={{}} onPlayerClick={handler} />)
    fireEvent.click(getByText('Me#NA1'))
    expect(handler).not.toHaveBeenCalled()
  })
})

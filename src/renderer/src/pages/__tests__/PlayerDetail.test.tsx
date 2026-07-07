// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ChampionTable, AugmentTable, CoplayerTable, ChampionStat, AugmentStat, AugmentInfo, CoplayerStat } from '../Players'

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
})

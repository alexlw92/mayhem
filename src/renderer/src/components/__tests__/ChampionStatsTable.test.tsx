// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, getByRole } from '@testing-library/react'
import ChampionStatsTable from '../ChampionStatsTable'

afterEach(() => cleanup())

const champions = [
  { championId: 10, championName: 'Kayle',  games: 50, wins: 30, kills: 200, deaths: 100, assists: 150, avgDpm: 900 },
  { championId: 20, championName: 'Teemo',  games: 30, wins: 12, kills: 90,  deaths: 90,  assists: 60,  avgDpm: 750 },
  { championId: 30, championName: 'Annie',  games: 80, wins: 48, kills: 320, deaths: 160, assists: 240, avgDpm: 1050 },
]

describe('ChampionStatsTable', () => {
  it('renders empty state when data is empty', () => {
    const { container } = render(<ChampionStatsTable data={[]} />)
    expect(container).toMatchSnapshot()
  })

  it('renders full table with KDA columns by default', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    expect(container).toMatchSnapshot()
    expect(getByRole(container, 'columnheader', { name: /KDA/ })).toBeTruthy()
    expect(getByRole(container, 'columnheader', { name: /K \/ D \/ A/ })).toBeTruthy()
  })

  it('omits KDA and K/D/A columns when showKda is false', () => {
    const { container, queryByRole } = render(<ChampionStatsTable data={champions} showKda={false} />)
    expect(container).toMatchSnapshot()
    expect(queryByRole('columnheader', { name: /KDA/ })).toBeNull()
    expect(queryByRole('columnheader', { name: /K \/ D \/ A/ })).toBeNull()
  })

  it('default sort is games descending — Annie (80) first', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('Annie')
  })

  it('click Games header toggles to ascending', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /Games/ }))
    expect(container).toMatchSnapshot()
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('Teemo') // 30 games is lowest
  })

  it('click Win Rate header sorts by win rate desc', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /Win Rate/ }))
    expect(container).toMatchSnapshot()
  })

  it('click KDA header sorts by kda desc', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /KDA/ }))
    expect(container).toMatchSnapshot()
  })

  it('click Champion header sorts alphabetically ascending', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /Champion/ }))
    expect(container).toMatchSnapshot()
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('Annie')
  })

  it('calls onChampionClick with correct args on row click', () => {
    const onClick = vi.fn()
    const { container } = render(<ChampionStatsTable data={champions} onChampionClick={onClick} />)
    const rows = container.querySelectorAll('tbody tr')
    fireEvent.click(rows[0]) // Annie is first (80 games desc)
    expect(onClick).toHaveBeenCalledWith(30, 'Annie')
  })

  it('applies win class when wr >= 50%', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    const wrCells = container.querySelectorAll('tbody .win')
    expect(wrCells.length).toBeGreaterThan(0)
  })

  it('applies loss class when wr < 50%', () => {
    const { container } = render(<ChampionStatsTable data={champions} />)
    const lossCells = container.querySelectorAll('tbody .loss')
    expect(lossCells.length).toBeGreaterThan(0) // Teemo: 12/30 = 40%
  })
})

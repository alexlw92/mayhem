// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, getByRole } from '@testing-library/react'
import AugmentStatsTable from '../AugmentStatsTable'

afterEach(() => cleanup())

const augments = [
  { augmentId: 1, name: 'Iron Will',     rarity: 0, iconPath: 'mayhem-asset://augment-icons/1.png', pickCount: 100, wins: 45, avgDpm: 800 },
  { augmentId: 2, name: 'Gold Rush',     rarity: 1, iconPath: 'mayhem-asset://augment-icons/2.png', pickCount: 60,  wins: 36, avgDpm: 950 },
  { augmentId: 3, name: 'Prismatic Eye', rarity: 2, iconPath: 'mayhem-asset://augment-icons/3.png', pickCount: 20,  wins: 12, avgDpm: 1100 },
]

const cache = {
  1: { name: 'Iron Will',     iconPath: 'mayhem-asset://augment-icons/1.png', rarity: 0 },
  2: { name: 'Gold Rush',     iconPath: 'mayhem-asset://augment-icons/2.png', rarity: 1 },
  3: { name: 'Prismatic Eye', iconPath: 'mayhem-asset://augment-icons/3.png', rarity: 2 },
}

describe('AugmentStatsTable', () => {
  it('renders empty state when data is empty', () => {
    const { container } = render(<AugmentStatsTable data={[]} />)
    expect(container).toMatchSnapshot()
  })

  it('renders table with default sort (picks desc)', () => {
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} />)
    expect(container).toMatchSnapshot()
  })

  it('hides rarity filter by default', () => {
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} />)
    expect(container.querySelector('.aug-btn')).toBeNull()
  })

  it('shows rarity filter when showRarityFilter is true', () => {
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} showRarityFilter />)
    expect(container).toMatchSnapshot()
    expect(container.querySelectorAll('.aug-btn').length).toBeGreaterThan(0)
  })

  it('click Picks header toggles to ascending', () => {
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /Picks/ }))
    expect(container).toMatchSnapshot()
  })

  it('click Win Rate header sorts by win rate desc', () => {
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /Win Rate/ }))
    expect(container).toMatchSnapshot()
  })

  it('click Avg DPM header sorts by dpm desc', () => {
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} />)
    fireEvent.click(getByRole(container, 'columnheader', { name: /Avg DPM/ }))
    expect(container).toMatchSnapshot()
  })

  it('calls onAugmentClick with correct id on row click', () => {
    const onClick = vi.fn()
    const { container } = render(<AugmentStatsTable data={augments} augmentCache={cache} onAugmentClick={onClick} />)
    const rows = container.querySelectorAll('tbody tr')
    fireEvent.click(rows[0])
    expect(onClick).toHaveBeenCalledWith(1) // Iron Will is first (100 picks desc)
  })

  it('rarity filter narrows rows to gold only', () => {
    const { container, getByText } = render(
      <AugmentStatsTable data={augments} augmentCache={cache} showRarityFilter />
    )
    fireEvent.click(getByRole(container, 'button', { name: 'Gold' }))
    expect(container).toMatchSnapshot()
    expect(container.querySelectorAll('tbody tr').length).toBe(1)
  })

  it('derives icon cache from iconPath when augmentCache is not provided', () => {
    const { container } = render(<AugmentStatsTable data={augments} />)
    expect(container).toMatchSnapshot()
  })
})

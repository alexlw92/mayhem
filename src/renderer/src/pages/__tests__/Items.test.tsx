// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

afterEach(() => cleanup())

const mockArchetype = {
  openingId: 3001,
  openingItem: { id: 3001, name: 'Evenshroud', iconPath: 'mayhem-asset://items/3001.png', category: 'Armor' },
  archetypeLabel: 'Tank',
  starterId: null,
  coreIds: [3003, 3089, 3135],
  coreItems: [
    { id: 3003, name: 'Archangel\'s Staff', iconPath: 'mayhem-asset://items/3003.png', category: 'AP' },
    { id: 3089, name: 'Rabadon\'s Deathcap', iconPath: 'mayhem-asset://items/3089.png', category: 'AP' },
    { id: 3135, name: 'Void Staff', iconPath: 'mayhem-asset://items/3135.png', category: 'AP' },
  ],
  variants: [
    {
      build: [3001, 3003, 3089, 3135, 3157],
      games: 18,
      wins: 11,
      items: [
        { id: 3001, name: 'Evenshroud', iconPath: 'mayhem-asset://items/3001.png', category: 'Armor' },
        { id: 3003, name: 'Archangel\'s Staff', iconPath: 'mayhem-asset://items/3003.png', category: 'AP' },
        { id: 3089, name: 'Rabadon\'s Deathcap', iconPath: 'mayhem-asset://items/3089.png', category: 'AP' },
        { id: 3135, name: 'Void Staff', iconPath: 'mayhem-asset://items/3135.png', category: 'AP' },
        { id: 3157, name: 'Zhonya\'s Hourglass', iconPath: 'mayhem-asset://items/3157.png', category: 'AP' },
      ],
    },
  ],
  games: 18,
  wins: 11,
  orGroups: [],
}

const mockArchetype2 = {
  openingId: 3165,
  openingItem: { id: 3165, name: 'Morellonomicon', iconPath: 'mayhem-asset://items/3165.png', category: 'AP' },
  archetypeLabel: null,
  starterId: null,
  coreIds: [3089, 3135, 3157],
  coreItems: [
    { id: 3089, name: 'Rabadon\'s Deathcap', iconPath: 'mayhem-asset://items/3089.png', category: 'AP' },
    { id: 3135, name: 'Void Staff', iconPath: 'mayhem-asset://items/3135.png', category: 'AP' },
    { id: 3157, name: 'Zhonya\'s Hourglass', iconPath: 'mayhem-asset://items/3157.png', category: 'AP' },
  ],
  variants: [],
  games: 7,
  wins: 4,
  orGroups: [],
}

const mockPickRows = [
  { itemId: 3006, picks: 45, wins: 26, name: 'Berserker\'s Greaves', iconPath: 'mayhem-asset://items/3006.png', category: 'Boots' },
  { itemId: 3036, picks: 40, wins: 22, name: 'Lord Dominik\'s Regards', iconPath: 'mayhem-asset://items/3036.png', category: 'Damage' },
  { itemId: 3031, picks: 38, wins: 19, name: 'Infinity Edge', iconPath: 'mayhem-asset://items/3031.png', category: 'Damage' },
]

const mockPickRatesResult = { totalGames: 45, items: mockPickRows }

const mockApi = {
  db: {
    itemArchetypes: vi.fn().mockResolvedValue([mockArchetype, mockArchetype2]),
    itemPickRates: vi.fn().mockResolvedValue(mockPickRatesResult),
  },
}

;(window as any).api = mockApi

let Items: typeof import('../Items').default
beforeAll(async () => {
  Items = (await import('../Items')).default
})

describe('Items', () => {
  it('shows loading state initially', () => {
    // Don't await — capture mid-flight state
    mockApi.db.itemArchetypes.mockReturnValue(new Promise(() => {}))
    mockApi.db.itemPickRates.mockReturnValue(new Promise(() => {}))
    const { container } = render(<Items championId={22} selectedPatches={['15.12']} />)
    expect(container).toMatchSnapshot()
  })

  it('shows "no item data" when both APIs return empty', async () => {
    mockApi.db.itemArchetypes.mockResolvedValue([])
    mockApi.db.itemPickRates.mockResolvedValue({ totalGames: 0, items: [] })
    let container!: HTMLElement
    await act(async () => {
      const r = render(<Items championId={22} selectedPatches={['15.12']} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })

  it('renders boots and most-built sections when picks exist but no archetypes', async () => {
    mockApi.db.itemArchetypes.mockResolvedValue([])
    mockApi.db.itemPickRates.mockResolvedValue(mockPickRatesResult)
    let container!: HTMLElement
    await act(async () => {
      const r = render(<Items championId={22} selectedPatches={['15.12']} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })

  it('renders all three sections with full data (archetypes default collapsed)', async () => {
    mockApi.db.itemArchetypes.mockResolvedValue([mockArchetype, mockArchetype2])
    mockApi.db.itemPickRates.mockResolvedValue(mockPickRatesResult)
    let container!: HTMLElement
    await act(async () => {
      const r = render(<Items championId={22} selectedPatches={['15.12']} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })

  it('does not fetch when selectedPatches is null', () => {
    mockApi.db.itemArchetypes.mockClear()
    mockApi.db.itemPickRates.mockClear()
    render(<Items championId={22} selectedPatches={null} />)
    expect(mockApi.db.itemArchetypes).not.toHaveBeenCalled()
    expect(mockApi.db.itemPickRates).not.toHaveBeenCalled()
  })

  it('re-fetches when metaKey changes', async () => {
    mockApi.db.itemArchetypes.mockResolvedValue([mockArchetype])
    mockApi.db.itemPickRates.mockResolvedValue(mockPickRatesResult)
    mockApi.db.itemArchetypes.mockClear()
    let rerender!: (ui: React.ReactElement) => void
    await act(async () => {
      const r = render(<Items championId={22} selectedPatches={['15.12']} metaKey={0} />)
      rerender = r.rerender
    })
    const callsBefore = mockApi.db.itemArchetypes.mock.calls.length
    await act(async () => {
      rerender(<Items championId={22} selectedPatches={['15.12']} metaKey={1} />)
    })
    expect(mockApi.db.itemArchetypes.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

afterEach(() => cleanup())

const mockChampionStats = [
  { championId: 10, championName: 'Kayle', games: 8, wins: 5, avgDpm: 820 },
  { championId: 20, championName: 'Teemo', games: 3, wins: 1, avgDpm: 510 },
]
const mockAugmentCache = {
  200: { name: 'Iron Will', iconPath: 'mayhem-asset://augment-icons/200.png', rarity: 0 },
}

const mockApi = {
  db: {
    augmentChampionStats: vi.fn().mockResolvedValue(mockChampionStats),
    augmentCache: vi.fn().mockResolvedValue(mockAugmentCache),
  },
}

;(window as any).api = mockApi

// Import after mock is installed
let AugmentDetail: typeof import('../AugmentDetail').default
beforeAll(async () => {
  AugmentDetail = (await import('../AugmentDetail')).default
})

describe('AugmentDetail', () => {
  it('shows loading state initially', () => {
    const { container } = render(
      <AugmentDetail augmentId={200} selectedPatches={['15.12']} onBack={() => {}} />
    )
    expect(container).toMatchSnapshot()
  })

  it('renders champion table after data loads', async () => {
    mockApi.db.augmentChampionStats.mockResolvedValue(mockChampionStats)
    mockApi.db.augmentCache.mockResolvedValue(mockAugmentCache)
    let container!: HTMLElement
    await act(async () => {
      const r = render(<AugmentDetail augmentId={200} selectedPatches={['15.12']} onBack={() => {}} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })

  it('shows empty state when no champion data', async () => {
    mockApi.db.augmentChampionStats.mockResolvedValue([])
    let container!: HTMLElement
    await act(async () => {
      const r = render(<AugmentDetail augmentId={200} selectedPatches={['15.12']} onBack={() => {}} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

afterEach(() => cleanup())

const mockApi = {
  lcu: {
    currentGame: vi.fn().mockResolvedValue(null),
    syncCurrentGame: vi.fn().mockResolvedValue({ ok: true }),
    currentSummoner: vi.fn().mockResolvedValue({ puuid: 'p1' }),
  },
  db: {
    playerOneStats: vi.fn().mockResolvedValue({ games: 10, wins: 6, avgDpm: 800 }),
    playerBulkStats: vi.fn().mockResolvedValue({
      p1: { games: 10, wins: 6, avgDpm: 800 },
      p2: { games: 10, wins: 6, avgDpm: 800 },
      p3: { games: 10, wins: 6, avgDpm: 800 },
    }),
    championStats: vi.fn().mockResolvedValue([
      { championId: 10, games: 5, wins: 4 }
    ]),
    augmentCache: vi.fn().mockResolvedValue({}),
    championCache: vi.fn().mockResolvedValue({ 10: 'Kayle', 20: 'Ashe' }),
    augmentStats: vi.fn().mockResolvedValue([
      { augmentId: 200, name: 'Iron Will', rarity: 0, iconPath: '', pickCount: 5, wins: 3, avgDpm: 800 },
    ]),
  }
}
;(window as any).api = mockApi

let CurrentGame: typeof import('../CurrentGame').default
beforeAll(async () => {
  CurrentGame = (await import('../CurrentGame')).default
})

describe('CurrentGame', () => {
  it('shows no-game state when currentGame returns null', async () => {
    mockApi.lcu.currentGame.mockResolvedValue(null)
    let container!: HTMLElement
    await act(async () => {
      const r = render(<CurrentGame selectedPatches={['15.12']} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })

  it('renders champ select state with team data', async () => {
    mockApi.lcu.currentGame.mockResolvedValue({
      phase: 'ChampSelect',
      myTeam: [{ puuid: 'p1', championId: 10 }, { puuid: 'p2', championId: 0 }],
      theirTeam: [{ puuid: 'p3', championId: 20 }],
    })
    let container!: HTMLElement
    await act(async () => {
      const r = render(<CurrentGame selectedPatches={['15.12']} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })

  it('shows in-progress state', async () => {
    mockApi.lcu.currentGame.mockResolvedValue({
      phase: 'InProgress',
      myTeam: [{ puuid: 'p1', championId: 10, summonerName: 'Foo#NA1' }],
      theirTeam: [{ puuid: 'p3', championId: 20, summonerName: 'Bar#EUW' }],
    })
    let container!: HTMLElement
    await act(async () => {
      const r = render(<CurrentGame selectedPatches={['15.12']} />)
      container = r.container
    })
    expect(container).toMatchSnapshot()
  })
})

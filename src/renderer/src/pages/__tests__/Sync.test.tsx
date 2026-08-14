// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'

afterEach(() => cleanup())

const mockApi = {
  sync: {
    queueStatus: vi.fn().mockResolvedValue({ total: 0, claimed: 0 }),
    nextPlayers: vi.fn().mockResolvedValue([]),
    log: vi.fn().mockResolvedValue([]),
    clearQueue: vi.fn().mockResolvedValue({}),
    forceRefresh: vi.fn().mockResolvedValue({}),
  },
  metrics: {
    get: vi.fn().mockResolvedValue({
      matviewLastRefreshMs: 1000,
      matviewRefreshInProgress: false,
      pendingMatchCount: 0,
    }),
  },
  lcu: {
    sync: vi.fn().mockResolvedValue({}),
    stopSync: vi.fn().mockResolvedValue({}),
    fullSync: vi.fn().mockResolvedValue({}),
  },
}
;(window as any).api = mockApi

let Sync: typeof import('../Sync').default
beforeAll(async () => {
  Sync = (await import('../Sync')).default
})

describe('Sync page — client status indicator', () => {
  it('shows Client Online when clientRunning is true', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={true} />)
    })
    expect(screen.getByText('Client Online')).toBeTruthy()
  })

  it('shows Client Offline when clientRunning is false', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={false} />)
    })
    expect(screen.getByText('Client Offline')).toBeTruthy()
  })
})

describe('Sync page — Force Re-sync button', () => {
  it('renders Force Re-sync button in the action bar', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={true} />)
    })
    expect(screen.getByRole('button', { name: /Force Re-sync/ })).toBeTruthy()
  })

  it('is disabled when client is offline', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={false} />)
    })
    const btn = screen.getByRole('button', { name: /Force Re-sync/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('is enabled when client is online', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={true} />)
    })
    const btn = screen.getByRole('button', { name: /Force Re-sync/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })
})

describe('Sync page — sync control buttons', () => {
  it('disables Start Sync when a sync is already active', async () => {
    await act(async () => {
      render(<Sync syncing={true} stopping={false} clientRunning={true} />)
    })
    const btn = screen.getByRole('button', { name: /Start Sync/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('enables Start Sync when no sync is running', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={true} />)
    })
    const btn = screen.getByRole('button', { name: /Start Sync/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('disables Pause Sync when no sync is running', async () => {
    await act(async () => {
      render(<Sync syncing={false} stopping={false} clientRunning={true} />)
    })
    const btn = screen.getByRole('button', { name: /Pause Sync/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('enables Pause Sync when sync is active', async () => {
    await act(async () => {
      render(<Sync syncing={true} stopping={false} clientRunning={true} />)
    })
    const btn = screen.getByRole('button', { name: /Pause Sync/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })
})

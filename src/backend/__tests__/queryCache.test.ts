import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOrFetch, invalidate, invalidatePrefix, clearAll } from '../queryCache'

beforeEach(() => clearAll())

describe('getOrFetch', () => {
  it('calls fetchFn on first access', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    const result = await getOrFetch('key1', fetch)
    expect(result).toBe('data')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on second call without re-fetching', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    await getOrFetch('key1', fetch)
    const result = await getOrFetch('key1', fetch)
    expect(result).toBe('data')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches independently for different keys', async () => {
    const fetchA = vi.fn().mockResolvedValue('a')
    const fetchB = vi.fn().mockResolvedValue('b')
    expect(await getOrFetch('keyA', fetchA)).toBe('a')
    expect(await getOrFetch('keyB', fetchB)).toBe('b')
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).toHaveBeenCalledTimes(1)
  })

  it('does not cache null — fetchFn is called again on second invocation', async () => {
    const fetch = vi.fn().mockResolvedValue(null)
    await getOrFetch('key1', fetch)
    await getOrFetch('key1', fetch)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('invalidate', () => {
  it('forces re-fetch after invalidation', async () => {
    const fetch = vi.fn().mockResolvedValue('v1')
    await getOrFetch('key1', fetch)
    invalidate('key1')
    fetch.mockResolvedValue('v2')
    const result = await getOrFetch('key1', fetch)
    expect(result).toBe('v2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('invalidatePrefix', () => {
  it('removes all keys matching prefix and leaves others intact', async () => {
    const fetch = vi.fn().mockResolvedValue('data')
    await getOrFetch('champions:15.12:2400', fetch)
    await getOrFetch('champions:15.11:2400', fetch)
    await getOrFetch('players:15.12:2400', fetch)
    expect(fetch).toHaveBeenCalledTimes(3)

    invalidatePrefix('champions:')
    fetch.mockResolvedValue('fresh')
    await getOrFetch('champions:15.12:2400', fetch)  // re-fetched
    await getOrFetch('champions:15.11:2400', fetch)  // re-fetched
    await getOrFetch('players:15.12:2400', fetch)    // still cached
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})

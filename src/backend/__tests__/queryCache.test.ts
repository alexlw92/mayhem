import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getOrFetch, invalidate, invalidatePrefix, clearAll, initLruPersistence } from '../queryCache'

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

describe('initLruPersistence', () => {
  let tmpFile: string

  beforeEach(() => {
    clearAll()
    tmpFile = path.join(os.tmpdir(), `lru-test-${Date.now()}.json`)
  })

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ok */ }
    try { fs.unlinkSync(tmpFile + '.tmp') } catch { /* ok */ }
  })

  it('restores entries from disk on load', async () => {
    // Write a known-good dump manually (simulating what save() does)
    const { LRUCache } = await import('lru-cache')
    const tempCache = new LRUCache<string, unknown>({ max: 200, ttl: 30 * 60 * 1000 })
    tempCache.set('persist-key', 'persisted')
    fs.writeFileSync(tmpFile, JSON.stringify(tempCache.dump()))

    clearAll()
    initLruPersistence(tmpFile)
    const fetch2 = vi.fn().mockResolvedValue('should-not-be-called')
    const result = await getOrFetch('persist-key', fetch2)
    expect(result).toBe('persisted')
    expect(fetch2).not.toHaveBeenCalled()
  })

  it('skips entries older than 2 hours', async () => {
    const staleEntry = { value: 'stale', start: Date.now() - 3 * 60 * 60 * 1000, ttl: 30 * 60 * 1000 }
    fs.writeFileSync(tmpFile, JSON.stringify([['stale-key', staleEntry]]))

    clearAll()
    initLruPersistence(tmpFile)
    const fetch = vi.fn().mockResolvedValue('fresh')
    const result = await getOrFetch('stale-key', fetch)
    expect(result).toBe('fresh')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('starts fresh when file is missing', () => {
    expect(() => initLruPersistence('/nonexistent/path/lru.json')).not.toThrow()
  })
})

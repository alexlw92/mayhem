const FRESH_TTL_MS = 15 * 60 * 1000
const STALE_TTL_MS = 4 * 60 * 60 * 1000

interface CacheEntry { data: unknown; expiresAt: number; staleAt: number }
const cache = new Map<string, CacheEntry>()

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.data as T
}

export function getStale<T>(key: string): { data: T; needsRefresh: boolean } | null {
  const entry = cache.get(key)
  if (!entry) return null
  const now = Date.now()
  if (now > entry.staleAt) { cache.delete(key); return null }
  return { data: entry.data as T, needsRefresh: now > entry.expiresAt }
}

export function setCached(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + FRESH_TTL_MS, staleAt: Date.now() + STALE_TTL_MS })
}

export function clearCache(): void { cache.clear() }

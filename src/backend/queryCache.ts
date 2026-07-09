const cache = new Map<string, { data: unknown; expiresAt: number }>()
const TTL_MS = 5 * 60 * 1000

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null }
  return entry.data as T
}

export function setCached(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS })
}

export function clearCache(): void {
  cache.clear()
}

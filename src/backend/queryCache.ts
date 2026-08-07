import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, unknown>({
  max: 200,
  ttl: 30 * 60 * 1000,
})

export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  const value = await fetchFn()
  cache.set(key, value)
  return value
}

export function invalidate(key: string): void {
  cache.delete(key)
}

export function invalidatePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

export function clearAll(): void {
  cache.clear()
}

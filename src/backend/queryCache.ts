import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, NonNullable<unknown>>({
  max: 200,
  ttl: 30 * 60 * 1000,
})

const inFlight = new Map<string, Promise<unknown>>()

export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  if (inFlight.has(key)) return inFlight.get(key) as Promise<T>
  const promise = Promise.resolve().then(() => fetchFn()).then(value => {
    inFlight.delete(key)
    if (value != null) cache.set(key, value as NonNullable<unknown>)
    return value
  }).catch(err => {
    inFlight.delete(key)
    throw err
  })
  inFlight.set(key, promise)
  return promise as Promise<T>
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

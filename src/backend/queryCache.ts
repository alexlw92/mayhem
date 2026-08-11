import fs from 'node:fs'
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, NonNullable<unknown>>({
  max: 200,
  ttl: 30 * 60 * 1000,
})

const inFlight = new Map<string, Promise<unknown>>()

export async function getOrFetch<T>(key: string, fetchFn: () => Promise<T>, ttl?: number): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T
  if (inFlight.has(key)) return inFlight.get(key) as Promise<T>
  const promise = Promise.resolve().then(() => fetchFn()).then(value => {
    inFlight.delete(key)
    if (value != null) cache.set(key, value as NonNullable<unknown>, ttl !== undefined ? { ttl } : undefined)
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

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

export function initLruPersistence(filePath: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const entries: [string, LRUCache.Entry<NonNullable<unknown>>][] = JSON.parse(raw)
    const now = Date.now()
    const fresh = entries.filter(([, entry]) => !entry.start || now - entry.start <= TWO_HOURS_MS)
    if (fresh.length > 0) cache.load(fresh)
    console.log(`[cache] restored ${cache.size} LRU entries from ${filePath}`)
  } catch { /* no file or corrupt — start fresh */ }

  const save = () => {
    try {
      const tmp = filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(cache.dump()))
      fs.renameSync(tmp, filePath)
    } catch (err) {
      console.warn('[cache] LRU save failed:', (err as Error).message)
    }
  }

  setInterval(save, 60_000)
  process.on('exit', save)
}

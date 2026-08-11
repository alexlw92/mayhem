import fs from 'node:fs'

interface RouteMetrics {
  requests: number
  errors: number
  latencies: number[]  // ring buffer, capacity 1000
  head: number         // next write index (unbounded)
}

export interface RouteSnapshot {
  route: string
  requests: number
  errors: number
  p50: number
  p95: number
  p99: number
}

export interface MetricsSnapshot {
  uptime: number        // ms since start or last reset
  totalRequests: number
  totalErrors: number
  globalP50: number
  globalP95: number
  globalP99: number
  routes: RouteSnapshot[]
}

const store = new Map<string, RouteMetrics>()
// Global ring buffer for true cross-route percentiles
const globalLatencies = new Array(1000).fill(0)
let globalHead = 0
let startTime = Date.now()
let persistPath: string | null = null

function writeSnapshot(): void {
  if (!persistPath) return
  try {
    const routes: Record<string, { requests: number; errors: number; latencies: number[]; head: number }> = {}
    for (const [key, m] of store.entries()) {
      routes[key] = { requests: m.requests, errors: m.errors, latencies: [...m.latencies], head: m.head }
    }
    fs.writeFileSync(persistPath, JSON.stringify({
      startTime,
      globalLatencies: [...globalLatencies],
      globalHead,
      routes,
    }))
  } catch (err) {
    console.warn('[metrics] snapshot write failed:', (err as Error).message)
  }
}

export function initMetricsPersistence(filePath: string): void {
  persistPath = filePath
  try {
    const snap = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (typeof snap.startTime === 'number') startTime = snap.startTime
    if (Array.isArray(snap.globalLatencies)) {
      for (let i = 0; i < Math.min(snap.globalLatencies.length, 1000); i++)
        globalLatencies[i] = snap.globalLatencies[i] ?? 0
    }
    if (typeof snap.globalHead === 'number') globalHead = snap.globalHead
    if (snap.routes && typeof snap.routes === 'object') {
      for (const [key, r] of Object.entries(snap.routes) as [string, any][]) {
        const latencies = new Array(1000).fill(0)
        if (Array.isArray(r.latencies)) {
          for (let i = 0; i < Math.min(r.latencies.length, 1000); i++)
            latencies[i] = r.latencies[i] ?? 0
        }
        store.set(key, { requests: r.requests ?? 0, errors: r.errors ?? 0, latencies, head: r.head ?? 0 })
      }
    }
  } catch { /* no file or corrupt — start fresh */ }
  setInterval(writeSnapshot, 30_000)
  process.on('exit', writeSnapshot)
}

export function recordRequest(method: string, route: string, status: number, ms: number): void {
  const key = `${method} ${route}`
  let m = store.get(key)
  if (!m) {
    m = { requests: 0, errors: 0, latencies: new Array(1000).fill(0), head: 0 }
    store.set(key, m)
  }
  m.requests++
  if (status >= 500 || status === 499) m.errors++
  m.latencies[m.head % 1000] = ms
  m.head++

  globalLatencies[globalHead % 1000] = ms
  globalHead++
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

export function getMetrics(): MetricsSnapshot {
  const routes: RouteSnapshot[] = []
  for (const [key, m] of store.entries()) {
    const count = Math.min(m.head, 1000)
    const sample = m.latencies.slice(0, count).sort((a, b) => a - b)
    routes.push({
      route: key,
      requests: m.requests,
      errors: m.errors,
      p50: percentile(sample, 50),
      p95: percentile(sample, 95),
      p99: percentile(sample, 99),
    })
  }
  routes.sort((a, b) => b.requests - a.requests)

  const gCount = Math.min(globalHead, 1000)
  const gSample = globalLatencies.slice(0, gCount).sort((a, b) => a - b)

  return {
    uptime: Date.now() - startTime,
    totalRequests: routes.reduce((s, r) => s + r.requests, 0),
    totalErrors: routes.reduce((s, r) => s + r.errors, 0),
    globalP50: percentile(gSample, 50),
    globalP95: percentile(gSample, 95),
    globalP99: percentile(gSample, 99),
    routes,
  }
}

export function resetMetrics(): void {
  store.clear()
  globalLatencies.fill(0)
  globalHead = 0
  startTime = Date.now()
  writeSnapshot()
}

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
  routes: RouteSnapshot[]
}

const store = new Map<string, RouteMetrics>()
// Global ring buffer for true cross-route percentiles
const globalLatencies = new Array(1000).fill(0)
let globalHead = 0
let startTime = Date.now()

export function recordRequest(method: string, route: string, status: number, ms: number): void {
  const key = `${method} ${route}`
  if (!store.has(key)) {
    store.set(key, { requests: 0, errors: 0, latencies: new Array(1000).fill(0), head: 0 })
  }
  const m = store.get(key)!
  m.requests++
  if (status >= 500) m.errors++
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
    routes,
  }
}

export function resetMetrics(): void {
  store.clear()
  globalLatencies.fill(0)
  globalHead = 0
  startTime = Date.now()
}

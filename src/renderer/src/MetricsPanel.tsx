import { useEffect, useState } from 'react'

const api = (window as any).api

interface RouteSnapshot {
  route: string; requests: number; errors: number; p50: number; p95: number; p99: number
}
interface MetricsSnapshot {
  uptime: number; totalRequests: number; totalErrors: number
  globalP50: number; globalP95: number; globalP99: number; routes: RouteSnapshot[]
}

function msColor(ms: number): string {
  if (ms >= 500) return '#ff6b6b'
  if (ms >= 200) return '#ffa94d'
  return '#69db7c'
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

export default function MetricsPanel() {
  const [data, setData] = useState<MetricsSnapshot | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function fetchMetrics() {
    try {
      const snapshot = await api.metrics.get()
      setData(snapshot)
      setLastUpdated(new Date())
    } catch { /* backend not ready yet */ }
  }

  async function reset() {
    try {
      await api.metrics.reset()
    } catch { /* backend not ready */ }
    fetchMetrics()
  }

  useEffect(() => {
    fetchMetrics()
    const id = setInterval(fetchMetrics, 5000)
    return () => clearInterval(id)
  }, [])

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#666', fontFamily: 'monospace' }}>
        Waiting for backend...
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#ccc', background: '#111', height: '100vh', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #333', background: '#1a1a1a' }}>
        <span style={{ color: '#888', fontSize: 12 }}>
          Uptime: <strong style={{ color: '#eee' }}>{formatUptime(data.uptime)}</strong>
          &nbsp;·&nbsp;
          Last updated: <strong style={{ color: '#eee' }}>{lastUpdated?.toLocaleTimeString()}</strong>
        </span>
        <button
          onClick={reset}
          style={{ fontSize: 11, padding: '3px 10px', background: '#2a2a2a', color: '#ccc', border: '1px solid #444', borderRadius: 4, cursor: 'pointer' }}
        >
          Reset
        </button>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a' }}>
        {[
          { label: 'Total Requests', value: data.totalRequests.toLocaleString(), color: '#eee' },
          { label: 'Errors', value: String(data.totalErrors), color: data.totalErrors > 0 ? '#ff6b6b' : '#eee' },
          { label: 'P50 (global)', value: `${data.globalP50}ms`, color: msColor(data.globalP50) },
          { label: 'P95 (global)', value: `${data.globalP95}ms`, color: msColor(data.globalP95) },
          { label: 'P99 (global)', value: `${data.globalP99}ms`, color: msColor(data.globalP99) },
        ].map(({ label, value, color }, i, arr) => (
          <div key={label} style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRight: i < arr.length - 1 ? '1px solid #2a2a2a' : undefined }}>
            <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Route table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#181818', color: '#777' }}>
            {['Route', 'Reqs', 'Errors', 'P50', 'P95', 'P99'].map(h => (
              <th key={h} style={{ padding: '7px 10px', fontWeight: 500, textAlign: h === 'Route' ? 'left' : 'right' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.routes.map((r, i) => (
            <tr key={r.route} style={{ borderTop: '1px solid #222', background: i % 2 ? '#1c1c1c' : 'transparent' }}>
              <td style={{ padding: '6px 10px', color: '#9cf' }}>{r.route}</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', color: '#ccc' }}>{r.requests}</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', color: r.errors > 0 ? '#ff6b6b' : '#888' }}>{r.errors}</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', color: msColor(r.p50) }}>{r.p50}ms</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', color: msColor(r.p95) }}>{r.p95}ms</td>
              <td style={{ padding: '6px 10px', textAlign: 'right', color: msColor(r.p99) }}>{r.p99}ms</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ padding: '8px 10px', color: '#555', fontSize: 11, borderTop: '1px solid #222' }}>
        🟢 &lt;200ms &nbsp;&nbsp; 🟠 200–500ms &nbsp;&nbsp; 🔴 &gt;500ms
        &nbsp;&nbsp;·&nbsp;&nbsp; Percentiles from last 1,000 requests per route
      </div>
    </div>
  )
}

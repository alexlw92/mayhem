# Design: API Monitoring — Structured Logs and In-App Metrics Window

## Context

The Express backend currently has no error middleware and no latency tracking. Route handlers are bare `await dbCall()` with no try/catch. Unhandled errors produce a silent default 500. There is no visibility into which routes are slow or failing.

Two additions:
1. **Structured log file** via pino + pino-http + pino-roll — every request logged as JSON with method, URL, status, and `responseTime`. Unhandled errors logged with stack trace. Log file rotates at 10 MB, 3 files kept.
2. **In-app metrics window** — a second Electron BrowserWindow showing per-route request counts, error counts, and P50/P95/P99 latency from an in-memory store. Opened via `View > API Metrics` in the app menu.

---

## File Map

| File | Change |
|------|--------|
| `src/backend/logger.ts` | Create — pino singleton with pino-roll file transport |
| `src/backend/metrics.ts` | Create — in-memory metrics store |
| `src/backend/server.ts` | Modify — add pino-http, metrics middleware, global error handler |
| `src/backend/routes/stats.ts` | Modify — add `GET /api/metrics` and `POST /api/metrics/reset` |
| `src/main/index.ts` | Modify — set `MAYHEM_LOG_FILE` env var, add `View > API Metrics` menu item |
| `src/renderer/MetricsPanel.tsx` | Create — React component polling `/api/metrics` every 5s |

---

## logger.ts

Pino singleton that writes structured JSON to a rotating log file.

```typescript
import pino from 'pino'

const logFile = process.env.MAYHEM_LOG_FILE
const level = process.env.NODE_ENV === 'production' ? 'info' : 'debug'

export const logger = logFile
  ? pino({ level }, pino.transport({
      target: 'pino-roll',
      options: { file: logFile, size: '10m', limit: { count: 3 } },
    }))
  : pino({ level })
```

- `MAYHEM_LOG_FILE` is always set by the main process (dev and production differ only in path)
- Dev path: `os.tmpdir()/mayhem-backend.log`
- Production path: `app.getPath('logs')/mayhem-backend.log`
- Log level: `debug` in dev, `info` in production
- Rotation: 10 MB per file, 3 files kept (`mayhem-backend.log`, `.1`, `.2`)

**Sample request log line:**
```json
{"level":30,"time":1722960000123,"msg":"GET /api/players","req":{"method":"GET","url":"/api/players?patches=15.12"},"res":{"statusCode":200},"responseTime":38}
```

**Sample error log line:**
```json
{"level":50,"time":1722960001000,"err":{"type":"Error","message":"column does not exist","stack":"Error: column..."},"req":{"method":"GET","url":"/api/champions"},"msg":"unhandled route error"}
```

---

## metrics.ts

In-memory metrics store. No persistence — resets on backend restart (or on demand).

```typescript
interface RouteMetrics {
  requests: number
  errors: number
  latencies: number[]   // ring buffer, capacity 1000
  head: number          // next write index
}

const store = new Map<string, RouteMetrics>()
const startTime = Date.now()

export function recordRequest(method: string, route: string, status: number, ms: number): void
export function getMetrics(): MetricsSnapshot
export function resetMetrics(): void
```

- Key format: `"METHOD /route/template"` — uses `req.route?.path` (Express template e.g. `/players/:puuid/performance`) not the resolved URL
- Ring buffer holds last 1000 response times per route; P50/P95/P99 computed by sorting on `getMetrics()` call
- `getMetrics()` returns routes sorted by request count descending, plus global `totalRequests`, `totalErrors`, `uptime` (ms since start)
- `resetMetrics()` clears the Map and resets startTime

---

## server.ts — middleware stack

Added in this order (before existing routes):

1. **`pinoHttp({ logger })`** — logs every request to file. Fires on response finish with `responseTime` in ms.

2. **Metrics middleware** — attaches `res.on('finish', ...)` before routing. On finish, reads `req.route?.path ?? req.path` and calls `recordRequest`. Using `res.on('finish')` ensures `req.route` is set (Express populates it during routing).

3. Existing: CORS, JSON body parser, auth middleware (unchanged)

4. Route handlers (unchanged)

5. **Global error handler** `(err, req, res, next)` — added after all routes:
   - Calls `logger.error({ err, req: { method, url } }, 'unhandled route error')` — writes to pino file
   - Calls `console.error(...)` — reaches renderer via existing IPC proxy
   - Returns `res.status(500).json({ error: 'Internal server error' })`

---

## /api/metrics route

Added to `src/backend/routes/stats.ts`:

```
GET  /api/metrics        → getMetrics() response
POST /api/metrics/reset  → resetMetrics(), returns { ok: true }
```

`GET /api/metrics` response shape:
```typescript
{
  uptime: number,          // ms since backend start (or last reset)
  totalRequests: number,
  totalErrors: number,
  routes: Array<{
    route: string,         // "GET /api/players/:puuid/performance"
    requests: number,
    errors: number,
    p50: number,           // ms
    p95: number,
    p99: number,
  }>
}
```

---

## Electron window — main process changes (src/main/index.ts)

**`MAYHEM_LOG_FILE` env var** — set when spawning the backend utility process:
```typescript
const logFile = app.isPackaged
  ? path.join(app.getPath('logs'), 'mayhem-backend.log')
  : path.join(os.tmpdir(), 'mayhem-backend.log')
// pass as env var to backend utilityProcess
```

**App menu item** — add `View > API Metrics` that opens a second BrowserWindow:
```typescript
const metricsWin = new BrowserWindow({ width: 900, height: 600, title: 'API Metrics', ... })
// In dev: load the same Vite dev server URL with #metrics appended
// In production: load the same file:// path with #metrics appended
// The URL/path is the same one used for the main window — just append the hash
```

The window is created lazily on first menu click. Subsequent clicks focus the existing window if it's open. The window closes independently of the main window.

---

## MetricsPanel.tsx

React component rendered when `window.location.hash === '#metrics'`. Replaces the normal app UI in the metrics window.

- Polls `GET /api/metrics` every 5 seconds via `setInterval`
- Renders:
  - Header bar: uptime, last updated timestamp, Reset button
  - Summary row: total requests, total errors, global P50, global P95
  - Route table: route | requests | errors | P50 | P95 | P99
- Color coding: green < 200ms, orange 200–500ms, red > 500ms
- Error count cell colored red when > 0
- Reset button calls `POST /api/metrics/reset` then immediately re-fetches

---

## Console proxy — unchanged

Pino writes to the file transport only and does not go through `console.log`. The existing `console.log/warn/error` override in `src/main/index.ts` (which forwards to the renderer via IPC `main-log`) is untouched. The global error handler deliberately calls `console.error` in addition to pino so errors reach the renderer.

---

## No tests

Logging and metrics middleware are infrastructure — correctness is verified by running the app. The existing route tests in `src/backend/__tests__/routes.test.ts` continue to pass unchanged (pino-http and the metrics middleware are transparent to route behavior).

---

## Verification

1. Start app in dev — confirm `os.tmpdir()/mayhem-backend.log` is created and populated with JSON lines
2. Open `View > API Metrics` — metrics window opens, table populates after first poll
3. Navigate between tabs — request counts increment, latency values appear
4. Trigger a route error (e.g. bad query) — error appears in log file with stack trace AND in renderer log panel
5. Click Reset — counts clear, uptime resets
6. Rotate test: confirm `pino-roll` creates `.1` file after 10 MB

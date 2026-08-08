# Design: Persist API Metrics Across Server Restarts

## Context

The in-memory metrics store (`src/backend/metrics.ts`) resets to zero on every server restart — request counts, error counts, and latency ring buffers are all lost. The pino log file already persists across restarts via pino-roll, but the Metrics window goes blank whenever the backend process is restarted.

The fix is a JSON snapshot file written periodically and on shutdown, loaded on startup.

---

## Design

### What persists

Everything in the store: per-route `requests`, `errors`, the full 1000-slot `latencies` ring buffer, and the unbounded `head` counter. The global latency buffer and its `head`. The `startTime` — so that `uptime` in the Metrics window means "time since last manual reset" rather than "server uptime", which stays consistent with accumulated data spanning multiple restarts.

Ring-buffer semantics are restored exactly: `head` is the unbounded write index, and `latencies[head % 1000]` picks up where it left off.

### What doesn't persist

Nothing else changes. Latency percentiles are always computed from the restored ring buffer on `getMetrics()` — no separate persistence needed.

### File location

Derived from `MAYHEM_LOG_FILE` by replacing `.log` with `-metrics.json`. Keeps both files in the same directory with no new env var.

- Dev: `os.tmpdir()/mayhem-metrics.json`
- Prod: `app.getPath('logs')/mayhem-metrics.json`

### File format

```json
{
  "startTime": 1722960000123,
  "globalLatencies": [38, 42, 55, 0, 0, ...],
  "globalHead": 500,
  "routes": {
    "GET /api/players": { "requests": 142, "errors": 0, "latencies": [38, 42, ...], "head": 142 },
    "POST /api/matches/bulk": { "requests": 87, "errors": 2, "latencies": [120, 95, ...], "head": 87 }
  }
}
```

Estimated size: ~5KB per route × ~20 routes + global = ~105KB. Well within reason.

---

## Implementation

### `src/backend/metrics.ts`

Add `initMetricsPersistence(filePath: string): void`:

1. **Load**: if the file exists and parses cleanly, restore `startTime`, `globalLatencies`, `globalHead`, and for each route entry restore `requests`, `errors`, `latencies`, `head` into the store. Ignore corrupt/missing files silently (fresh start).
2. **Periodic write**: `setInterval` every 30s calling an internal `writeSnapshot()`.
3. **Exit write**: `process.on('exit', () => writeSnapshot())` for a final synchronous write on graceful shutdown. Use `fs.writeFileSync` here (sync is required in `exit` handler).

`writeSnapshot()` serializes the current store and globals to the file path. Uses `fs.writeFileSync` with a try/catch — a failed write logs a warning but does not throw.

Update `resetMetrics()` to also call `writeSnapshot()` after clearing state, so the cleared state (empty counts, fresh `startTime`) survives a subsequent restart.

### `src/backend/server-entry.ts`

Derive the metrics path and call `initMetricsPersistence` inside the `.listen` callback:

```typescript
import path from 'path'
import { initMetricsPersistence } from './metrics'

// inside .listen callback:
const logFile = process.env.MAYHEM_LOG_FILE
if (logFile) {
  const metricsFile = logFile.replace(/\.log$/, '-metrics.json')
  initMetricsPersistence(metricsFile)
}
```

If `MAYHEM_LOG_FILE` is not set (e.g. test environment), persistence is simply skipped.

---

## Files Changed

| File | Change |
|------|--------|
| `src/backend/metrics.ts` | Add `initMetricsPersistence(filePath)`; update `resetMetrics()` to write snapshot |
| `src/backend/server-entry.ts` | Derive metrics file path from `MAYHEM_LOG_FILE`; call `initMetricsPersistence` |

---

## Verification

1. Start the app, navigate between tabs to generate request counts
2. Restart the backend (quit and reopen app, or restart dev server)
3. Open `View > API Metrics` — confirm request counts from the previous session are present
4. Click Reset — counts clear to zero; restart again — confirm counts remain at zero (reset persisted)
5. Corrupt the metrics file manually — confirm the server starts cleanly with a fresh state (no crash)
6. Run `npm test` — all tests pass

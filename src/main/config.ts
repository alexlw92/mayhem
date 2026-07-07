// ─── Sync configuration ───────────────────────────────────────────────────────

/** How often the sync worker polls the queue for the next player job. */
export const AUTOSYNC_INTERVAL_MS = 15_000

/** A player is considered stale and will be re-synced if their last sync was older than this. */
export const SYNC_STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000 // 12 hours
/** Maximum total time spent waiting across all retries for a single LCU request. */
export const LCU_MAX_RETRY_MS = 15_000 // 10 seconds
/** Initial backoff delay for LCU request retries (doubles each attempt up to LCU_MAX_RETRY_MS). */
export const LCU_RETRY_BASE_DELAY_MS = 1_000

// ─── Backend configuration ────────────────────────────────────────────────────

/** URL of the Express backend. Defaults to localhost (host mode). Remote clients override via env. */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3847'
/** Port the embedded Express server listens on (host mode only). */
export const BACKEND_PORT = parseInt(process.env.BACKEND_PORT ?? '3847')
/** How long a claimed sync job lease lasts before another worker can reclaim it. */
export const SYNC_LEASE_MS = 5 * 60 * 1000
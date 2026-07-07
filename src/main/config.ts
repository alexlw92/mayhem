// ─── Sync configuration ───────────────────────────────────────────────────────

/** How often the automatic background sync runs. */
export const AUTOSYNC_INTERVAL_MS = 12 * 60 * 60 * 1000 // 8 hours

/** A player is considered stale and will be re-synced if their last sync was older than this. */
export const SYNC_STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000 // 12 hours
/** Maximum total time spent waiting across all retries for a single LCU request. */
export const LCU_MAX_RETRY_MS = 10_000 // 10 seconds
/** Initial backoff delay for LCU request retries (doubles each attempt up to LCU_MAX_RETRY_MS). */
export const LCU_RETRY_BASE_DELAY_MS = 2_000
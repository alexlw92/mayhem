import type { Match } from './db'
import { getExistingMatchIds, insertMatches } from './db'

// Queue 1: raw batches received from HTTP
const ingestQueue: Match[][] = []
let q1Running = false

// Queue 2: deduplicated new-only matches
const insertQueue: Match[] = []
let q2Running = false

export function enqueueMatches(batch: Match[]): number {
  if (batch.length === 0) return 0
  ingestQueue.push(batch)
  if (!q1Running) runIngestWorker()
  return batch.length
}

async function runIngestWorker(): Promise<void> {
  q1Running = true
  while (ingestQueue.length > 0) {
    const batch = ingestQueue.shift()!
    try {
      const existingIds = await getExistingMatchIds(batch.map(m => m.gameId))
      const newMatches = batch.filter(m => !existingIds.has(m.gameId))
      if (newMatches.length > 0) {
        insertQueue.push(...newMatches)
        if (!q2Running) runInsertWorker()
      }
    } catch (err) {
      console.error('[matchQueue] dedup failed, batch dropped:', (err as Error).message)
    }
  }
  q1Running = false
}

async function runInsertWorker(): Promise<void> {
  q2Running = true
  while (insertQueue.length > 0) {
    const batch = insertQueue.splice(0, insertQueue.length)
    try {
      await insertMatches(batch)
    } catch (err) {
      console.error('[matchQueue] insert failed, batch dropped:', (err as Error).message)
    }
  }
  q2Running = false
}

// Exported for tests only — resolves when both queues are fully drained
export function drainForTest(): Promise<void> {
  return new Promise((resolve) => {
    function check() {
      if (ingestQueue.length === 0 && insertQueue.length === 0 && !q1Running && !q2Running) {
        resolve()
      } else {
        setImmediate(check)
      }
    }
    check()
  })
}

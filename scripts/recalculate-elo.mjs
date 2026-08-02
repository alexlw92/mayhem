import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: path.resolve(__dirname, '../.env.dev') })
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false })

const postgres = require('postgres')

// Flags:
//   --incremental  skip the wipe; only process games newer than each player's watermark
//   --queue=2400   target a single queue (default: both 2400 and 2450)
const args = process.argv.slice(2)
const incremental = args.includes('--incremental')
const queueArg = args.find(a => a.startsWith('--queue='))
const queues = queueArg ? [parseInt(queueArg.split('=')[1])] : [2400, 2450]

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is not set — check your .env.dev file')
    process.exit(1)
  }

  const sql = postgres(dbUrl, { onnotice: () => {} })
  let indexesDropped = false
  try {
    // Step 1 — wipe existing Elo so updateElo starts from watermark=0 (full recompute)
    if (!incremental) {
      for (const q of queues) {
        console.log(`Clearing Elo for queue ${q}…`)
        await sql`DELETE FROM elo_history WHERE "queueId" = ${q}`
        await sql`DELETE FROM player_elo  WHERE "queueId" = ${q}`
      }

      // Drop elo_history indexes so bulk inserts skip per-row B-tree updates.
      // They are recreated after all data is written.
      console.log('Dropping elo_history indexes for bulk insert…')
      await sql`ALTER TABLE elo_history DROP CONSTRAINT IF EXISTS elo_history_pkey`
      await sql`DROP INDEX IF EXISTS idx_elo_history_puuid_queue_gc`
      indexesDropped = true
    }

    // Step 2 — recompute via compiled backend (requires: npm run server:build)
    const { connectDb, updateElo } = require('../dist-server/db.js')
    await connectDb(dbUrl)

    for (const q of queues) {
      const [{ total_games }] = await sql`
        SELECT COUNT(*)::int AS total_games FROM matches WHERE "queueId" = ${q}
      `
      console.log(`Computing Elo for queue ${q} (${total_games} games)…`)
      const t = Date.now()
      const processed = await updateElo(q, { freshInsert: !incremental })
      console.log(`Queue ${q} done in ${((Date.now() - t) / 1000).toFixed(1)}s (${processed} games)`)
    }

    // Step 3 — recreate elo_history indexes now that all data is written
    if (indexesDropped) {
      console.log('Rebuilding elo_history indexes…')
      const t = Date.now()
      await sql`ALTER TABLE elo_history ADD PRIMARY KEY (puuid, "gameId", "queueId")`
      await sql`CREATE INDEX idx_elo_history_puuid_queue_gc ON elo_history (puuid, "queueId", "gameCreation")`
      console.log(`Indexes rebuilt in ${((Date.now() - t) / 1000).toFixed(1)}s`)
    }
  } finally {
    await sql.end()
  }

  console.log('Elo recalculation complete.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

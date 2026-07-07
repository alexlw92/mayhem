import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const postgres = require('postgres')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL not set')

const sql = postgres(DATABASE_URL, { ssl: 'require', onnotice: () => {} })

// Insert syncedAt=0 for every player in participants who has no sync time row.
// Existing rows are left untouched (ON CONFLICT DO NOTHING).
const result = await sql`
  INSERT INTO player_sync_times (puuid, "syncedAt")
  SELECT DISTINCT puuid, 0 FROM participants WHERE puuid != ''
  ON CONFLICT (puuid) DO NOTHING
`
console.log(`Done — ${result.count} missing sync-time rows backfilled.`)

await sql.end()

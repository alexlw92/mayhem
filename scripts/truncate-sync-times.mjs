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

await sql`TRUNCATE player_sync_times`
console.log('player_sync_times truncated.')

await sql.end()

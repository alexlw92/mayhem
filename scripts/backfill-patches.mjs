import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const postgres = require('postgres')

const PATCH_DATES = [
  { patch: '14.1',  startMs: new Date('2024-01-10T12:00:00Z').getTime() },
  { patch: '14.2',  startMs: new Date('2024-01-24T12:00:00Z').getTime() },
  { patch: '14.3',  startMs: new Date('2024-02-07T12:00:00Z').getTime() },
  { patch: '14.4',  startMs: new Date('2024-02-21T12:00:00Z').getTime() },
  { patch: '14.5',  startMs: new Date('2024-03-06T12:00:00Z').getTime() },
  { patch: '14.6',  startMs: new Date('2024-03-20T12:00:00Z').getTime() },
  { patch: '14.7',  startMs: new Date('2024-04-03T12:00:00Z').getTime() },
  { patch: '14.8',  startMs: new Date('2024-04-17T12:00:00Z').getTime() },
  { patch: '14.9',  startMs: new Date('2024-05-01T12:00:00Z').getTime() },
  { patch: '14.10', startMs: new Date('2024-05-15T12:00:00Z').getTime() },
  { patch: '14.11', startMs: new Date('2024-06-05T12:00:00Z').getTime() },
  { patch: '14.12', startMs: new Date('2024-06-19T12:00:00Z').getTime() },
  { patch: '14.13', startMs: new Date('2024-07-03T12:00:00Z').getTime() },
  { patch: '14.14', startMs: new Date('2024-07-17T12:00:00Z').getTime() },
  { patch: '14.15', startMs: new Date('2024-07-31T12:00:00Z').getTime() },
  { patch: '14.16', startMs: new Date('2024-08-14T12:00:00Z').getTime() },
  { patch: '14.17', startMs: new Date('2024-08-28T12:00:00Z').getTime() },
  { patch: '14.18', startMs: new Date('2024-09-11T12:00:00Z').getTime() },
  { patch: '14.19', startMs: new Date('2024-09-25T12:00:00Z').getTime() },
  { patch: '14.20', startMs: new Date('2024-10-09T12:00:00Z').getTime() },
  { patch: '14.21', startMs: new Date('2024-10-23T12:00:00Z').getTime() },
  { patch: '14.22', startMs: new Date('2024-11-06T12:00:00Z').getTime() },
  { patch: '14.23', startMs: new Date('2024-11-20T12:00:00Z').getTime() },
  { patch: '14.24', startMs: new Date('2024-12-11T12:00:00Z').getTime() },
  { patch: '15.1',  startMs: new Date('2025-01-08T12:00:00Z').getTime() },
  { patch: '15.2',  startMs: new Date('2025-01-22T12:00:00Z').getTime() },
  { patch: '15.3',  startMs: new Date('2025-02-05T12:00:00Z').getTime() },
  { patch: '15.4',  startMs: new Date('2025-02-19T12:00:00Z').getTime() },
  { patch: '15.5',  startMs: new Date('2025-03-05T12:00:00Z').getTime() },
  { patch: '15.6',  startMs: new Date('2025-03-19T12:00:00Z').getTime() },
  { patch: '15.7',  startMs: new Date('2025-04-02T12:00:00Z').getTime() },
  { patch: '15.8',  startMs: new Date('2025-04-16T12:00:00Z').getTime() },
  { patch: '15.9',  startMs: new Date('2025-04-30T12:00:00Z').getTime() },
  { patch: '15.10', startMs: new Date('2025-05-14T12:00:00Z').getTime() },
  { patch: '15.11', startMs: new Date('2025-05-28T12:00:00Z').getTime() },
  { patch: '15.12', startMs: new Date('2025-06-11T12:00:00Z').getTime() },
  { patch: '15.13', startMs: new Date('2025-06-25T12:00:00Z').getTime() },
  { patch: '15.14', startMs: new Date('2025-07-09T12:00:00Z').getTime() },
  { patch: '15.15', startMs: new Date('2025-07-23T12:00:00Z').getTime() },
  { patch: '15.16', startMs: new Date('2025-08-06T12:00:00Z').getTime() },
  { patch: '15.17', startMs: new Date('2025-08-20T12:00:00Z').getTime() },
  { patch: '15.18', startMs: new Date('2025-09-03T12:00:00Z').getTime() },
  { patch: '15.19', startMs: new Date('2025-09-17T12:00:00Z').getTime() },
  { patch: '15.20', startMs: new Date('2025-10-01T12:00:00Z').getTime() },
  { patch: '15.21', startMs: new Date('2025-10-15T12:00:00Z').getTime() },
  { patch: '15.22', startMs: new Date('2025-10-29T12:00:00Z').getTime() },
  { patch: '15.23', startMs: new Date('2025-11-12T12:00:00Z').getTime() },
  { patch: '15.24', startMs: new Date('2025-11-26T12:00:00Z').getTime() },
  { patch: '16.1',  startMs: new Date('2026-01-07T12:00:00Z').getTime() },
  { patch: '16.2',  startMs: new Date('2026-01-21T12:00:00Z').getTime() },
  { patch: '16.3',  startMs: new Date('2026-02-04T12:00:00Z').getTime() },
  { patch: '16.4',  startMs: new Date('2026-02-18T12:00:00Z').getTime() },
  { patch: '16.5',  startMs: new Date('2026-03-04T12:00:00Z').getTime() },
  { patch: '16.6',  startMs: new Date('2026-03-18T12:00:00Z').getTime() },
  { patch: '16.7',  startMs: new Date('2026-04-01T12:00:00Z').getTime() },
  { patch: '16.8',  startMs: new Date('2026-04-15T12:00:00Z').getTime() },
  { patch: '16.9',  startMs: new Date('2026-04-29T12:00:00Z').getTime() },
  { patch: '16.10', startMs: new Date('2026-05-13T12:00:00Z').getTime() },
  { patch: '16.11', startMs: new Date('2026-05-27T12:00:00Z').getTime() },
  { patch: '16.12', startMs: new Date('2026-06-10T12:00:00Z').getTime() },
  { patch: '16.13', startMs: new Date('2026-06-24T12:00:00Z').getTime() },
]

function inferPatch(gameCreation) {
  let result
  for (const entry of PATCH_DATES) {
    if (entry.startMs <= gameCreation) result = entry.patch
    else break
  }
  return result
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set — check your .env file')
    process.exit(1)
  }

  const sql = postgres(url, { ssl: 'require', onnotice: () => {} })

  try {
    const rows = await sql.unsafe('SELECT "gameId", "gameCreation" FROM matches WHERE "gameVersion" IS NULL')
    console.log(`Found ${rows.length} games with missing patch data`)

    let updated = 0
    let skipped = 0
    for (const row of rows) {
      const patch = inferPatch(Number(row.gameCreation))
      if (patch) {
        await sql.unsafe(`UPDATE matches SET "gameVersion" = '${patch}' WHERE "gameId" = ${row.gameId}`)
        updated++
      } else {
        console.warn(`  skipped gameId=${row.gameId} — gameCreation before all known patches`)
        skipped++
      }
    }

    console.log(`Done — updated ${updated} games${skipped > 0 ? `, skipped ${skipped}` : ''}`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

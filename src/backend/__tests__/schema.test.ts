import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { initDb } from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

describe('initDb schema migrations', () => {
  let sql: ReturnType<typeof postgres>

  beforeAll(async () => {
    await initDb(TEST_URL)
    sql = postgres(TEST_URL, { onnotice: () => {} })
  })

  afterAll(async () => { await sql.end() })

  it('adds missing columns to pre-existing tables without error', async () => {
    // Simulate an old-schema DB by dropping columns that were added later.
    // PostgreSQL automatically drops dependent indexes when a column is dropped.
    await sql`ALTER TABLE participants DROP COLUMN IF EXISTS "gameVersion" CASCADE`
    await sql`ALTER TABLE participants DROP COLUMN IF EXISTS "gameDuration" CASCADE`
    await sql`ALTER TABLE matches DROP COLUMN IF EXISTS "gameVersion" CASCADE`

    // Re-running initDb must succeed and restore the missing columns
    await expect(initDb(TEST_URL)).resolves.toBeUndefined()

    const participantCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'participants' AND column_name IN ('gameVersion', 'gameDuration')
    `
    expect(participantCols.map((r: any) => r.column_name).sort()).toEqual(['gameDuration', 'gameVersion'])

    const matchCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'matches' AND column_name = 'gameVersion'
    `
    expect(matchCols).toHaveLength(1)
  })
})

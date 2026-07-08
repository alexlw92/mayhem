import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  initDb,
  upsertChampions, getChampionsFromDb,
  upsertAugments, getAugmentsFromDb,
} from '../db'
import type { AugmentInfo } from '../db'

const TEST_URL = process.env.TEST_DATABASE_URL
if (!TEST_URL) throw new Error('TEST_DATABASE_URL is not set')

beforeAll(async () => { await initDb(TEST_URL) })

beforeEach(async () => {
  const postgres = (await import('postgres')).default
  const db = postgres(TEST_URL!, { onnotice: () => {} })
  await db`TRUNCATE meta_champions, meta_augments`
  await db.end()
})

describe('upsertChampions / getChampionsFromDb', () => {
  it('stores and retrieves champion names', async () => {
    await upsertChampions({ 1: 'Annie', 2: 'Olaf' })
    const result = await getChampionsFromDb()
    expect(result[1]).toBe('Annie')
    expect(result[2]).toBe('Olaf')
  })

  it('returns empty map when table is empty', async () => {
    expect(await getChampionsFromDb()).toEqual({})
  })

  it('is a no-op for empty input', async () => {
    await upsertChampions({})
    expect(await getChampionsFromDb()).toEqual({})
  })

  it('updates existing champion name on re-upsert', async () => {
    await upsertChampions({ 1: 'Annie' })
    await upsertChampions({ 1: 'Annie Hastur' })
    expect((await getChampionsFromDb())[1]).toBe('Annie Hastur')
  })
})

describe('upsertAugments / getAugmentsFromDb', () => {
  const aug: AugmentInfo = { id: 200, name: 'Tiny Titans', desc: '', iconPath: '', rarity: 1 }

  it('stores and retrieves augment data', async () => {
    await upsertAugments({ 200: aug })
    const result = await getAugmentsFromDb()
    expect(result[200].name).toBe('Tiny Titans')
    expect(result[200].rarity).toBe(1)
    expect(result[200].id).toBe(200)
  })

  it('returns empty map when table is empty', async () => {
    expect(await getAugmentsFromDb()).toEqual({})
  })

  it('is a no-op for empty input', async () => {
    await upsertAugments({})
    expect(await getAugmentsFromDb()).toEqual({})
  })

  it('updates existing augment on re-upsert', async () => {
    await upsertAugments({ 200: aug })
    await upsertAugments({ 200: { ...aug, name: 'Tiny Titans II', rarity: 2 } })
    const result = await getAugmentsFromDb()
    expect(result[200].name).toBe('Tiny Titans II')
    expect(result[200].rarity).toBe(2)
  })
})

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const postgres = require('postgres')

const LOCAL = 'postgresql://postgres:postgres@localhost:5432/mayhem'
const RDS   = process.env.DATABASE_URL

if (!RDS) { console.error('DATABASE_URL not set'); process.exit(1) }

const src = postgres(LOCAL, { onnotice: () => {} })
const dst = postgres(RDS,   { ssl: 'require', onnotice: () => {} })

const CHUNK = 500

async function main() {
  console.log('Reading local database...')
  const [matches, participants, augments, syncTimes] = await Promise.all([
    src.unsafe('SELECT * FROM matches ORDER BY "gameId"'),
    src.unsafe('SELECT * FROM participants ORDER BY id'),
    src.unsafe('SELECT * FROM participant_augments ORDER BY "participantId"'),
    src.unsafe('SELECT * FROM player_sync_times'),
  ])
  console.log(`  ${matches.length} matches, ${participants.length} participants, ${augments.length} augments, ${syncTimes.length} sync times\n`)

  // ── Matches ────────────────────────────────────────────────────────────────
  console.log('Inserting matches...')
  for (let i = 0; i < matches.length; i += CHUNK) {
    const chunk = matches.slice(i, i + CHUNK).map(m => ({
      gameId:      m.gameId,
      queueId:     m.queueId,
      gameCreation: m.gameCreation,
      gameDuration: m.gameDuration,
      gameVersion:  m.gameVersion ?? null,
    }))
    await dst`INSERT INTO matches ${dst(chunk, 'gameId','queueId','gameCreation','gameDuration','gameVersion')} ON CONFLICT ("gameId") DO NOTHING`
    process.stdout.write(`\r  ${Math.min(i + CHUNK, matches.length)}/${matches.length}`)
  }
  console.log('\n  done')

  // ── Participants ───────────────────────────────────────────────────────────
  console.log('Inserting participants...')
  const idMap = new Map()
  for (let i = 0; i < participants.length; i += CHUNK) {
    const chunk = participants.slice(i, i + CHUNK)
    const rows = chunk.map(p => ({
      gameId:       p.gameId,
      puuid:        p.puuid,
      summonerName: p.summonerName,
      championId:   p.championId,
      championName: p.championName,
      teamId:       p.teamId,
      win:          p.win,
      kills:        p.kills,
      deaths:       p.deaths,
      assists:      p.assists,
      damageDealt:  p.damageDealt,
      damageTaken:  p.damageTaken,
      goldEarned:   p.goldEarned,
      champLevel:   p.champLevel,
    }))
    const inserted = await dst`
      INSERT INTO participants ${dst(rows, 'gameId','puuid','summonerName','championId','championName','teamId','win','kills','deaths','assists','damageDealt','damageTaken','goldEarned','champLevel')}
      RETURNING id
    `
    chunk.forEach((p, j) => idMap.set(Number(p.id), Number(inserted[j].id)))
    process.stdout.write(`\r  ${Math.min(i + CHUNK, participants.length)}/${participants.length}`)
  }
  console.log('\n  done')

  // ── Augments ───────────────────────────────────────────────────────────────
  console.log('Inserting augments...')
  const mappedAugments = augments
    .map(a => ({ participantId: idMap.get(Number(a.participantId)), augmentId: a.augmentId }))
    .filter(a => a.participantId != null)

  for (let i = 0; i < mappedAugments.length; i += CHUNK) {
    const chunk = mappedAugments.slice(i, i + CHUNK)
    await dst`INSERT INTO participant_augments ${dst(chunk, 'participantId','augmentId')}`
    process.stdout.write(`\r  ${Math.min(i + CHUNK, mappedAugments.length)}/${mappedAugments.length}`)
  }
  console.log('\n  done')

  // ── Sync times ─────────────────────────────────────────────────────────────
  if (syncTimes.length > 0) {
    const rows = syncTimes.map(s => ({ puuid: s.puuid, syncedAt: s.syncedAt }))
    await dst`INSERT INTO player_sync_times ${dst(rows, 'puuid','syncedAt')} ON CONFLICT (puuid) DO UPDATE SET "syncedAt" = EXCLUDED."syncedAt"`
    console.log(`Sync times: ${syncTimes.length} done`)
  }

  console.log('\nMigration complete!')
}

main()
  .catch(e => { console.error(e.message); process.exit(1) })
  .finally(() => Promise.all([src.end(), dst.end()]))

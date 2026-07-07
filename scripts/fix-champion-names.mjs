import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dotenv = require('dotenv')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const postgres = require('postgres')
const axios = require('axios').default

async function fetchChampionNames() {
  const versionRes = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json', { timeout: 10000 })
  const version = versionRes.data[0]
  const champRes = await axios.get(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
    { timeout: 10000 }
  )
  const map = {}
  for (const champ of Object.values(champRes.data.data)) {
    map[parseInt(champ.key)] = champ.name
  }
  return map
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set — check your .env file'); process.exit(1) }

  const sql = postgres(url, { ssl: 'require', onnotice: () => {} })

  try {
    console.log('Fetching champion names from DDragon...')
    const champions = await fetchChampionNames()
    console.log(`Got ${Object.keys(champions).length} champions`)

    const ids = Object.keys(champions).map(Number)
    const names = ids.map(id => champions[id])

    const result = await sql`
      UPDATE participants
      SET "championName" = u.name
      FROM unnest(${ids}::int[], ${names}::text[]) AS u(id, name)
      WHERE "championId" = u.id AND "championName" != u.name
    `
    console.log(`Fixed ${result.count} participant record(s)`)
  } finally {
    await sql.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })

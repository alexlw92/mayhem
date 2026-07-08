import postgres from '../node_modules/postgres/src/index.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required')
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })

try {
  await sql.unsafe('CREATE DATABASE mayhem')
  console.log('Database created successfully')
} catch (e) {
  console.error(e.message)
} finally {
  await sql.end()
}

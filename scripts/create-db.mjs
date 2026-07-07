import postgres from '../node_modules/postgres/src/index.js'

const sql = postgres('postgresql://REDACTED:REDACTED@REDACTED/postgres', { ssl: 'require' })

try {
  await sql.unsafe('CREATE DATABASE mayhem')
  console.log('Database created successfully')
} catch (e) {
  console.error(e.message)
} finally {
  await sql.end()
}

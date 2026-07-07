import postgres from '../node_modules/postgres/src/index.js'

const sql = postgres('postgresql://alexlw92:mayram6767@mayhem-1.c3q2q2yaqbyq.us-east-2.rds.amazonaws.com:5432/postgres', { ssl: 'require' })

try {
  await sql.unsafe('CREATE DATABASE mayhem')
  console.log('Database created successfully')
} catch (e) {
  console.error(e.message)
} finally {
  await sql.end()
}

#!/usr/bin/env node
// Owner-authorized read-only migration allocation probe. Prints filenames only.
const dotenv = require('dotenv');
const { Client } = require('pg');
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
async function main() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw Object.assign(new Error('Database configuration unavailable'), { code: 'NO_DATABASE_CONFIGURATION' });
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    await client.query('ROLLBACK');
    process.stdout.write(JSON.stringify(result.rows.map(row => row.name), null, 2) + '\n');
  } finally { await client.end(); }
}
main().catch(error => { process.stderr.write(`Migration filename probe failed: ${error.code || 'QUERY_FAILED'}\n`); process.exitCode = 1; });

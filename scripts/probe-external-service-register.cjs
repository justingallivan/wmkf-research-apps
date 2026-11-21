#!/usr/bin/env node
/** Read-only register readiness probe. Logs schema/migration names and counts only, never notes or credentials. */
require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');
const { listMigrationFiles } = require('./apply-migrations');
async function main() {
  const client = new Client({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const migrations = await client.query('SELECT name FROM schema_migrations ORDER BY name DESC');
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('external_services','external_service_reviews') ORDER BY table_name");
    const tracked = new Set(migrations.rows.map(r => r.name));
    const result = { pendingMigrations: listMigrationFiles().filter(name => !tracked.has(name)), tables: tables.rows.map(r => r.table_name) };
    if (result.tables.length === 2) {
      result.counts = (await client.query('SELECT (SELECT count(*)::int FROM external_services) AS services, (SELECT count(*)::int FROM external_service_reviews) AS reviews')).rows[0];
    }
    await client.query('ROLLBACK');
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.end(); }
}
main().catch(error => { console.error('Register probe failed:', error.code || 'connection_or_query_error'); process.exitCode = 1; });

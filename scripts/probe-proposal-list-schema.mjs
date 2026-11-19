#!/usr/bin/env node
/**
 * READ-ONLY probe: is migration 101 (proposal list links) applied?
 *
 * Reads the app Postgres (POSTGRES_URL from .env.local) inside a READ ONLY
 * transaction. Prints:
 *   1. every migration file on disk that `schema_migrations` does not record,
 *      which is exactly what `node scripts/apply-migrations.js` would apply next;
 *   2. the tracker row for migration 101;
 *   3. whether `proposal_list_links` and `proposal_list_items` exist, with their
 *      column counts, the one-live-link index, and row counts.
 * Never prints recipients, tokens or proposal titles. Exits 0 when 101 is fully
 * in place, 1 when it is not, 2 on a configuration or connection problem.
 *
 * Usage: node scripts/probe-proposal-list-schema.mjs
 */

import fs from 'fs';
import pg from 'pg';

const MIGRATION = '101_proposal_list_links.sql';
const EXPECTED_COLUMNS = { proposal_list_links: 15, proposal_list_items: 9 };
const LIVE_LINK_INDEX = 'idx_proposal_list_links_live_per_recipient';

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && !(match[1] in process.env)) {
    process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
if (!process.env.POSTGRES_URL) {
  console.error('POSTGRES_URL missing from .env.local.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
let ready = true;
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');

  const where = await client.query('SELECT current_database() AS db');
  console.log(`Database: ${where.rows[0].db}`);

  const tracked = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const onDisk = fs.readdirSync('lib/db/migrations').filter((f) => /\.sql$/i.test(f)).sort();
  const pending = onDisk.filter((f) => !tracked.has(f));
  console.log(`\nMigration files not yet recorded (apply-migrations.js would apply these, in order): ${pending.length}`);
  for (const f of pending) console.log(`  ${f}`);

  const row = await client.query(
    `SELECT name, applied_by, to_char(applied_at, 'YYYY-MM-DD HH24:MI:SS') || ' UTC' AS applied_at
       FROM schema_migrations WHERE name = $1`,
    [MIGRATION],
  );
  if (row.rows.length) {
    console.log(`\nTracker: ${MIGRATION} applied ${row.rows[0].applied_at} by ${row.rows[0].applied_by}`);
  } else {
    console.log(`\nTracker: ${MIGRATION} NOT recorded`);
    ready = false;
  }

  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const cols = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    const n = cols.rows[0].n;
    if (n === 0) {
      console.log(`Table ${table}: MISSING`);
      ready = false;
      continue;
    }
    const count = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    const ok = n === expected;
    if (!ok) ready = false;
    console.log(`Table ${table}: present, ${n} columns (${ok ? 'as expected' : `EXPECTED ${expected}`}), ${count.rows[0].n} row(s)`);
  }

  const index = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [LIVE_LINK_INDEX],
  );
  if (index.rows.length) {
    console.log(`Index ${LIVE_LINK_INDEX}: present`);
  } else {
    console.log(`Index ${LIVE_LINK_INDEX}: MISSING`);
    ready = false;
  }

  await client.query('ROLLBACK');
  console.log(ready
    ? '\nResult: migration 101 is in place. PROPOSAL_LIST_SCHEMA_READY may be set to on.'
    : '\nResult: migration 101 is NOT fully in place. Leave PROPOSAL_LIST_SCHEMA_READY unset.');
} catch (err) {
  console.error('Probe failed:', err.message);
  process.exitCode = 2;
  ready = null;
} finally {
  await client.end().catch(() => {});
}
if (ready === false) process.exitCode = 1;

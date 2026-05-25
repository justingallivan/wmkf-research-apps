#!/usr/bin/env node
/**
 * scripts/apply-migrations.js
 *
 * Canonical apply path for `lib/db/migrations/*.sql` against a connected
 * Postgres instance. Reads tracker rows from `schema_migrations`, skips
 * any migration whose filename is already tracked, applies the rest in
 * lexicographic order.
 *
 * Each apply runs in its own transaction:
 *   BEGIN; <stripped body>; INSERT INTO schema_migrations (...); COMMIT;
 *
 * BEGIN/COMMIT stripping: only line-anchored top-level transaction markers
 * (`^\s*(BEGIN|COMMIT);\s*$`) are removed from the migration body. PL/pgSQL
 * `DO $$ BEGIN ... END $$` blocks (no semicolon after BEGIN) and `-- commit`
 * comment text are left untouched.
 *
 * Re-running is safe: tracked migrations are skipped without re-applying
 * (relying on the tracker, not on migration-body IF NOT EXISTS guards —
 * some migrations like 007 are NOT re-runnable).
 *
 * See docs/READINESS_AUDIT_PHASE0_PLAN.md § Step 4a.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'lib', 'db', 'migrations');
const TRACKER_TABLE = 'schema_migrations';
const APPLIED_BY = process.env.APPLY_MIGRATIONS_APPLIED_BY || 'apply-migrations.js';

function loadDotenv() {
  for (const f of ['.env', '.env.local']) {
    try {
      const txt = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      for (const ln of txt.split('\n')) {
        const t = ln.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 0) continue;
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch (_) { /* file missing — fine */ }
  }
}

/**
 * Strip only line-anchored top-level `BEGIN;` / `COMMIT;` markers.
 *
 * Verified safe against all 13 migrations 002-014: PL/pgSQL block `BEGIN`
 * (no semicolon, in 007) and comment text `-- commit` (in 012) are NOT
 * matched. See Codex pass-4 §3 + pass-5 Q2.
 */
function stripOuterTxn(body) {
  return body.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
}

async function ensureTracker(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKER_TABLE} (
      name         TEXT PRIMARY KEY,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_by   TEXT
    )
  `);
}

async function getTrackedNames(client) {
  const r = await client.query(`SELECT name FROM ${TRACKER_TABLE}`);
  return new Set(r.rows.map(row => row.name));
}

function listMigrationFiles() {
  const entries = fs.readdirSync(MIGRATIONS_DIR);
  return entries
    .filter(f => /\.sql$/i.test(f))
    .sort();
}

async function applyOne(client, filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const stripped = stripOuterTxn(raw);

  await client.query('BEGIN');
  try {
    await client.query(stripped);
    await client.query(
      `INSERT INTO ${TRACKER_TABLE} (name, applied_by) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [filename, APPLIED_BY]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: err };
  }
}

async function main() {
  loadDotenv();
  const { Client } = require('pg');
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('POSTGRES_URL / DATABASE_URL not set');
    process.exit(2);
  }

  const client = new Client({ connectionString });
  await client.connect();

  let exitCode = 0;
  try {
    await ensureTracker(client);
    const tracked = await getTrackedNames(client);
    const files = listMigrationFiles();

    let applied = 0;
    let skipped = 0;
    for (const f of files) {
      if (tracked.has(f)) {
        console.log(`[skip]  ${f}`);
        skipped += 1;
        continue;
      }
      const r = await applyOne(client, f);
      if (r.ok) {
        console.log(`[apply ok]  ${f}`);
        applied += 1;
      } else {
        console.error(`[apply failed]  ${f}: ${r.error.message}`);
        exitCode = 1;
        break;
      }
    }
    console.log(`\nSummary: ${applied} applied, ${skipped} skipped, ${files.length} total`);
  } catch (err) {
    console.error('Fatal:', err.message);
    exitCode = 1;
  } finally {
    await client.end();
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main().catch(err => { console.error('Unhandled:', err); process.exit(1); });
}

module.exports = { stripOuterTxn, listMigrationFiles };

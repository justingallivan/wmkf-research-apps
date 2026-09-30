#!/usr/bin/env node
/**
 * Apply the Test Request Factory ledger migrations to ONE ledger database
 * (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 3).
 *
 * Usage:
 *   node scripts/apply-ledger-migrations.js --url-env=TEST_REQUEST_LEDGER_URL [--dry-run]
 *   node scripts/apply-ledger-migrations.js --url-env=TEST_REQUEST_SANDBOX_LEDGER_URL
 *
 * Takes the NAME of the env variable, never the URL, so nothing lands in
 * shell history. Refuses any URL the ledger registry rejects
 * (lib/db/ledger-registry.js; the app's shared Postgres is never a ledger).
 *
 * Applies every lib/db/migrations file whose name contains `test_request`, in
 * filename order, each in its own transaction, recording it in the ledger's
 * own tracker table `ledger_schema_migrations` (applied_by = this script).
 * Files already in the tracker are skipped. The ledger migrations are written
 * idempotently (CREATE ... IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
 * DROP CONSTRAINT IF EXISTS + ADD), so a ledger built by hand before this
 * tracker existed simply has them re-applied once and recorded; no baseline
 * step is needed [VERIFIED 2026-09-30 against 054 and B4's 058].
 *
 * The app's apply-migrations.js is deliberately NOT reused: it applies the
 * whole manifest and writes the app's schema_migrations table.
 */

const fs = require('node:fs');
const path = require('node:path');

const APPLIED_BY = 'apply-ledger-migrations.js';

function loadEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (_) { /* no .env.local: env must already be set */ }
}

function stripOuterTxn(body) {
  return body.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
}

async function main() {
  const urlEnvArg = process.argv.find((a) => a.startsWith('--url-env='));
  const dryRun = process.argv.includes('--dry-run');
  const urlEnv = urlEnvArg?.slice('--url-env='.length);
  if (!urlEnv || !/^[A-Z0-9_]+$/.test(urlEnv)) {
    throw new Error('Pass --url-env=<ENV_VARIABLE_NAME> naming the ledger connection variable (never the URL itself).');
  }
  loadEnvLocal();
  const url = process.env[urlEnv];
  const { classifyLedgerUrl } = await import('../lib/db/ledger-registry.js');
  const { listLedgerMigrationFiles, LEDGER_MIGRATIONS_DIR, LEDGER_TRACKER_TABLE } = await import('../lib/db/ledger-schema.js');
  const sharedUrls = ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'DATABASE_URL']
    .map((name) => process.env[name]).filter(Boolean);
  const verdict = classifyLedgerUrl(url, { sharedUrls });
  if (!verdict.ok) {
    throw new Error(`${urlEnv} is not an acceptable ledger (${verdict.reason}). See lib/db/ledger-registry.js.`);
  }
  const database = verdict.effective.database;
  console.log(`Ledger: ${verdict.label} host, database ${database} (from ${urlEnv})${dryRun ? ' — DRY RUN' : ''}`);

  const files = listLedgerMigrationFiles(LEDGER_MIGRATIONS_DIR);
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  let exitCode = 0;
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER_TRACKER_TABLE} (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_by TEXT)`);
    const tracked = new Set((await client.query(`SELECT name FROM ${LEDGER_TRACKER_TABLE}`)).rows.map((r) => r.name));
    let applied = 0;
    let skipped = 0;
    for (const f of files) {
      if (tracked.has(f)) { console.log(`[skip]      ${f}`); skipped += 1; continue; }
      if (dryRun) { console.log(`[would apply] ${f}`); continue; }
      const sql = stripOuterTxn(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8'));
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${LEDGER_TRACKER_TABLE} (name, applied_by) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [f, APPLIED_BY]);
        await client.query('COMMIT');
        console.log(`[apply ok]  ${f}`);
        applied += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[apply failed] ${f}: ${err.message}`);
        exitCode = 1;
        break;
      }
    }
    console.log(`\nSummary: ${applied} applied, ${skipped} skipped, ${files.length} ledger migration file(s) in checkout`);
  } finally {
    await client.end();
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });

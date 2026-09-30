#!/usr/bin/env node
/**
 * Apply the Test Request Factory ledger migrations to ONE ledger database
 * (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 3;
 * Codex round-1 Fix 3 adds checksums and refuses silent baselining).
 *
 * Usage:
 *   node scripts/apply-ledger-migrations.js --url-env=TEST_REQUEST_LEDGER_URL [--dry-run]
 *   node scripts/apply-ledger-migrations.js --url-env=TEST_REQUEST_SANDBOX_LEDGER_URL
 *   node scripts/apply-ledger-migrations.js --url-env=... --accept-tracked-checksums
 *
 * Takes the NAME of the env variable, never the URL, so nothing lands in
 * shell history. Refuses any URL the ledger registry rejects
 * (lib/db/ledger-registry.js; the app's shared Postgres is never a ledger).
 *
 * Applies every lib/db/migrations file whose name contains `test_request`, in
 * filename order, recording each in the ledger's own tracker table
 * `ledger_schema_migrations(name, applied_at, applied_by, sha256)`.
 *
 * Per file, one of four actions (lib/db/ledger-migrations.js
 * decideFileAction):
 *   skip     tracked, checksum matches — nothing to do.
 *   apply    untracked, and none of its objects exist live yet — run its SQL
 *            and record it.
 *   adopt    untracked, its objects already exist live, and a semantic
 *            fingerprint comparison of "the checkout's files up to and
 *            including this one" against the live ledger is clean — record
 *            it WITHOUT re-running its SQL (this is what makes the runner
 *            safe on a hand-built ledger: it never silently re-applies an
 *            idempotent CREATE ... IF NOT EXISTS over a differently-shaped
 *            live table).
 *   refuse   tracked with a changed checksum (file edited in place after
 *            being applied — write a new numbered migration instead), OR
 *            untracked with live objects that differ from what this file
 *            would produce.
 * A legacy tracker row with no recorded checksum is "unknown": refuse until
 * --accept-tracked-checksums records the checkout's current checksum for it
 * (only meaningful when the operator has confirmed the file has not changed
 * since it was actually applied).
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

async function main() {
  const urlEnvArg = process.argv.find((a) => a.startsWith('--url-env='));
  const dryRun = process.argv.includes('--dry-run');
  const acceptTrackedChecksums = process.argv.includes('--accept-tracked-checksums');
  const urlEnv = urlEnvArg?.slice('--url-env='.length);
  if (!urlEnv || !/^[A-Z0-9_]+$/.test(urlEnv)) {
    throw new Error('Pass --url-env=<ENV_VARIABLE_NAME> naming the ledger connection variable (never the URL itself).');
  }
  loadEnvLocal();
  const url = process.env[urlEnv];
  const { classifyLedgerUrl } = await import('../lib/db/ledger-registry.js');
  const {
    listLedgerMigrationFiles, LEDGER_MIGRATIONS_DIR, LEDGER_TRACKER_TABLE,
    readLedgerFingerprint, compareLedgerFingerprint, formatLedgerDiff,
  } = await import('../lib/db/ledger-schema.js');
  const {
    decideFileAction, sha256Text, stripOuterTxn, tableNamesIn, fingerprintFilesInScratch,
  } = await import('../lib/db/ledger-migrations.js');
  const sharedUrls = ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'DATABASE_URL']
    .map((name) => process.env[name]).filter(Boolean);
  const verdict = classifyLedgerUrl(url, { sharedUrls });
  if (!verdict.ok) {
    throw new Error(`${urlEnv} is not an acceptable ledger (${verdict.reason}). See lib/db/ledger-registry.js.`);
  }
  const database = verdict.effective.database;
  console.log(`Ledger: ${verdict.label} host, database ${database} (from ${urlEnv})${dryRun ? ' — DRY RUN' : ''}`);

  const files = listLedgerMigrationFiles(LEDGER_MIGRATIONS_DIR);
  const fileSql = new Map(files.map((f) => [f, fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8')]));
  const fileChecksum = new Map(files.map((f) => [f, sha256Text(fileSql.get(f))]));

  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  let exitCode = 0;
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER_TRACKER_TABLE} (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_by TEXT, sha256 TEXT NOT NULL)`);
    await client.query(`ALTER TABLE ${LEDGER_TRACKER_TABLE} ADD COLUMN IF NOT EXISTS sha256 TEXT`);
    const tracked = new Map((await client.query(`SELECT name, sha256 FROM ${LEDGER_TRACKER_TABLE}`)).rows.map((r) => [r.name, { sha256: r.sha256 }]));

    let applied = 0;
    let adopted = 0;
    let acceptedChecksums = 0;
    let skipped = 0;
    const filesUpToHere = [];
    for (const f of files) {
      filesUpToHere.push(f);
      const currentChecksum = fileChecksum.get(f);
      const trackedRow = tracked.get(f) || null;

      let liveHasObjects = false;
      let scratchDiff = null;
      if (!trackedRow) {
        const names = tableNamesIn(fileSql.get(f));
        if (names.length > 0) {
          const { rows } = await client.query(
            'SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1) LIMIT 1',
            [names],
          );
          liveHasObjects = rows.length > 0;
        }
        if (liveHasObjects) {
          const scratchFp = await fingerprintFilesInScratch(client, filesUpToHere, LEDGER_MIGRATIONS_DIR, readLedgerFingerprint);
          const liveFp = await readLedgerFingerprint(client);
          scratchDiff = compareLedgerFingerprint(scratchFp, liveFp);
        }
      }

      const decision = decideFileAction({
        file: f, currentChecksum, trackedRow, liveHasObjects, scratchDiff, acceptTrackedChecksums,
      });

      if (decision.action === 'skip') { console.log(`[skip]      ${f}`); skipped += 1; continue; }

      if (decision.action === 'accept-checksum') {
        if (dryRun) { console.log(`[would accept-checksum] ${f}`); continue; }
        await client.query(`UPDATE ${LEDGER_TRACKER_TABLE} SET sha256 = $2 WHERE name = $1`, [f, currentChecksum]);
        console.log(`[accept-checksum] ${f}`);
        acceptedChecksums += 1;
        continue;
      }

      if (decision.action === 'refuse') {
        console.error(`[refuse]    ${decision.reason}`);
        if (scratchDiff) console.error(formatLedgerDiff(scratchDiff));
        exitCode = 1;
        break;
      }

      if (decision.action === 'adopt') {
        if (dryRun) { console.log(`[would adopt] ${f}`); continue; }
        await client.query(`INSERT INTO ${LEDGER_TRACKER_TABLE} (name, applied_by, sha256) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256`, [f, APPLIED_BY, currentChecksum]);
        console.log(`[adopt]     ${f} (objects already exist live; recorded without re-applying its SQL)`);
        adopted += 1;
        continue;
      }

      // decision.action === 'apply'
      if (dryRun) { console.log(`[would apply] ${f}`); continue; }
      await client.query('BEGIN');
      try {
        await client.query(stripOuterTxn(fileSql.get(f)));
        await client.query(`INSERT INTO ${LEDGER_TRACKER_TABLE} (name, applied_by, sha256) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256`, [f, APPLIED_BY, currentChecksum]);
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
    console.log(`\nSummary: ${applied} applied, ${adopted} adopted, ${acceptedChecksums} checksum(s) accepted, ${skipped} skipped, ${files.length} ledger migration file(s) in checkout`);
  } finally {
    await client.end();
  }
  process.exit(exitCode);
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });

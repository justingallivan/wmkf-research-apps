#!/usr/bin/env node
/**
 * check:factory-ledger — compare each configured Factory ledger with the
 * tracked schema fingerprint (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 3;
 * Codex round-1 Fix 6 maps each variable to its target and never prints OK
 * for zero inspected ledgers; Fix 4 applies the approved-ahead rule to EXTRA
 * objects).
 *
 *   node scripts/check-factory-ledger.js [--allow-unreachable]
 *       For each of TEST_REQUEST_LEDGER_URL (target production, database
 *       ledger_prod) and TEST_REQUEST_SANDBOX_LEDGER_URL (target sandbox,
 *       database ledger) that is set: refuse an unregistered URL or a
 *       variable pointed at the wrong database for its target, connect
 *       (retrying 3 times, 5s apart, for managed compute wake-up), read the
 *       structural fingerprint and compare with
 *       lib/db/ledger-schema-fingerprint.json. MISSING or DIFFERING objects
 *       fail (ledger behind the checkout or of a different shape); EXTRA
 *       objects fail unless every one of them is named in
 *       lib/db/ledger-schema-ahead.json's approved-ahead list (a
 *       not-yet-merged migration's known objects), in which case they warn.
 *       Neither variable set → prints "skipped" and exits 0. A ledger still
 *       unreachable after retries fails (exit 1) unless --allow-unreachable
 *       is passed, in which case it prints UNREACHABLE and is counted, not
 *       inspected. The final line always reads
 *       "factory-ledger: N inspected, M unreachable, K skipped" — it never
 *       says OK when N is 0.
 *
 *   node scripts/check-factory-ledger.js --write-expected
 *       Regenerates the tracked JSON: applies the checkout's ledger migration
 *       files to a fresh scratch schema in TEST_REQUEST_LEDGER_TEST_URL (a
 *       local/scratch Postgres, never the shared database), reads the
 *       fingerprint, writes the file, drops the schema. Run it whenever a
 *       ledger migration file changes; the CI test
 *       tests/integration/factory-ledger-fingerprint.pg.test.js fails until
 *       you do.
 *
 * Never prints a connection string.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
  } catch (_) { /* no .env.local */ }
}

/** Env variable name -> the CLI target it is expected to serve (Codex round-1 Fix 6/7). */
const LEDGER_VAR_TARGETS = {
  TEST_REQUEST_LEDGER_URL: 'production',
  TEST_REQUEST_SANDBOX_LEDGER_URL: 'sandbox',
};
const LEDGER_VARS = Object.keys(LEDGER_VAR_TARGETS);

const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Connects with up to CONNECT_ATTEMPTS tries, CONNECT_RETRY_DELAY_MS apart (managed compute wake-up). */
async function connectWithRetry(url) {
  const { Client } = require('pg');
  let lastErr;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      if (attempt < CONNECT_ATTEMPTS) await sleep(CONNECT_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function writeExpected(schemaLib) {
  const url = process.env.TEST_REQUEST_LEDGER_TEST_URL;
  if (!url) throw new Error('--write-expected needs TEST_REQUEST_LEDGER_TEST_URL (a scratch/local Postgres).');
  if (/neon\.tech/i.test(url) || url === process.env.POSTGRES_URL) {
    throw new Error('Refusing to build the expected fingerprint on the shared Production/Preview database.');
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = `ledger_fp_${crypto.randomBytes(4).toString('hex')}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    const files = schemaLib.listLedgerMigrationFiles();
    for (const f of files) await client.query(fs.readFileSync(path.join(schemaLib.LEDGER_MIGRATIONS_DIR, f), 'utf8'));
    const fingerprint = await schemaLib.readLedgerFingerprint(client);
    const out = { generatedFrom: files, fingerprint };
    fs.writeFileSync(schemaLib.LEDGER_FINGERPRINT_PATH, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), schemaLib.LEDGER_FINGERPRINT_PATH)} from ${files.join(', ')}`);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
}

/** @returns {'ok'|'fail'|'unreachable'} */
async function checkOne(name, url, target, schemaLib, registry, expected, approvedAhead) {
  const sharedUrls = ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'DATABASE_URL']
    .map((n) => process.env[n]).filter(Boolean);
  const verdict = registry.classifyLedgerUrl(url, { target, sharedUrls });
  if (!verdict.ok) {
    console.error(`✗ ${name} (target=${target}): refused (${verdict.reason}); see lib/db/ledger-registry.js`);
    return 'fail';
  }
  const database = verdict.effective.database;
  let client;
  try {
    client = await connectWithRetry(url);
  } catch (err) {
    console.warn(`⚠ ${name}: ledger UNREACHABLE after ${CONNECT_ATTEMPTS} attempts (${verdict.label} host, database ${database}): ${err.message}`);
    return 'unreachable';
  }
  try {
    const live = await schemaLib.readLedgerFingerprint(client);
    const diff = schemaLib.compareLedgerFingerprint(expected.fingerprint, live);
    const unapproved = schemaLib.unapprovedExtras(diff, approvedAhead);
    const head = `${name}: ${verdict.label} host, database ${database}, expected from ${expected.generatedFrom.join(', ')}`;
    if (diff.ok && unapproved.length === 0) {
      console.log(`✓ ${head}${diff.extra.length > 0 ? ' — matches (extra objects all approved-ahead)' : ' — matches'}`);
      return 'ok';
    }
    console.log(`✗ ${head}`);
    console.log(schemaLib.formatLedgerDiff(diff));
    if (unapproved.length > 0) console.log(`  unapproved extra objects (not in lib/db/ledger-schema-ahead.json): ${unapproved.join(', ')}`);
    return 'fail';
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvLocal();
  const schemaLib = await import('../lib/db/ledger-schema.js');
  if (process.argv.includes('--write-expected')) { await writeExpected(schemaLib); return; }
  const allowUnreachable = process.argv.includes('--allow-unreachable');
  const registry = await import('../lib/db/ledger-registry.js');
  const configured = LEDGER_VARS.filter((v) => process.env[v]);
  const skipped = LEDGER_VARS.length - configured.length;
  if (configured.length === 0) {
    console.log('factory-ledger: skipped (neither TEST_REQUEST_LEDGER_URL nor TEST_REQUEST_SANDBOX_LEDGER_URL is set)');
    return;
  }
  const expected = schemaLib.readExpectedFingerprint();
  const approvedAhead = schemaLib.readApprovedAhead();
  let inspected = 0;
  let unreachable = 0;
  let failed = false;
  for (const name of configured) {
    const target = LEDGER_VAR_TARGETS[name];
    const result = await checkOne(name, process.env[name], target, schemaLib, registry, expected, approvedAhead);
    if (result === 'unreachable') {
      unreachable += 1;
      if (!allowUnreachable) failed = true;
    } else {
      inspected += 1;
      if (result === 'fail') failed = true;
    }
  }
  console.log(`factory-ledger: ${inspected} inspected, ${unreachable} unreachable, ${skipped} skipped`);
  if (failed) {
    console.error(`factory-ledger FAILED. To rebuild the expectation after a migration change: ${schemaLib.REGENERATE_COMMAND}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });

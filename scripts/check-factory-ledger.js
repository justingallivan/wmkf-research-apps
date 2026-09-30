#!/usr/bin/env node
/**
 * check:factory-ledger — compare each configured Factory ledger with the
 * tracked schema fingerprint (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 3).
 *
 *   node scripts/check-factory-ledger.js
 *       For each of TEST_REQUEST_LEDGER_URL and TEST_REQUEST_SANDBOX_LEDGER_URL
 *       that is set: refuse an unregistered URL, connect, read the structural
 *       fingerprint and compare with lib/db/ledger-schema-fingerprint.json.
 *       MISSING or DIFFERING objects fail (ledger behind the checkout or of a
 *       different shape); EXTRA objects only warn (ledger ahead of the
 *       checkout, e.g. a migration from an unmerged branch).
 *       Neither variable set → prints "skipped" and exits 0.
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

const LEDGER_VARS = ['TEST_REQUEST_LEDGER_URL', 'TEST_REQUEST_SANDBOX_LEDGER_URL'];

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

async function checkOne(name, url, schemaLib, registry, expected) {
  const sharedUrls = ['POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'DATABASE_URL']
    .map((n) => process.env[n]).filter(Boolean);
  const verdict = registry.classifyLedgerUrl(url, { sharedUrls });
  if (!verdict.ok) {
    console.error(`✗ ${name}: refused (${verdict.reason}); see lib/db/ledger-registry.js`);
    return false;
  }
  const database = new URL(url).pathname.replace(/^\//, '');
  const { Client } = require('pg');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
  } catch (err) {
    console.error(`✗ ${name}: ledger unreachable (${verdict.label} host, database ${database}): ${err.message}`);
    return false;
  }
  try {
    const live = await schemaLib.readLedgerFingerprint(client);
    const diff = schemaLib.compareLedgerFingerprint(expected.fingerprint, live);
    const head = `${name}: ${verdict.label} host, database ${database}, expected from ${expected.generatedFrom.join(', ')}`;
    if (diff.ok && diff.extra.length === 0) { console.log(`✓ ${head} — matches`); return true; }
    console.log(`${diff.ok ? '⚠' : '✗'} ${head}`);
    console.log(schemaLib.formatLedgerDiff(diff));
    if (diff.ok) console.log('  (extra objects only: this ledger is ahead of the checkout; not a failure)');
    return diff.ok;
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnvLocal();
  const schemaLib = await import('../lib/db/ledger-schema.js');
  if (process.argv.includes('--write-expected')) { await writeExpected(schemaLib); return; }
  const registry = await import('../lib/db/ledger-registry.js');
  const configured = LEDGER_VARS.filter((v) => process.env[v]);
  if (configured.length === 0) {
    console.log('factory-ledger: skipped (neither TEST_REQUEST_LEDGER_URL nor TEST_REQUEST_SANDBOX_LEDGER_URL is set)');
    return;
  }
  const expected = schemaLib.readExpectedFingerprint();
  let ok = true;
  for (const name of configured) ok = (await checkOne(name, process.env[name], schemaLib, registry, expected)) && ok;
  if (!ok) { console.error(`factory-ledger FAILED. To rebuild the expectation after a migration change: ${schemaLib.REGENERATE_COMMAND}`); process.exit(1); }
  console.log('factory-ledger OK');
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });

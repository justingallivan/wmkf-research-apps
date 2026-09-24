'use strict';

/**
 * Jest globalSetup for the pg-contract lane (jest.pg-contract.config.js).
 *
 * Per plan §5 Stage 0 item 3: when PG_CONTRACT_URL is unset, print the
 * skip line and return (exit 0) — the lane must never fail CI for lack of
 * a database. Each test file also skips itself on the same env var, so no
 * assertion runs and no additional connection is attempted.
 *
 * When set, brings the named database from empty to a stamped, fully
 * migrated schema, mirroring what a fresh install + migration run should
 * leave behind (Q3):
 *   (i)   drop/recreate the public schema so setup-database.js sees an
 *         empty database (it refuses populated databases by design).
 *   (ii)  run setup-database.js unmodified, via the child-process preload
 *         that redirects its `@vercel/postgres` require to the pg shim.
 *   (iii) stamp one schema_migrations row per lib/db/migrations-manifest.json
 *         filename (setup-database.js writes none itself, and
 *         apply-migrations.js's migration 007 is documented not re-runnable
 *         — see plan §3 Q3), using apply-migrations.js's own tracker DDL.
 *   (iv)  run apply-migrations.js and assert it reports 0 applied/pending.
 *
 * Never point this at POSTGRES_URL/Vercel/Neon — only at PG_CONTRACT_URL,
 * a disposable local container. `assertLocalHost` enforces that: before any
 * connection is opened, the URL's hostname must be localhost/127.0.0.1/
 * [::1] (no override exists). This is on top of,
 * not instead of, the shim reading PG_CONTRACT_URL exclusively (never
 * POSTGRES_URL) — see vercel-postgres-pg-shim.js.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRELOAD_PATH = path.join(__dirname, 'setup-database-preload.js');
const MANIFEST_PATH = path.join(REPO_ROOT, 'lib', 'db', 'migrations-manifest.json');

const ALLOWED_LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Pure predicate, no env reads — the part the self-check exercises directly. */
function isLocalHost(hostname) {
  return ALLOWED_LOCAL_HOSTNAMES.has(hostname);
}

/**
 * Refuse to run destructive setup (DROP SCHEMA, setup-database.js,
 * apply-migrations.js) against anything but a local disposable container.
 * `PG_CONTRACT_URL` is meant to always be that; this guard exists because
 * a typo'd or copy-pasted URL pointing at a real host must not silently
 * run schema-dropping code against it.
 *
 * There is deliberately NO override. Owner decision Q1 puts the contract
 * database in a CI service container or a local Docker container, both
 * reachable as loopback; a remote database is never a legitimate target for
 * DROP SCHEMA public CASCADE. (A Codex adversarial review, S536, showed that
 * an env-var override would let a stale CI variable or a mistyped URL erase
 * a non-local database with no further check, so the earlier
 * PG_CONTRACT_ALLOW_REMOTE escape hatch was removed.)
 */
function assertLocalHost(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`pg-contract global-setup: PG_CONTRACT_URL is not a valid URL (${err.message})`);
  }
  if (!isLocalHost(parsed.hostname)) {
    throw new Error(
      `pg-contract global-setup: refusing to run destructive setup against host "${parsed.hostname}" ` +
        `— PG_CONTRACT_URL must point at localhost/127.0.0.1/[::1]. There is no override.`
    );
  }
}

// Self-check of the guard, always run (regardless of PG_CONTRACT_URL), so a
// change here that breaks the allow-list is caught even in the skip path.
(function selfCheckAssertLocalHost() {
  let threw = false;
  try {
    assertLocalHost('postgresql://user:pass@evil.example.com:5432/db');
  } catch (_) {
    threw = true;
  }
  if (!threw) {
    throw new Error('pg-contract global-setup: assertLocalHost self-check failed — it must reject a remote host');
  }
  assertLocalHost('postgresql://user:pass@127.0.0.1:55432/wmkf_contract'); // must not throw
})();

async function globalSetup() {
  const url = process.env.PG_CONTRACT_URL;
  if (!url) {
    console.log('pg-contract: skipped (no PG_CONTRACT_URL)');
    return;
  }
  assertLocalHost(url);

  // (i) reset to an empty database
  const reset = new Client({ connectionString: url });
  try {
    await reset.connect();
    await reset.query('DROP SCHEMA public CASCADE');
    await reset.query('CREATE SCHEMA public');
  } finally {
    await reset.end();
  }

  // (ii) run setup-database.js unmodified against the empty database. Only
  // PG_CONTRACT_URL is set here — the shim (loaded by the preload) reads
  // PG_CONTRACT_URL exclusively, never POSTGRES_URL, so no POSTGRES_URL is
  // passed to this child. NODE_OPTIONS is appended to, not replaced, so an
  // inherited value from the environment survives.
  const inheritedNodeOptions = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';
  const setupResult = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'setup-database.js')],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `${inheritedNodeOptions}--require ${PRELOAD_PATH}`,
      },
    }
  );
  if (setupResult.status !== 0) {
    throw new Error(
      `pg-contract globalSetup: setup-database.js exited ${setupResult.status}\n` +
        `--- stdout ---\n${setupResult.stdout}\n--- stderr ---\n${setupResult.stderr}`
    );
  }

  // (iii) stamp schema_migrations — exact DDL from scripts/apply-migrations.js ensureTracker()
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const stamp = new Client({ connectionString: url });
  await stamp.connect();
  try {
    await stamp.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name         TEXT PRIMARY KEY,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_by   TEXT
      )
    `);
    for (const name of manifest.files) {
      await stamp.query(
        'INSERT INTO schema_migrations (name, applied_by) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [name, 'pg-contract-harness']
      );
    }
  } finally {
    await stamp.end();
  }

  // (iv) apply-migrations.js should now report 0 pending
  const applyResult = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'apply-migrations.js')],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, POSTGRES_URL: url },
    }
  );
  if (applyResult.status !== 0) {
    throw new Error(
      `pg-contract globalSetup: apply-migrations.js exited ${applyResult.status}\n` +
        `--- stdout ---\n${applyResult.stdout}\n--- stderr ---\n${applyResult.stderr}`
    );
  }
  const summary = applyResult.stdout.match(/Summary: (\d+) applied, (\d+) skipped, (\d+) total/);
  if (!summary || Number(summary[1]) !== 0) {
    throw new Error(
      `pg-contract globalSetup: apply-migrations.js reported pending migrations:\n${applyResult.stdout}`
    );
  }
}

module.exports = globalSetup;
module.exports.assertLocalHost = assertLocalHost;
module.exports.isLocalHost = isLocalHost;

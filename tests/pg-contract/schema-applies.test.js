'use strict';

/**
 * Contract test for tests/pg-contract/support/global-setup.js steps
 * (i)-(iv): proves the pg-contract lane itself works before any store test
 * relies on it. Skips (not fails) when PG_CONTRACT_URL is unset — see plan
 * §5 Stage 0 item 3.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const PG_CONTRACT_URL = process.env.PG_CONTRACT_URL;
const describeIfDb = PG_CONTRACT_URL ? describe : describe.skip;

const REPO_ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'lib', 'db', 'migrations');
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'lib', 'db', 'migrations-manifest.json'), 'utf8')
);

// Inlined from tests/unit/postgres-schema-parity.test.js (that test exports
// nothing; it is source-text-only and cannot see whether runMigration()
// actually executes a given CREATE TABLE string, e.g. one sitting in a dead
// array literal). This is the runtime counterpart: same end-state-table
// extraction, checked against the real database instead of source text.
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
function normalizeIdentifier(raw) {
  return raw.replace(/"/g, '').trim().split('.').pop().toLowerCase();
}
function extractTableNames(sql, verb) {
  const names = new Set();
  const re =
    verb === 'CREATE'
      ? /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/gi
      : /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+?)(?:;|$)/gim;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const raw = match[1];
    if (verb === 'CREATE') {
      names.add(normalizeIdentifier(raw));
    } else {
      raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => names.add(normalizeIdentifier(s)));
    }
  }
  return names;
}
function endStateMigrationTables() {
  const created = new Set();
  const dropped = new Set();
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    extractTableNames(sql, 'CREATE').forEach((t) => created.add(t));
    extractTableNames(sql, 'DROP').forEach((t) => dropped.add(t));
  }
  return [...created].filter((t) => !dropped.has(t)).sort();
}

describeIfDb('pg-contract harness: schema-applies', () => {
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_CONTRACT_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  test('schema_migrations has exactly one stamped row per manifest filename', async () => {
    const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    const stamped = rows.map((r) => r.name).sort();
    expect(stamped).toEqual([...MANIFEST.files].sort());
  });

  test('apply-migrations.js reports 0 pending against the stamped schema', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'apply-migrations.js')],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, POSTGRES_URL: PG_CONTRACT_URL },
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Summary: 0 applied, \d+ skipped, \d+ total/);
  });

  test('a handful of expected fresh-install tables exist', async () => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`
    );
    const tables = new Set(rows.map((r) => r.tablename));
    expect(tables.has('user_profiles')).toBe(true);
    expect(tables.has('site_visit_material_collections')).toBe(true);
  });

  // Originally written expecting reviewer_find_roster to be absent (per the
  // brief this test was drafted from, describing it as migration-only and
  // "will NOT exist until Q3 lands"). Correction: it is NOT committed at
  // HEAD — `git show HEAD:scripts/setup-database.js` has no
  // reviewer_find_roster. What made these tables visible in the local
  // contract run is the orchestrator's UNCOMMITTED working-tree diff to
  // scripts/setup-database.js (V55-V59, +204 lines), which lands in the
  // same commit as tests/unit/postgres-schema-parity.test.js's KNOWN_GAPS
  // going to `[]`. This test therefore depends on that working-tree state,
  // not on any landed commit. global-setup.js stamps every manifest
  // filename before running apply-migrations.js (so migration bodies never
  // execute), so all five assertions below exercise setup-database.js's own
  // fresh-install shape.
  test('the five Q3 parity tables (V55-V59 working-tree blocks) exist', async () => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`
    );
    const tables = new Set(rows.map((r) => r.tablename));
    for (const name of [
      'bill_webhook_events',
      'bill_onboarding_state',
      'reviewer_find_roster',
      'review_drafts',
      'review_question_audit',
    ]) {
      expect(tables.has(name)).toBe(true);
    }
  });

  test('every end-state migration table (source-parsed) actually exists in the fresh database', async () => {
    const expected = endStateMigrationTables();
    console.log(`pg-contract: checking ${expected.length} end-state migration table names against information_schema`);
    expect(expected.length).toBe(43);

    const { rows } = await client.query(
      // BASE TABLE only: information_schema.tables also lists views and
      // foreign tables, and a view wearing a migration table's name must not
      // satisfy this check (Codex adversarial review, S536).
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const actual = new Set(rows.map((r) => r.table_name));
    const missing = expected.filter((t) => !actual.has(t));
    expect(missing).toEqual([]);
  });
});

if (!PG_CONTRACT_URL) {
  test('pg-contract skipped (no PG_CONTRACT_URL)', () => {
    expect(true).toBe(true);
  });
}

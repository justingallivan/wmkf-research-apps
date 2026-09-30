/**
 * Test Request Factory ledger schema fingerprint
 * (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 3).
 *
 * The ledger's migrations (every lib/db/migrations file whose name contains
 * `test_request`) were edited in place and applied by hand for months, so a
 * ledger's real shape could drift from the files silently. This module reads
 * a STRUCTURAL fingerprint of a live ledger (table columns with their types
 * and nullability, constraint names and kinds, index names, function
 * signatures) and compares it with the tracked expectation in
 * lib/db/ledger-schema-fingerprint.json, which
 * tests/integration/factory-ledger-fingerprint.pg.test.js proves equal to
 * "the migration files applied to an empty database".
 *
 * Structural on purpose: definition text (pg_get_constraintdef, indexdef,
 * pg_get_functiondef) differs across Postgres majors (CI 16, Neon 18) and
 * embeds schema names; names and types do not. NOT NULL constraints are
 * excluded (Postgres 18 lists them in pg_constraint as contype 'n', 16 does
 * not); nullability is read from the columns instead.
 *
 * Every catalog query filters on current_schema(), so the same code reads a
 * scratch schema in tests and `public` on a real ledger.
 */

import fs from 'node:fs';
import path from 'node:path';

export const LEDGER_MIGRATIONS_DIR = path.join(process.cwd(), 'lib/db/migrations');
export const LEDGER_FINGERPRINT_PATH = path.join(process.cwd(), 'lib/db/ledger-schema-fingerprint.json');
export const LEDGER_TRACKER_TABLE = 'ledger_schema_migrations';
export const REGENERATE_COMMAND = 'TEST_REQUEST_LEDGER_TEST_URL=<scratch postgres> node scripts/check-factory-ledger.js --write-expected';

/** Ledger migration filenames in the checkout, ascending. */
export function listLedgerMigrationFiles(dir = LEDGER_MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => /\.sql$/i.test(f) && /test_request/i.test(f))
    .sort();
}

/**
 * Reads the structural fingerprint through any `{ query(text, params) -> { rows } }`.
 * Only objects named `test_request_*` (and the receipt function) are read; the
 * tracker table and unrelated objects are ignored.
 */
export async function readLedgerFingerprint(db) {
  const columns = await db.query(`
    SELECT table_name, column_name, udt_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name LIKE 'test_request_%'
     ORDER BY table_name, ordinal_position`);
  const constraints = await db.query(`
    SELECT c.conrelid::regclass::text AS table_name, c.conname, c.contype
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = current_schema()
       AND c.conrelid::regclass::text LIKE '%test_request_%'
       AND c.contype <> 'n'
     ORDER BY 1, 2`);
  const indexes = await db.query(`
    SELECT tablename AS table_name, indexname
      FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename LIKE 'test_request_%'
     ORDER BY 1, 2`);
  const functions = await db.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = current_schema()
       AND p.proname LIKE 'test_request_%'
     ORDER BY 1, 2`);

  const tables = {};
  const table = (name) => {
    const bare = String(name).replace(/^[^.]+\./, '').replace(/"/g, '');
    if (!tables[bare]) tables[bare] = { columns: [], constraints: [], indexes: [] };
    return tables[bare];
  };
  for (const r of columns.rows) table(r.table_name).columns.push({ name: r.column_name, type: r.udt_name, nullable: r.is_nullable === 'YES' });
  for (const r of constraints.rows) table(r.table_name).constraints.push({ name: r.conname, type: r.contype });
  for (const r of indexes.rows) table(r.table_name).indexes.push(r.indexname);
  for (const t of Object.values(tables)) {
    t.constraints.sort((a, b) => a.name.localeCompare(b.name));
    t.indexes.sort();
  }
  return {
    tables: Object.fromEntries(Object.keys(tables).sort().map((k) => [k, tables[k]])),
    functions: functions.rows.map((r) => `${r.proname}(${r.args})`).sort(),
  };
}

/**
 * Compares an expected fingerprint (tracked JSON) with a live one.
 *  - missing: in expected, not in live (a ledger BEHIND the checkout) → fail;
 *  - differing: same object, different type/nullability/kind → fail;
 *  - extra: in live, not in expected (a ledger AHEAD of the checkout, e.g. a
 *    migration from an unmerged branch) → warn.
 */
export function compareLedgerFingerprint(expected, live) {
  const missing = [];
  const differing = [];
  const extra = [];
  const expTables = expected?.tables || {};
  const liveTables = live?.tables || {};
  for (const [name, exp] of Object.entries(expTables)) {
    const act = liveTables[name];
    if (!act) { missing.push(`table ${name}`); continue; }
    const actCols = new Map(act.columns.map((c) => [c.name, c]));
    for (const col of exp.columns) {
      const a = actCols.get(col.name);
      if (!a) missing.push(`column ${name}.${col.name}`);
      else if (a.type !== col.type || a.nullable !== col.nullable) differing.push(`column ${name}.${col.name} (${col.type}${col.nullable ? '' : ' not null'} → ${a.type}${a.nullable ? '' : ' not null'})`);
    }
    for (const c of act.columns) if (!exp.columns.some((e) => e.name === c.name)) extra.push(`column ${name}.${c.name}`);
    const actCons = new Map(act.constraints.map((c) => [c.name, c]));
    for (const con of exp.constraints) {
      const a = actCons.get(con.name);
      if (!a) missing.push(`constraint ${name}.${con.name}`);
      else if (a.type !== con.type) differing.push(`constraint ${name}.${con.name} (${con.type} → ${a.type})`);
    }
    for (const c of act.constraints) if (!exp.constraints.some((e) => e.name === c.name)) extra.push(`constraint ${name}.${c.name}`);
    for (const i of exp.indexes) if (!act.indexes.includes(i)) missing.push(`index ${name}.${i}`);
    for (const i of act.indexes) if (!exp.indexes.includes(i)) extra.push(`index ${name}.${i}`);
  }
  for (const name of Object.keys(liveTables)) if (!expTables[name]) extra.push(`table ${name}`);
  const expFns = expected?.functions || [];
  const liveFns = live?.functions || [];
  for (const f of expFns) if (!liveFns.includes(f)) missing.push(`function ${f}`);
  for (const f of liveFns) if (!expFns.includes(f)) extra.push(`function ${f}`);
  return { missing, differing, extra, ok: missing.length === 0 && differing.length === 0 };
}

export function formatLedgerDiff(diff) {
  const lines = [];
  for (const m of diff.missing) lines.push(`  MISSING   ${m}`);
  for (const d of diff.differing) lines.push(`  DIFFERS   ${d}`);
  for (const e of diff.extra) lines.push(`  extra     ${e}`);
  return lines.join('\n');
}

export function readExpectedFingerprint(file = LEDGER_FINGERPRINT_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

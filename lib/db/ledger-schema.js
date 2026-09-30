/**
 * Test Request Factory ledger schema fingerprint
 * (docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md, Phase 3;
 * Codex round-1 Fix 2 extends this to a SEMANTIC fingerprint).
 *
 * The ledger's migrations (every lib/db/migrations file whose name contains
 * `test_request`) were edited in place and applied by hand for months, so a
 * ledger's real shape could drift from the files silently. This module reads
 * a fingerprint of a live ledger — table columns (name, type, nullability,
 * default expression), constraint definitions, index definitions (with
 * uniqueness/primary flags), triggers, and function signatures/bodies — and
 * compares it with the tracked expectation in
 * lib/db/ledger-schema-fingerprint.json, which
 * tests/integration/factory-ledger-fingerprint.pg.test.js proves equal to
 * "the migration files applied to an empty database".
 *
 * Definition text (pg_get_constraintdef, pg_get_indexdef, pg_get_triggerdef,
 * format_type, function bodies) can differ cosmetically across Postgres
 * majors (CI/local 16, Neon 18) and embeds schema-qualification. Every such
 * string is passed through ONE canonicalization function,
 * canonicalizeDefinition, before comparison or hashing, so the fingerprint
 * stays semantic rather than textual. NOT NULL constraints are excluded from
 * the constraints list (Postgres 18 lists them in pg_constraint as contype
 * 'n', 16 does not); nullability is read from the columns instead.
 *
 * Every catalog query filters on current_schema(), so the same code reads a
 * scratch schema in tests and `public` on a real ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LEDGER_MIGRATIONS_DIR = path.join(process.cwd(), 'lib/db/migrations');
export const LEDGER_FINGERPRINT_PATH = path.join(process.cwd(), 'lib/db/ledger-schema-fingerprint.json');
export const LEDGER_AHEAD_PATH = path.join(process.cwd(), 'lib/db/ledger-schema-ahead.json');
export const LEDGER_TRACKER_TABLE = 'ledger_schema_migrations';
export const REGENERATE_COMMAND = 'TEST_REQUEST_LEDGER_TEST_URL=<scratch postgres> node scripts/check-factory-ledger.js --write-expected';

/** Ledger migration filenames in the checkout, ascending. */
export function listLedgerMigrationFiles(dir = LEDGER_MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => /\.sql$/i.test(f) && /test_request/i.test(f))
    .sort();
}

/**
 * Removes the current schema's own qualification from a catalog-printed
 * definition (`"ledger_fp_ab12".` or `ledger_fp_ab12.`) and collapses
 * whitespace. Does NOT lowercase: case is part of the semantics (identifiers,
 * string literals). One function, used for every definition string and for
 * function bodies before hashing, so Postgres-major cosmetic differences
 * (quoting, whitespace, schema-qualification) are normalized the same way
 * everywhere.
 */
export function canonicalizeDefinition(text, schemaName) {
  if (text === null || text === undefined) return null;
  let s = String(text);
  const schema = String(schemaName || '');
  if (schema) {
    s = s.split(`"${schema}".`).join('');
    s = s.split(`${schema}.`).join('');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function bareTableName(name) {
  return String(name).replace(/^[^.]+\./, '').replace(/"/g, '');
}

/**
 * Reads the fingerprint through any `{ query(text, params) -> { rows } }`.
 * Only objects named `test_request_*` (and the receipt function) are read;
 * the tracker table and unrelated objects are ignored.
 */
export async function readLedgerFingerprint(db) {
  const schemaRow = await db.query('SELECT current_schema() AS schema');
  const schema = schemaRow.rows[0].schema;

  const columns = await db.query(`
    SELECT c.relname AS table_name, a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS type,
           NOT a.attnotnull AS nullable,
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE n.nspname = current_schema()
       AND c.relkind IN ('r', 'p')
       AND c.relname LIKE 'test_request_%'
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`);
  const constraints = await db.query(`
    SELECT c.conrelid::regclass::text AS table_name, c.conname, c.contype,
           pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = current_schema()
       AND c.conrelid::regclass::text LIKE '%test_request_%'
       AND c.contype <> 'n'
     ORDER BY 1, 2`);
  const indexes = await db.query(`
    SELECT t.relname AS table_name, ic.relname AS indexname,
           ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
           pg_get_indexdef(ix.indexrelid) AS definition
      FROM pg_index ix
      JOIN pg_class ic ON ic.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema()
       AND t.relname LIKE 'test_request_%'
     ORDER BY 1, 2`);
  const triggers = await db.query(`
    SELECT c.relname AS table_name, tg.tgname,
           pg_get_triggerdef(tg.oid) AS definition
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema()
       AND c.relname LIKE 'test_request_%'
       AND NOT tg.tgisinternal
     ORDER BY 1, 2`);
  const functions = await db.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS return_type,
           l.lanname AS language, p.provolatile, p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = current_schema()
       AND p.proname LIKE 'test_request_%'
     ORDER BY 1, 2`);

  const tables = {};
  const table = (name) => {
    const bare = bareTableName(name);
    if (!tables[bare]) tables[bare] = { columns: [], constraints: [], indexes: [], triggers: [] };
    return tables[bare];
  };
  for (const r of columns.rows) {
    table(r.table_name).columns.push({
      name: r.column_name,
      type: canonicalizeDefinition(r.type, schema),
      nullable: r.nullable,
      default: canonicalizeDefinition(r.default_expr, schema),
    });
  }
  for (const r of constraints.rows) {
    table(r.table_name).constraints.push({
      name: r.conname,
      type: r.contype,
      definition: canonicalizeDefinition(r.definition, schema),
    });
  }
  for (const r of indexes.rows) {
    table(r.table_name).indexes.push({
      name: r.indexname,
      unique: r.is_unique,
      primary: r.is_primary,
      definition: canonicalizeDefinition(r.definition, schema),
    });
  }
  for (const r of triggers.rows) {
    table(r.table_name).triggers.push({
      name: r.tgname,
      definition: canonicalizeDefinition(r.definition, schema),
    });
  }
  for (const t of Object.values(tables)) {
    t.constraints.sort((a, b) => a.name.localeCompare(b.name));
    t.indexes.sort((a, b) => a.name.localeCompare(b.name));
    t.triggers.sort((a, b) => a.name.localeCompare(b.name));
  }

  const functionList = functions.rows.map((r) => {
    const body = canonicalizeDefinition(r.prosrc, schema);
    return {
      signature: `${r.proname}(${r.args})`,
      returnType: canonicalizeDefinition(r.return_type, schema),
      language: r.language,
      volatile: r.provolatile,
      bodyHash: crypto.createHash('sha256').update(body || '').digest('hex'),
    };
  }).sort((a, b) => a.signature.localeCompare(b.signature));

  return {
    tables: Object.fromEntries(Object.keys(tables).sort().map((k) => [k, tables[k]])),
    functions: functionList,
  };
}

function diffNamedList(kind, tableName, expList, liveList, missing, differing, extra, describe) {
  const liveMap = new Map(liveList.map((o) => [o.name, o]));
  for (const exp of expList) {
    const act = liveMap.get(exp.name);
    const label = `${kind} ${tableName}.${exp.name}`;
    if (!act) { missing.push(label); continue; }
    const d = describe(exp, act);
    if (d) differing.push(`${label} (${d})`);
  }
  const expNames = new Set(expList.map((o) => o.name));
  for (const act of liveList) if (!expNames.has(act.name)) extra.push(`${kind} ${tableName}.${act.name}`);
}

/**
 * Compares an expected fingerprint (tracked JSON) with a live one.
 *  - missing: in expected, not in live (a ledger BEHIND the checkout) → fail;
 *  - differing: same object, different shape/definition/body → fail;
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

    diffNamedList('column', name, exp.columns, act.columns, missing, differing, extra, (e, a) => {
      if (e.type !== a.type || e.nullable !== a.nullable || (e.default || null) !== (a.default || null)) {
        const fmt = (c) => `${c.type}${c.nullable ? '' : ' not null'}${c.default ? ` default ${c.default}` : ''}`;
        return `${fmt(e)} → ${fmt(a)}`;
      }
      return null;
    });

    diffNamedList('constraint', name, exp.constraints, act.constraints, missing, differing, extra, (e, a) => {
      if (e.type !== a.type || e.definition !== a.definition) return `${e.type}:${e.definition} → ${a.type}:${a.definition}`;
      return null;
    });

    diffNamedList('index', name, exp.indexes, act.indexes, missing, differing, extra, (e, a) => {
      if (e.unique !== a.unique || e.primary !== a.primary || e.definition !== a.definition) {
        const fmt = (i) => `${i.unique ? 'unique ' : ''}${i.primary ? 'primary ' : ''}${i.definition}`;
        return `${fmt(e)} → ${fmt(a)}`;
      }
      return null;
    });

    diffNamedList('trigger', name, exp.triggers || [], act.triggers || [], missing, differing, extra, (e, a) => {
      if (e.definition !== a.definition) return `${e.definition} → ${a.definition}`;
      return null;
    });
  }
  for (const name of Object.keys(liveTables)) if (!expTables[name]) extra.push(`table ${name}`);

  const expFns = expected?.functions || [];
  const liveFns = live?.functions || [];
  const liveFnMap = new Map(liveFns.map((f) => [f.signature, f]));
  for (const exp of expFns) {
    const act = liveFnMap.get(exp.signature);
    if (!act) { missing.push(`function ${exp.signature}`); continue; }
    if (exp.returnType !== act.returnType || exp.language !== act.language
      || exp.volatile !== act.volatile || exp.bodyHash !== act.bodyHash) {
      differing.push(`function ${exp.signature} (${exp.returnType} ${exp.language} ${exp.volatile} ${exp.bodyHash.slice(0, 8)} → ${act.returnType} ${act.language} ${act.volatile} ${act.bodyHash.slice(0, 8)})`);
    }
  }
  const expFnSigs = new Set(expFns.map((f) => f.signature));
  for (const act of liveFns) if (!expFnSigs.has(act.signature)) extra.push(`function ${act.signature}`);

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

/**
 * The approved-ahead list (Codex round-1 Fix 4; Opus round-1 item 6 makes a
 * table entry SHAPE-verified, not name-only): each entry is
 * `{ migration, tables?: { <tableName>: <fingerprint object exactly as
 * readLedgerFingerprint produces it> }, objects?: string[] }`. A `tables`
 * entry's fingerprint is what a not-yet-merged migration is known to
 * introduce (derived by applying it into a scratch schema and reading the
 * fingerprint, never by hand); `objects` is a legacy name-only escape hatch
 * for non-table extras. Extras not covered here are never assumed safe.
 */
export function readApprovedAhead(file = LEDGER_AHEAD_PATH) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.approvedAhead || [];
  } catch {
    return [];
  }
}

/**
 * Every entry in diff.extra that is NOT covered by the approved-ahead list.
 *
 * An extra `table X` is covered only if some approved entry's `tables[X]`
 * compares clean (no missing, no differing — `extra` within that
 * sub-comparison is tolerated, since the approved shape is a known-minimum,
 * not a byte-for-byte ceiling) against `liveFingerprint.tables[X]`. A
 * name-only match with a different shape is NOT approved — this is what
 * Codex's original recommendation ("extras must exactly match an approved
 * fingerprint") asked for, replacing the earlier name-only rule.
 *
 * Every other extra kind (column/constraint/index/trigger/function) is
 * covered only by the legacy `objects` name list, since
 * compareLedgerFingerprint only ever emits `table X` for a wholly new
 * table — never its children — so a real approved-ahead migration that adds
 * only new tables needs no `objects` entries at all.
 *
 * `liveFingerprint` is required to verify a table's shape; if it is omitted,
 * a `table X` extra is treated as unapproved (fail closed) even if a shape
 * entry exists for it.
 */
export function unapprovedExtras(diff, approvedAhead, liveFingerprint = null) {
  const shapeByTable = new Map();
  const approvedObjectNames = new Set();
  for (const entry of approvedAhead || []) {
    for (const [tableName, shape] of Object.entries(entry.tables || {})) shapeByTable.set(tableName, shape);
    for (const o of entry.objects || []) approvedObjectNames.add(o);
  }
  return (diff.extra || []).filter((e) => {
    const tableMatch = /^table (.+)$/.exec(e);
    if (!tableMatch) return !approvedObjectNames.has(e);
    const tableName = tableMatch[1];
    const approvedShape = shapeByTable.get(tableName);
    if (!approvedShape) return !approvedObjectNames.has(e);
    if (!liveFingerprint) return true;
    const liveShape = liveFingerprint.tables?.[tableName];
    if (!liveShape) return true;
    const shapeDiff = compareLedgerFingerprint({ tables: { [tableName]: approvedShape }, functions: [] }, { tables: { [tableName]: liveShape }, functions: [] });
    return !(shapeDiff.missing.length === 0 && shapeDiff.differing.length === 0);
  });
}

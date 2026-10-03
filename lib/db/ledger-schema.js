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
 * Splits SQL text into a sequence of `{ literal, text }` runs: `literal:
 * true` for a single-quoted string ('' is the only escape Postgres's own
 * pretty-printers use — standard_conforming_strings) or a dollar-quoted
 * block (`$$...$$` / `$tag$...$tag$`), `literal: false` for everything
 * outside those. Used by canonicalizeDefinition so whitespace collapsing
 * and schema-prefix stripping only ever touch code, never literal content
 * (Opus round-2 item 2/Codex #2: the prior version ran both transforms over
 * the whole string, so `CHECK (code = 'A  B')` and `CHECK (code = 'A B')`
 * canonicalized to the same fingerprint, and a schema-like substring inside
 * a string literal was silently stripped as if it were qualification).
 */
function tokenizeSqlLiterals(text) {
  const tokens = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { tokens.push({ literal: false, text: buf }); buf = ''; } };
  while (i < text.length) {
    const ch = text[i];
    // Comments are not semantic: skip them entirely so an apostrophe inside a
    // comment cannot invert literal detection (Opus round-2 low #3).
    if (ch === '-' && text[i + 1] === '-') {
      const eol = text.indexOf('\n', i);
      flush();
      i = eol === -1 ? text.length : eol;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      flush();
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    // Standard ('') and escape-string (E'\'') literals; the E prefix must not
    // be the tail of an identifier.
    const escapePrefix = (ch === 'E' || ch === 'e') && text[i + 1] === "'" && !/[A-Za-z0-9_]/.test(text[i - 1] || '');
    if (ch === "'" || escapePrefix) {
      flush();
      let lit = escapePrefix ? text[i] + "'" : "'";
      let j = escapePrefix ? i + 2 : i + 1;
      while (j < text.length) {
        if (escapePrefix && text[j] === '\\') { lit += text[j] + (text[j + 1] ?? ''); j += 2; continue; }
        if (text[j] === "'") {
          if (text[j + 1] === "'") { lit += "''"; j += 2; continue; }
          lit += "'"; j += 1; break;
        }
        lit += text[j]; j += 1;
      }
      tokens.push({ literal: true, kind: 'string', text: lit });
      i = j;
      continue;
    }
    // Codex round-3 #6: double-quoted identifiers ("" is the only escape)
    // and Unicode-escape identifiers (U&"..."). Whitespace and schema-like
    // substrings inside these must be preserved byte-exact, same as string
    // literals — `"a  b"` and `"a b"` are different identifiers, and
    // `"public.foo"` is one identifier, not schema `public` qualifying `foo`.
    const unicodeIdentifierPrefix = (ch === 'U' || ch === 'u') && text[i + 1] === '&' && text[i + 2] === '"';
    if (ch === '"' || unicodeIdentifierPrefix) {
      flush();
      const start = i;
      let j = unicodeIdentifierPrefix ? i + 3 : i + 1;
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { j += 2; continue; }
          j += 1; break;
        }
        j += 1;
      }
      tokens.push({ literal: true, kind: 'identifier', text: text.slice(start, j) });
      i = j;
      continue;
    }
    if (ch === '$') {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = text.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          flush();
          tokens.push({ literal: true, kind: 'dollar', text: text.slice(i, closeIdx + tag.length) });
          i = closeIdx + tag.length;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return tokens;
}

/**
 * Removes the current schema's own qualification from a catalog-printed
 * definition (`"ledger_fp_ab12".` or `ledger_fp_ab12.`) and collapses
 * whitespace — OUTSIDE single-quoted string literals and dollar-quoted
 * blocks only, via tokenizeSqlLiterals; literal content is preserved
 * byte-exact. Does NOT lowercase: case is part of the semantics
 * (identifiers, string literals). One function, used for every definition
 * string and for function bodies before hashing, so Postgres-major cosmetic
 * differences (quoting, whitespace, schema-qualification) are normalized
 * the same way everywhere — without ever merging two semantically
 * different literal values.
 */
export function canonicalizeDefinition(text, schemaName) {
  if (text === null || text === undefined) return null;
  const s = String(text);
  const schema = String(schemaName || '');
  const quotedSchema = `"${schema}"`;
  const tokens = tokenizeSqlLiterals(s);
  const parts = [];
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const t = tokens[idx];
    if (t.literal) {
      // Codex round-3 #6: strip a quoted schema-qualification ONLY when the
      // token is EXACTLY `"<schema>"` (not a longer identifier that merely
      // contains the schema name, e.g. "public.foo") and is immediately
      // followed by a `.` — mirrors the bare `schema.` stripping below, but
      // only ever touches a parsed identifier token, never literal content.
      if (schema && t.kind === 'identifier' && t.text === quotedSchema) {
        const next = tokens[idx + 1];
        if (next && !next.literal && next.text.startsWith('.')) {
          tokens[idx + 1] = { ...next, text: next.text.slice(1) };
          continue;
        }
      }
      parts.push(t.text);
      continue;
    }
    let seg = t.text;
    if (schema) {
      // Opus round-3 L6: strip `<schema>.` only at an identifier boundary —
      // preceded by start-of-segment or a non-identifier character — never
      // as a stray substring match inside a longer identifier. A plain
      // `.split(schema + '.').join('')` stripped `public.` out of
      // `xpublic.a` too, silently corrupting an unrelated identifier that
      // merely ENDS with the schema name.
      const escapedSchema = schema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      seg = seg.replace(new RegExp(`(^|[^A-Za-z0-9_])${escapedSchema}\\.`, 'g'), '$1');
    }
    parts.push(seg.replace(/\s+/g, ' '));
  }
  return parts.join('').trim();
}

/**
 * node-postgres has no default type parser for `name[]` (pg_policies.roles'
 * type), so it comes back as the raw Postgres array-literal text (e.g.
 * `{public}`), not a JS array. Minimal parser for that shape — role names
 * never need embedded-comma/brace escaping in practice.
 */
function parsePgNameArray(text) {
  if (!text) return [];
  const inner = String(text).replace(/^\{/, '').replace(/\}$/, '');
  if (!inner) return [];
  return inner.split(',').map((s) => s.replace(/^"|"$/g, ''));
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
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
           c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE n.nspname = current_schema()
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
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
  const policies = await db.query(`
    SELECT tablename AS table_name, policyname, cmd, permissive, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = current_schema()
       AND tablename LIKE 'test_request_%'
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
    if (!tables[bare]) {
      tables[bare] = {
        relkind: null, relpersistence: null, rowSecurity: { enabled: false, forced: false }, columns: [], constraints: [], indexes: [], triggers: [], policies: [],
      };
    }
    return tables[bare];
  };
  for (const r of columns.rows) {
    const t = table(r.table_name);
    // Relation metadata is constant per relation; every column
    // row for the same table carries the same values, so the last write
    // wins harmlessly.
    t.relkind = r.relkind;
    t.relpersistence = r.relpersistence;
    t.rowSecurity = { enabled: r.relrowsecurity, forced: r.relforcerowsecurity };
    t.columns.push({
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
  for (const r of policies.rows) {
    table(r.table_name).policies.push({
      name: r.policyname,
      cmd: r.cmd,
      permissive: r.permissive,
      roles: parsePgNameArray(r.roles).sort(),
      qual: canonicalizeDefinition(r.qual, schema),
      withCheck: canonicalizeDefinition(r.with_check, schema),
    });
  }
  for (const t of Object.values(tables)) {
    t.constraints.sort((a, b) => a.name.localeCompare(b.name));
    t.indexes.sort((a, b) => a.name.localeCompare(b.name));
    t.triggers.sort((a, b) => a.name.localeCompare(b.name));
    t.policies.sort((a, b) => a.name.localeCompare(b.name));
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

    // Codex round-3 #5: relation kind (a table replaced by a same-named view
    // reads/writes materially differently while every column/constraint/
    // index/trigger check could still pass) and row-level-security state.
    if ((exp.relkind || null) !== (act.relkind || null)) {
      differing.push(`table ${name} relkind (${exp.relkind} → ${act.relkind})`);
    }
    if ((exp.relpersistence || null) !== (act.relpersistence || null)) {
      differing.push(`table ${name} relpersistence (${exp.relpersistence} → ${act.relpersistence})`);
    }
    const expRls = exp.rowSecurity || { enabled: false, forced: false };
    const actRls = act.rowSecurity || { enabled: false, forced: false };
    if (!!expRls.enabled !== !!actRls.enabled || !!expRls.forced !== !!actRls.forced) {
      differing.push(`table ${name} row security (enabled=${!!expRls.enabled} forced=${!!expRls.forced} → enabled=${!!actRls.enabled} forced=${!!actRls.forced})`);
    }

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

    diffNamedList('policy', name, exp.policies || [], act.policies || [], missing, differing, extra, (e, a) => {
      if (e.cmd !== a.cmd || e.permissive !== a.permissive || e.qual !== a.qual || e.withCheck !== a.withCheck
        || JSON.stringify(e.roles) !== JSON.stringify(a.roles)) {
        return `${e.cmd}:${e.permissive} → ${a.cmd}:${a.permissive}`;
      }
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
 * compares EXACTLY (no missing, no differing, AND no extra — Opus round-2
 * item 3: a prior version tolerated `extra` in this sub-comparison, so a
 * table with all approved fields PLUS an unapproved extra column,
 * constraint, index, or trigger still passed; an extra trigger is
 * especially dangerous since it can execute side effects while every write
 * mode proceeds) against `liveFingerprint.tables[X]`. A name-only match
 * with a different or larger shape is NOT approved — this is what Codex's
 * original recommendation ("extras must exactly match an approved
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
    return !(shapeDiff.missing.length === 0 && shapeDiff.differing.length === 0 && shapeDiff.extra.length === 0);
  });
}

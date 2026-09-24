#!/usr/bin/env node
/**
 * Stage 0 census probe for docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md
 * (plan §5 Stage 0, items 1-2; Appendix A/B).
 *
 * Reports where the repo touches Postgres directly today: files that
 * import a driver (`@vercel/postgres` or `pg`), `sql` tagged-template
 * statements, `sql.query`/`client.query`/`pool.query` calls, `db.connect()`
 * / `pool.connect()` pairs, `new Pool(...)`, and explicit `BEGIN` literals
 * -- plus a best-effort table-name extraction per statement.
 *
 * STAGE 0 IS REPORT-ONLY: this script never fails the build on census
 * content. Default mode, `--report`, and `--json` all exit 0 on any census
 * result; the only non-zero exit is 2, on a parse failure (a file under
 * scan that Babel cannot parse at all -- see analyzeRoot). The
 * ratchet/allowlist law (import outside lib/postgres/** + Q5 exemptions
 * fails) is Stage 1 work and is not built here.
 *
 * Known Stage 0 recognition gaps (by identifier name only), left for Stage 1
 * to close:
 *   - A renamed or destructured-and-renamed `sql` tag (`import { sql as q }
 *     from '@vercel/postgres'`, or `const { sql: q } = require(...)`) is
 *     still recorded as a driver-import (the import/require node itself is
 *     name-agnostic), but the resulting `q\`...\`` tagged template is NOT
 *     recorded as sql-tag, because sql-tag recognition keys on the literal
 *     identifier name `sql`. Likewise a MEMBER tag (`vp.sql\`...\`` after a
 *     namespace import) is never recorded as sql-tag. No live instance of
 *     either exists today (Appendix A), so this is acceptable for a Stage 0
 *     report, but Stage 1's ratchet MUST resolve tag bindings back to their
 *     import source before counting -- otherwise a renamed tag silently
 *     evades the per-file statement count and the ratchet baseline.
 *   - `new pg.Pool()` (member-expression callee, vs. the recognized bare
 *     `new Pool()`), a `.connect()` call on any object other than `db`/
 *     `pool` (e.g. `p.connect()`), and `.query()`/`.connect()` reached
 *     through a nested member path (e.g. `this.pool.query(...)`) are not
 *     recognized kinds. No live instance exists today; Stage 1 should widen
 *     recognition if one appears.
 *
 * Classification is AST-only (plan §2 rule 12): a file whose only mention of
 * a driver name is inside a comment produces NO record. Detection reuses the
 * shared hardened scanner core (scripts/lib/ast-scan-core.js,
 * createSourceRecognizers) so import/require/dynamic-import forms are
 * recognized the same way scripts/check-route-service-boundary.js recognizes
 * its boundary sources -- modeled on that gate's CLI shape (--report --json
 * --self-test --root <dir>) and output style.
 *
 * Design choice (barrel re-export propagation): unlike the route-service
 * boundary gate, this probe does NOT propagate driver reachability through a
 * re-export barrel. A file that re-exports `sql` from `@vercel/postgres` is
 * itself recorded as a driver-import; a second file that imports `sql` from
 * that barrel is NOT recorded as a driver-import (it has no direct AST edge
 * to the driver). This keeps Stage 0 a simple, auditable per-file scan; the
 * ratchet gate can add propagation in Stage 1 if the barrel pattern turns up
 * in the live tree (Appendix A found none: every `sql` tag today sits in a
 * file that also directly imports a driver).
 *
 * Self-test fixtures (--self-test) are built under a fresh os.tmpdir()
 * mkdtemp() directory, never under a tracked repo path, so a fixture can
 * never be picked up by another gate's scan (which walks lib/, pages/,
 * shared/, modules/ in this repo) and the temp dir is safe to build
 * concurrently with any other session. The fixture tree is removed in a
 * `finally` before this script exits.
 *
 * Usage:
 *   node scripts/check-postgres-access-layer.js [--root <dir>] [--report] [--json] [--self-test]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseModule,
  walkAst,
  stringLiteralValue,
  importCallSourceNode,
  propName,
  toRel,
  createSourceRecognizers,
} = require('./lib/ast-scan-core');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['pages', 'lib', 'shared', 'modules'];
const JS_EXT_RE = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;

const KINDS = [
  'driver-import',
  'sql-tag',
  'sql.query',
  'client.query',
  'pool.query',
  'db.connect',
  'pool.connect',
  'new-Pool',
  'begin-literal',
];

// Q2/Q5 do not apply yet (Stage 0 is report-only); this predicate binds the
// shared scanner core's require()/dynamic-import() recognizers to the two
// driver module names named in the plan (§5 Stage 0 item 1).
function isPostgresDriverSource(value) {
  return value === '@vercel/postgres' || value === 'pg';
}

// Best-effort table-name extraction. Table identifiers can be bare
// (`user_profiles`), schema-qualified (`public.user_profiles`), or
// double-quoted (`"Mixed_Case"`); the regex accepts either shape.
const TABLE_RE = /\b(?:FROM|INTO|UPDATE|JOIN)\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_.]*)/gi;

// SQL keywords/functions that sit directly after FROM/INTO/UPDATE/JOIN in
// real statements and would otherwise be misread as a table name (rule: this
// extraction is regex-over-text, not a real parser, so it is a stopset, not
// exhaustive). `__PARAM__` is the placeholder quasisText() substitutes for
// every interpolated `${...}` position -- it must never be reported as a
// table name itself.
const TABLE_STOPWORDS = new Set([
  'set', 'skip', 'of', 'where', 'now', 'lateral', 'only', 'select', 'values',
  'unnest', 'jsonb_array_elements', 'jsonb_array_elements_text', '__param__',
]);

// CTE aliases (`WITH inserted AS (...) ... FROM inserted`) are NOT
// distinguished from real tables by this best-effort regex -- a CTE alias
// that happens to follow FROM/JOIN is reported the same as a table. This is
// a known, tolerated over-approximation for Stage 0 (documented, not fixed):
// resolving `WITH <name> AS` bindings would require tracking scope, which is
// out of scope for a regex-based extractor. Reviewers reconciling this
// report's table list against scripts/setup-database.js / migrations should
// expect a handful of CTE-alias entries that are not real tables.
function extractTables(sqlText, into) {
  if (!sqlText) return;
  TABLE_RE.lastIndex = 0;
  let match;
  while ((match = TABLE_RE.exec(sqlText))) {
    let raw = match[1];
    const quoted = raw.startsWith('"') && raw.endsWith('"');
    if (quoted) raw = raw.slice(1, -1);
    const compareKey = raw.toLowerCase();
    if (TABLE_STOPWORDS.has(compareKey)) continue;
    if (compareKey.startsWith('information_schema') || compareKey.startsWith('pg_catalog')) continue;
    into.add(quoted ? raw : compareKey);
  }
}

// Quasis are joined with a placeholder token (never a bare space) so an
// interpolated `${...}` parameter position can never be misread as the
// identifier following a FROM/INTO/UPDATE/JOIN keyword (e.g. `` FROM ${t}
// WHERE `` must not collapse into `FROM WHERE`, reading WHERE as a table).
function quasisText(templateLiteral) {
  return templateLiteral.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' __PARAM__ ');
}

function firstQuasiTrimmed(templateLiteral) {
  const first = templateLiteral.quasis[0];
  const text = first ? (first.value.cooked ?? first.value.raw) : '';
  return text.trim();
}

function isQueryMemberCall(node, objectNames) {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee;
  if (!callee || (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression')) return null;
  if (callee.object.type !== 'Identifier' || !objectNames.has(callee.object.name)) return null;
  const property = propName(callee.computed ? null : callee.property) || (callee.computed ? null : callee.property.name);
  if (property !== 'query') return null;
  return callee.object.name;
}

// Case-insensitive, prefix match -- mirrors the sql-tag path
// (firstQuasiTrimmed(...).toUpperCase().startsWith('BEGIN')) so
// `sql.query('BEGIN ISOLATION LEVEL ...')` is recognized the same way a
// tagged-template `sql\`BEGIN ISOLATION LEVEL ...\`` is.
function firstArgIsBegin(node) {
  const arg = node.arguments && node.arguments[0];
  const value = arg ? stringLiteralValue(arg) : null;
  return typeof value === 'string' && value.trim().toUpperCase().startsWith('BEGIN');
}

// Classify one already-parsed file. Returns { kinds: Map<kind,count>, tables: Set<string> }.
function classifyFile(ast, recognizers) {
  const kinds = new Map();
  const tables = new Set();
  const bump = (kind, n = 1) => kinds.set(kind, (kinds.get(kind) || 0) + n);

  walkAst(ast, (node) => {
    // Static import declaration naming the driver, incl. `export ... from`
    // re-export forms (a barrel file re-exporting the driver is itself a
    // driver-import site -- see docblock on propagation).
    if ((node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration')
      && node.source && isPostgresDriverSource(stringLiteralValue(node.source))) {
      bump('driver-import');
      return;
    }

    // require('@vercel/postgres' | 'pg') and dynamic import() of same,
    // recognized via the shared hardened scanner core.
    if (recognizers.isRequireCall(node) || recognizers.isDynamicImportOfSource(node)) {
      bump('driver-import');
      return;
    }

    if (node.type === 'TaggedTemplateExpression'
      && node.tag && node.tag.type === 'Identifier' && node.tag.name === 'sql') {
      bump('sql-tag');
      const text = quasisText(node.quasi);
      extractTables(text, tables);
      if (firstQuasiTrimmed(node.quasi).toUpperCase().startsWith('BEGIN')) bump('begin-literal');
      return;
    }

    const queryObject = isQueryMemberCall(node, new Set(['sql', 'client', 'pool']));
    if (queryObject) {
      bump(`${queryObject}.query`);
      const arg = node.arguments && node.arguments[0];
      const literal = arg ? stringLiteralValue(arg) : null;
      if (literal) extractTables(literal, tables);
      if (firstArgIsBegin(node)) bump('begin-literal');
      return;
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee && (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression')
        && callee.object.type === 'Identifier'
        && (callee.object.name === 'db' || callee.object.name === 'pool')
        && propName(callee.computed ? null : callee.property) === 'connect') {
        bump(`${callee.object.name}.connect`);
        return;
      }
    }

    if (node.type === 'NewExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === 'Pool') {
      bump('new-Pool');
    }
  });

  return { kinds, tables };
}

function collectFiles(root) {
  const files = [];
  for (const relDir of SCAN_DIRS) {
    const base = path.join(root, relDir);
    if (!fs.existsSync(base)) continue;
    walkDir(base);
  }
  return files.sort((a, b) => toRel(root, a).localeCompare(toRel(root, b)));

  function walkDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.next' || ent.name === '__tests__') continue;
        walkDir(full);
        continue;
      }
      if (!ent.isFile() || !JS_EXT_RE.test(ent.name)) continue;
      if (/\.test\./.test(ent.name)) continue;
      files.push(full);
    }
  }
}

function topDir(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'pages' && parts[1] === 'api') return 'pages/api';
  if (parts[0] === 'lib' && parts[1]) return `lib/${parts[1]}`;
  return parts[0];
}

function analyzeRoot(root) {
  const recognizers = createSourceRecognizers(isPostgresDriverSource);
  const files = collectFiles(root);
  const records = [];
  for (const full of files) {
    const rel = toRel(root, full);
    const source = fs.readFileSync(full, 'utf8');
    let ast;
    try {
      ast = parseModule(source);
    } catch (err) {
      throw new Error(`postgres-access-layer parse error in ${rel}: ${err.message}`);
    }
    const { kinds, tables } = classifyFile(ast, recognizers);
    if (kinds.size === 0) continue; // no recognized kind -> not in the census
    records.push({ file: rel, kinds, tables: [...tables].sort() });
  }
  records.sort((a, b) => a.file.localeCompare(b.file));
  return records;
}

function buildSummary(records) {
  const driverFilesByDir = new Map();
  let driverFileTotal = 0;
  let sqlTagFiles = 0;
  let sqlTagTotal = 0;
  const kindTotals = new Map(KINDS.map((k) => [k, 0]));

  for (const rec of records) {
    if (rec.kinds.has('driver-import')) {
      driverFileTotal += 1;
      const dir = topDir(rec.file);
      driverFilesByDir.set(dir, (driverFilesByDir.get(dir) || 0) + 1);
    }
    if (rec.kinds.has('sql-tag')) {
      sqlTagFiles += 1;
      sqlTagTotal += rec.kinds.get('sql-tag');
    }
    for (const [kind, count] of rec.kinds) {
      kindTotals.set(kind, (kindTotals.get(kind) || 0) + count);
    }
  }

  return {
    driverFileTotal,
    driverFilesByDir: [...driverFilesByDir.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    sqlTagFiles,
    sqlTagTotal,
    kindTotals: [...kindTotals.entries()],
    // Every file with ANY recognized kind, not just driver-import files: a
    // handful of files call `.query()` on a `pg`/`@vercel/postgres` client
    // received as an argument (e.g. from a caller's `withClient`) without
    // importing the driver themselves, so this is >= driverFileTotal, never
    // the same number, and the two must not be confused in a headline.
    totalFilesInCensus: records.length,
  };
}

function formatReport(records) {
  const summary = buildSummary(records);
  const lines = [
    'Postgres access-layer census (Stage 0, REPORT-ONLY -- exits 0 on any census result; exits 2 only on a parse failure)',
    `Driver-import files (import/require/dynamic-import of a driver): ${summary.driverFileTotal}`,
    `Files with any recognized record (incl. non-driver-import callers, e.g. a client passed in as an argument): ${summary.totalFilesInCensus}`,
    '',
    '| Dir | Driver-import files |',
    '|---|---:|',
  ];
  for (const [dir, count] of summary.driverFilesByDir) {
    lines.push(`| ${dir} | ${count} |`);
  }
  lines.push(
    '',
    `sql\` tags: ${summary.sqlTagTotal} in ${summary.sqlTagFiles} files`,
    '',
    '| Kind | Count |',
    '|---|---:|',
  );
  for (const [kind, count] of summary.kindTotals) {
    lines.push(`| ${kind} | ${count} |`);
  }
  lines.push('', '## Files', '', '| File | Kinds | Tables |', '|---|---|---|');
  for (const rec of records) {
    const kindsStr = [...rec.kinds.entries()].map(([k, c]) => `${k}:${c}`).join(', ');
    lines.push(`| ${rec.file} | ${kindsStr} | ${rec.tables.join(', ')} |`);
  }
  return lines.join('\n');
}

function buildJson(records) {
  const summary = buildSummary(records);
  return {
    driverFileTotal: summary.driverFileTotal,
    driverFilesByDir: Object.fromEntries(summary.driverFilesByDir),
    sqlTagFiles: summary.sqlTagFiles,
    sqlTagTotal: summary.sqlTagTotal,
    kindTotals: Object.fromEntries(summary.kindTotals),
    totalFilesInCensus: summary.totalFilesInCensus,
    files: records.map((rec) => ({
      file: rec.file,
      kinds: Object.fromEntries(rec.kinds),
      tables: rec.tables,
    })),
  };
}

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, report: false, json: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root requires a directory');
      args.root = path.resolve(value);
    } else if (arg === '--report') {
      args.report = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/check-postgres-access-layer.js [--root <dir>] [--report] [--json] [--self-test]',
    '',
    'Stage 0 census probe (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).',
    'REPORT-ONLY: default mode, --report, and --json exit 0 on any census',
    'result; the only non-zero exit is 2, on a parse failure.',
    '--report prints dir/kind rollups and the full per-file table.',
    '--json prints the same data as JSON.',
    '--self-test builds an isolated fixture tree under os.tmpdir() and',
    '  verifies every recognized kind, a comment-only non-match, and the',
    '  barrel/no-propagation design choice, then cleans up.',
  ].join('\n');
}

// ---- self-test -------------------------------------------------------

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function expect(condition, message) {
  if (!condition) throw new Error(`self-test FAILED: ${message}`);
}

function findRecord(json, file) {
  return json.files.find((f) => f.file === file);
}

function runSelfTest() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-access-layer-selftest-'));
  try {
    write(tempRoot, 'lib/services/plain-import.js', `
      import { sql } from '@vercel/postgres';
      export async function get() {
        return sql\`SELECT 1 FROM user_profiles\`;
      }
    `);

    write(tempRoot, 'lib/services/namespace-import.js', `
      import * as pgDriver from '@vercel/postgres';
      export async function get() {
        return pgDriver.sql\`SELECT 1\`;
      }
    `);

    write(tempRoot, 'lib/services/cjs-require.js', `
      const postgres = require('@vercel/postgres');
      module.exports.run = () => postgres.sql\`SELECT 1\`;
    `);

    write(tempRoot, 'lib/services/destructured-require.js', `
      const { sql } = require('@vercel/postgres');
      module.exports.run = () => sql\`SELECT 1 FROM system_alerts\`;
    `);

    // Barrel + non-propagated consumer (documented design choice).
    write(tempRoot, 'lib/services/barrel.js', `
      export { sql } from '@vercel/postgres';
    `);
    write(tempRoot, 'lib/services/barrel-consumer.js', `
      import { sql } from './barrel';
      export async function get() {
        return sql\`SELECT 1\`;
      }
    `);

    write(tempRoot, 'lib/services/dynamic-import.js', `
      export async function get() {
        const { sql } = await import('@vercel/postgres');
        return sql\`SELECT 1\`;
      }
    `);

    write(tempRoot, 'lib/services/pg-pool.js', `
      const { Pool } = require('pg');
      const pool = new Pool();
      module.exports.run = () => pool.query('SELECT 1');
    `);

    write(tempRoot, 'lib/services/begin-client.js', `
      const { db } = require('@vercel/postgres');
      module.exports.run = async () => {
        const client = await db.connect();
        await client.query('BEGIN');
        await client.query('SELECT 1');
        client.release();
      };
    `);

    write(tempRoot, 'lib/services/comment-only.js', `
      // This module used to depend on @vercel/postgres and require('pg') directly.
      module.exports.run = () => 1;
    `);

    // Alias-import / alias-require (Stage 0 known gap, documented in the
    // docblock): the driver import/require is still recorded regardless of
    // local name, but the resulting `q\`...\`` tag is NOT recorded as
    // sql-tag because sql-tag recognition keys on the literal name `sql`.
    write(tempRoot, 'lib/services/alias-import.js', `
      import { sql as q } from '@vercel/postgres';
      export async function get() {
        return q\`SELECT 1 FROM aliased_table\`;
      }
    `);
    write(tempRoot, 'lib/services/alias-require.js', `
      const { sql: q } = require('@vercel/postgres');
      module.exports.run = () => q\`SELECT 1\`;
    `);

    // sql.query(text, params) -- exercises the sql.query kind (live tree has
    // 40 occurrences and the prior self-test never exercised this kind).
    write(tempRoot, 'lib/services/sql-query-call.js', `
      import { sql } from '@vercel/postgres';
      export async function run(id) {
        return sql.query('SELECT 1 FROM foo WHERE id = $1', [id]);
      }
    `);

    // pool.connect() -- the pg-Pool sibling of db.connect(), live at
    // pages/api/intake/submit.js, pages/api/cron/drain-submissions.js, and
    // lib/services/irs-bmf-service.js.
    write(tempRoot, 'lib/services/pool-connect.js', `
      const { Pool } = require('pg');
      module.exports.run = async () => {
        const pool = new Pool();
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
      };
    `);

    // Table-extraction edge cases: ON CONFLICT DO UPDATE SET (would misread
    // 'set' as a table), FOR UPDATE SKIP LOCKED ('skip'), a double-quoted
    // identifier (case preserved), and a FROM-clause function call
    // ('jsonb_array_elements'). None of these must appear in the extracted
    // table set; widget_requests and Mixed_Case_Table must.
    write(tempRoot, 'lib/services/table-edge-cases.js', `
      import { sql } from '@vercel/postgres';
      export async function run(id) {
        await sql\`
          INSERT INTO widget_requests (id) VALUES (\${id})
          ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
        \`;
        await sql\`SELECT * FROM "Mixed_Case_Table" WHERE id = \${id}\`;
        await sql\`SELECT id FROM widget_requests FOR UPDATE SKIP LOCKED\`;
        await sql\`SELECT * FROM jsonb_array_elements(payload) AS elem\`;
      }
    `);

    write(tempRoot, 'pages/api/health.js', `
      import { sql } from '@vercel/postgres';
      export default async function handler(req, res) {
        res.json(await sql\`SELECT 1\`);
      }
    `);

    const output = execFileSync(process.execPath, [__filename, '--root', tempRoot, '--json'], {
      encoding: 'utf8',
    });
    const json = JSON.parse(output);

    // Comment-only mention must produce zero records (rule 12).
    expect(findRecord(json, 'lib/services/comment-only.js') === undefined,
      'comment-only.js must not appear in the census');

    // Driver-import: every file with a real AST edge to the driver, EXCEPT
    // the barrel consumer (no propagation through the barrel -- documented
    // design choice).
    const driverImportFiles = json.files.filter((f) => f.kinds['driver-import']).map((f) => f.file).sort();
    expect(!driverImportFiles.includes('lib/services/barrel-consumer.js'),
      `barrel-consumer.js must NOT be recorded as driver-import (no propagation); got ${JSON.stringify(driverImportFiles)}`);
    const expectedDriverImportFiles = [
      'lib/services/alias-import.js',
      'lib/services/alias-require.js',
      'lib/services/barrel.js',
      'lib/services/begin-client.js',
      'lib/services/cjs-require.js',
      'lib/services/destructured-require.js',
      'lib/services/dynamic-import.js',
      'lib/services/namespace-import.js',
      'lib/services/pg-pool.js',
      'lib/services/plain-import.js',
      'lib/services/pool-connect.js',
      'lib/services/sql-query-call.js',
      'lib/services/table-edge-cases.js',
      'pages/api/health.js',
    ];
    expect(JSON.stringify(driverImportFiles) === JSON.stringify(expectedDriverImportFiles),
      `driver-import file set mismatch: got ${JSON.stringify(driverImportFiles)}, expected ${JSON.stringify(expectedDriverImportFiles)}`);
    expect(json.driverFileTotal === expectedDriverImportFiles.length,
      `driverFileTotal expected ${expectedDriverImportFiles.length}, got ${json.driverFileTotal}`);
    expect(json.driverFilesByDir['lib/services'] === 13,
      `expected 13 driver-import files under lib/services, got ${json.driverFilesByDir['lib/services']}`);
    expect(json.driverFilesByDir['pages/api'] === 1,
      `expected 1 driver-import file under pages/api, got ${json.driverFilesByDir['pages/api']}`);

    // Alias-import/alias-require are driver-import (checked above) but must
    // NOT be sql-tag: the tag identifier is `q`, not `sql` (documented Stage
    // 0 gap, Stage 1 obligation).
    expect(!findRecord(json, 'lib/services/alias-import.js').kinds['sql-tag'],
      'alias-import.js (tag `q`) must NOT be recorded as sql-tag');
    expect(!findRecord(json, 'lib/services/alias-require.js').kinds['sql-tag'],
      'alias-require.js (tag `q`) must NOT be recorded as sql-tag');

    // sql-tag: plain-import, destructured-require, dynamic-import,
    // barrel-consumer (own tag, independent of driver-import propagation),
    // health, table-edge-cases (4 tags in one file). namespace-import/
    // cjs-require use a MEMBER tag (pgDriver.sql / postgres.sql), and
    // alias-import/alias-require use the renamed identifier `q`, not a bare
    // `sql` identifier tag, so none of those four count (documented gap).
    const sqlTagFiles = json.files.filter((f) => f.kinds['sql-tag']).map((f) => f.file).sort();
    const expectedSqlTagFiles = [
      'lib/services/barrel-consumer.js',
      'lib/services/destructured-require.js',
      'lib/services/dynamic-import.js',
      'lib/services/plain-import.js',
      'lib/services/table-edge-cases.js',
      'pages/api/health.js',
    ];
    expect(JSON.stringify(sqlTagFiles) === JSON.stringify(expectedSqlTagFiles),
      `sql-tag file set mismatch: got ${JSON.stringify(sqlTagFiles)}, expected ${JSON.stringify(expectedSqlTagFiles)}`);
    expect(json.sqlTagFiles === expectedSqlTagFiles.length,
      `sqlTagFiles expected ${expectedSqlTagFiles.length}, got ${json.sqlTagFiles}`);
    const expectedSqlTagTotal = expectedSqlTagFiles.length + 3; // table-edge-cases.js has 4 tags, not 1
    expect(json.sqlTagTotal === expectedSqlTagTotal,
      `sqlTagTotal expected ${expectedSqlTagTotal}, got ${json.sqlTagTotal}`);

    // Kind-specific occurrence checks, incl. the two kinds the prior
    // self-test never exercised (sql.query, pool.connect).
    expect(json.kindTotals['new-Pool'] === 2, `expected new-Pool: 2, got ${json.kindTotals['new-Pool']}`);
    expect(json.kindTotals['pool.query'] === 1, `expected pool.query: 1, got ${json.kindTotals['pool.query']}`);
    expect(json.kindTotals['db.connect'] === 1, `expected db.connect: 1, got ${json.kindTotals['db.connect']}`);
    expect(json.kindTotals['pool.connect'] === 1, `expected pool.connect: 1, got ${json.kindTotals['pool.connect']}`);
    expect(json.kindTotals['client.query'] === 3, `expected client.query: 3, got ${json.kindTotals['client.query']}`);
    expect(json.kindTotals['begin-literal'] === 1, `expected begin-literal: 1, got ${json.kindTotals['begin-literal']}`);
    expect(json.kindTotals['sql.query'] === 1, `expected sql.query: 1, got ${json.kindTotals['sql.query']}`);

    // Table extraction (best-effort, only from sql-tag quasis / query args).
    const plainImport = findRecord(json, 'lib/services/plain-import.js');
    expect(plainImport.tables.includes('user_profiles'),
      `plain-import.js tables should include user_profiles, got ${JSON.stringify(plainImport.tables)}`);
    const destructured = findRecord(json, 'lib/services/destructured-require.js');
    expect(destructured.tables.includes('system_alerts'),
      `destructured-require.js tables should include system_alerts, got ${JSON.stringify(destructured.tables)}`);
    const sqlQueryCall = findRecord(json, 'lib/services/sql-query-call.js');
    expect(sqlQueryCall.tables.includes('foo'),
      `sql-query-call.js tables should include foo, got ${JSON.stringify(sqlQueryCall.tables)}`);
    expect(!sqlQueryCall.tables.includes('where'),
      `sql-query-call.js tables must NOT include the WHERE keyword, got ${JSON.stringify(sqlQueryCall.tables)}`);

    // Table-extraction edge cases (item 1): ON CONFLICT DO UPDATE SET,
    // FOR UPDATE SKIP LOCKED, a quoted identifier, and a FROM-clause
    // function call must not leak keywords/functions as table names, and
    // the placeholder join token must never itself appear as a table.
    const edgeCases = findRecord(json, 'lib/services/table-edge-cases.js');
    const edgeTables = edgeCases.tables;
    expect(edgeTables.includes('widget_requests'),
      `table-edge-cases.js tables should include widget_requests, got ${JSON.stringify(edgeTables)}`);
    expect(edgeTables.includes('Mixed_Case_Table'),
      `table-edge-cases.js tables should include the quoted Mixed_Case_Table, got ${JSON.stringify(edgeTables)}`);
    for (const bogus of ['set', 'skip', 'jsonb_array_elements', '__param__', 'where']) {
      expect(!edgeTables.includes(bogus),
        `table-edge-cases.js tables must NOT include '${bogus}', got ${JSON.stringify(edgeTables)}`);
    }

    // --report and default mode must also exit 0 (Stage 0 is report-only),
    // and --report's headline must expose BOTH the driver-import count and
    // the (larger) any-record count as distinct numbers.
    const reportOutput = execFileSync(process.execPath, [__filename, '--root', tempRoot, '--report'], { encoding: 'utf8' });
    expect(reportOutput.includes(`Driver-import files (import/require/dynamic-import of a driver): ${json.driverFileTotal}`),
      `--report headline missing/mismatched driver-import count:\n${reportOutput}`);
    expect(reportOutput.includes(`Files with any recognized record (incl. non-driver-import callers, e.g. a client passed in as an argument): ${json.totalFilesInCensus}`),
      `--report headline missing/mismatched total-files-in-census count:\n${reportOutput}`);
    execFileSync(process.execPath, [__filename, '--root', tempRoot], { encoding: 'utf8' });

    console.log('postgres-access-layer self-test OK -- all fixture kinds, comment exclusion, alias/renamed-tag gap, and no-propagation behavior verified.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.selfTest) {
    runSelfTest();
    return 0;
  }

  const records = analyzeRoot(args.root);
  if (args.json) {
    console.log(JSON.stringify(buildJson(records), null, 2));
  }
  if (args.report) {
    console.log(formatReport(records));
  }
  if (!args.report && !args.json) {
    console.log('postgres-access-layer: report-only in Stage 0 (use --report or --json for detail).');
  }
  return 0; // Stage 0 is report-only: exits 0 on any census result; exit 2 is parse-failure only (below).
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.message || err);
    process.exit(2);
  }
}

module.exports = {
  analyzeRoot,
  buildSummary,
  buildJson,
  formatReport,
  isPostgresDriverSource,
};

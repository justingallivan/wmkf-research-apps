#!/usr/bin/env node
/**
 * Stage 0/1 census + ratchet gate for
 * docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md (plan §5
 * Stage 0 items 1-2, Stage 1 items 0/1/3; Appendix A/B).
 *
 * Reports where the repo touches Postgres directly today: files that import
 * a driver (`@vercel/postgres`, `pg`, or `@neondatabase/serverless` -- and
 * any subpath of those three, e.g. `pg/lib/client`), `sql` tagged-template
 * statements, `sql.query`/`client.query`/`pool.query` calls, `db.connect()`
 * / `pool.connect()` pairs, `new Pool(...)`, explicit `BEGIN` literals, a
 * computed (non-literal, non-one-hop-resolvable) require()/import() source
 * (`unresolved-import`), and a raw driver handle handed back out through a
 * file's own exports (`driver-export`) -- eleven kinds total (KINDS) --
 * plus a best-effort table-name extraction per statement and (Q6, warn-only)
 * a cast-lint scan of `${...}` placeholders that sit in a
 * jsonb_build_object/jsonb_build_array/concat/format/CASE/VALUES region
 * without an immediately-following `::cast`. Q6 scope is tagged templates
 * only: a `${...}`-style placeholder inside a `sql.query('...$1...', params)`
 * or `client.query('...$1...', params)` STRING literal is not linted -- those
 * calls pass parameters positionally ($1, $2, ...), not by JS interpolation,
 * so there is no `${...}` for this scan to find; Q6 is specifically about
 * catching an uncast interpolated value inside a tagged-template statement.
 *
 * STAGE 1 IS A RATCHET (law arrives in Stage 7): default mode (no flags) applies the ratchet in
 * `scripts/postgres-access-allowlist.json` and exits 1 on any violation.
 * `--report` and `--json` print their output AND ALSO apply the ratchet,
 * returning its exit code (so `npm run check:postgres-access-layer`, which
 * is `--report`, goes red on a violation with no package.json change). If
 * BOTH `--report` and `--json` are passed, the report goes to stderr and
 * the JSON goes to stdout, so stdout is always valid JSON in that mode.
 * Parse failure, a malformed allowlist (duplicate (file,kind) key, or an
 * entry -- other than a `_comment` metadata entry -- missing `file`/`kind`/
 * `count`), or a missing allowlist file are all exit 2.
 *
 * Ratchet law (checked against `scripts/postgres-access-allowlist.json`,
 * hand-edited, shrink-only -- there is no --update/regenerate flag):
 *   (a) any (file, kind) recorded by the live census that is not in the
 *       allowlist, or whose census count exceeds the allowed count, fails;
 *   (b) any allowlist (file, kind) whose count exceeds the live census
 *       count, or whose file/kind no longer appears in the census at all,
 *       fails as a stale entry -- the allowlist may only shrink by hand; an
 *       allowlist entry naming a Q5-exempt file is ALSO a violation (exempt
 *       files are never ratcheted and must not appear in the allowlist);
 *   (c) any `pages/api/**` file that imports `lib/postgres/**` (by
 *       import/require/dynamic-import source matching `lib/postgres` as a
 *       path segment, e.g. `../../lib/postgres`, `../../lib/postgres/client`)
 *       fails -- routes go through `lib/services`, never the driver seam
 *       directly. It shares its file walker/skip rules with the census
 *       scan (collectFiles) so the two never disagree about which files
 *       are in scope.
 * Two kinds close computed-access evasions and are ratcheted exactly like
 * every other kind (checks (a)/(b) above apply to them too):
 *   - `unresolved-import`: a require()/dynamic-import() call whose source
 *     is not a literal and does not resolve one hop through a same-file
 *     const/let string binding (see "Module-source resolution" below). A
 *     computed specifier (`require(['@vercel','postgres'].join('/'))`,
 *     `require(pickDriver())`, ...) is invisible to driver-import
 *     recognition by construction -- a competent attacker's or an
 *     accidental refactor's first move -- so it is counted and ratcheted in
 *     its own right instead of only being an audit footnote. Its violation
 *     message never uses the generic wording; it always explains the
 *     computed-source problem and how to fix it or, if the call is a
 *     deliberate bundler bypass, how to allowlist it in a reviewed commit.
 *   - `driver-export`: an allowlisted service handing a raw driver handle
 *     back out through its own exports -- `export { sql }`, `export
 *     default db`, `module.exports.pool = pool`, `module.exports = { sql
 *     }`, or an exported function that `return`s such a binding directly
 *     (`export function getRawSql() { return sql; }`) -- which would let a
 *     brand-new, otherwise-unratcheted caller reach the driver under a name
 *     this gate never sees import a driver at all. See "driver-export
 *     detection" below for exactly what counts.
 * The exemption is KIND-SPECIFIC, not a blanket per-file skip (Codex Stage 2
 * finding: a blanket `lib/postgres/**` exemption would let a future
 * `lib/postgres/stores/rogue.js` import `pg` directly and stay green,
 * silently defeating "one driver seam"). `lib/postgres/client.js` (the seam
 * itself) and the two Q5 files (`lib/utils/migration-drift.js`,
 * `lib/utils/health-checker.js`; `scripts/**` is already outside the scan
 * roots) are exempt for EVERY kind. Any OTHER file under `lib/postgres/**`
 * (a store) is exempt ONLY for `sql-tag`/`sql.query`/`client.query`/
 * `pool.query`/`db.connect`/`pool.connect`/`begin-literal` -- using the
 * seam's `sql` freely is the point of a store -- and is ratcheted like any
 * other file for `driver-import`/`driver-export`/`unresolved-import`/
 * `new-Pool`, since those are exactly the ways a store could reach the
 * driver on its own instead of through the seam. Every exempt (file, kind)
 * pair is skipped by ratchet checks (a)/(b) and must NOT appear in the
 * allowlist file, but it still shows up in `--report`/`--json` like any
 * other record.
 *
 * Classification is AST-only (plan §2 rule 12): a file whose only mention of
 * a driver name is inside a comment produces NO record. Detection reuses the
 * shared hardened scanner core (scripts/lib/ast-scan-core.js,
 * createSourceRecognizers) so import/require/dynamic-import forms are
 * recognized the same way scripts/check-route-service-boundary.js recognizes
 * its boundary sources -- modeled on that gate's CLI shape (--report --json
 * --self-test --root <dir>) and output style.
 *
 * Module-source resolution (P2-3): a require()/dynamic-import() source that
 * is not a direct string literal is resolved ONE hop through a same-file,
 * scope-insensitive `const`/`let X = '...'` binding (`const d =
 * '@vercel/postgres'; require(d)` is recognized as a driver import). A name
 * bound to more than one distinct string literal in the same file (a
 * reassignment or a second declaration) is treated as AMBIGUOUS rather than
 * resolved to "whichever came first" -- it fails open for classification
 * (same as any other unresolved source) and is reported as "(ambiguous)" in
 * the unresolved-sources rows. Any other non-literal source (a template
 * with an interpolation, a member access, a function call, a bare
 * parameter, ...) is likewise NOT resolved and does not fail DRIVER
 * classification either way -- it stays invisible to driver-import,
 * exactly like before. Every such call site anywhere in the scanned tree
 * is, however, counted into the `unresolved-import` kind (Codex round 2,
 * P1) -- a computed module source is exactly the shape of a deliberate
 * evasion (it defeats driver-import recognition by construction), so it is
 * ratcheted, not merely logged. `--report`'s "Unresolved module sources"
 * section and `--json`'s per-file `unresolved` array (file:line, plus the
 * one-hop-resolved literal when found) explain what makes up each file's
 * `unresolved-import` count; they carry no additional exit-code effect
 * beyond the kind's own ratchet entry.
 *
 * Tag/binding resolution (Stage 1 item 0, closes the Stage 0 recognition
 * gaps): a per-file, scope-insensitive binding map resolves `sql`/`db`/
 * `pool`/`Pool` re-exports and driver namespace imports back to their import
 * site before classification, so a renamed or destructured-and-renamed `sql`
 * tag (`import { sql as q } from '@vercel/postgres'`, `const { sql: q } =
 * require(...)`), a namespace member tag (`import * as vp from
 * '@vercel/postgres'; vp.sql\`...\`` / `const vp = require(...);
 * vp.sql\`...\``), a member-callee `new pg.Pool()`, a renamed `Pool`
 * specifier (`import { Pool as P } from 'pg'; new P()`, `const { Pool: P } =
 * require('pg')`), and a `.query()`/`.connect()` reached through a nested
 * member path or a variable bound to a `new Pool()` result or an imported
 * `db`/`pool` (e.g. `this.pool.query`, `self.db.connect()`, `p.connect()`)
 * are all recognized. The binding map is built per file, not per lexical
 * scope -- a shadowed local re-using an import's name in a nested scope is
 * not distinguished. No live instance of that shadowing exists today
 * (Appendix A); if one appears, this scanner will over-recognize rather than
 * silently miss it, which is the safe direction for a security/boundary
 * gate.
 *
 * sql-tag recognition is intentionally SOURCE-AGNOSTIC (unlike driver-import
 * and db/pool/namespace binding, which stay scoped to an actual driver
 * import): a bare tag literally named `sql`, or ANY renamed import specifier
 * or require()/dynamic-import() destructure binding `sql` to a local name,
 * counts as sql-tag no matter what module it comes from. This closes a real
 * evasion: re-exporting `sql` through an arbitrary barrel (`export { sql }`
 * from any file, even one this gate does not itself recognize as a driver
 * import) and consuming it elsewhere would otherwise silently escape the
 * ratchet. Every live `sql` tag today already sits in a file with a direct
 * driver import (Appendix A), so this is a strictly WIDER net, not a
 * narrower one, and changes no live count.
 *
 * driver-export detection (Codex round 2, P1; CJS accessor forms added
 * round 3): a binding whose role is
 * `sql-tag`/`db`/`pool`/`pool-ctor`/`namespace` is a live handle on the
 * driver. countDriverExports() counts two shapes that hand such a handle to
 * an arbitrary NEW caller without that caller ever importing a driver
 * itself: (i) an identity export/re-export of a role-bound identifier
 * (`export { sql }`, `export default db`, `module.exports.pool = pool`,
 * `module.exports = { sql }`, `exports.pool = pool`); (ii) a function that
 * returns such an identifier DIRECTLY, in EITHER an ESM shape (named,
 * default, or an arrow assigned to an exported const -- including one
 * exported later via a separate `export { name }`) or a CJS accessor shape
 * -- a function expression/arrow/method assigned to `module.exports.X`,
 * `exports.X`, or `module.exports` itself (`module.exports.getRawSql = ()
 * => sql`, `exports.getRawSql = function () { return sql; }`, and
 * function-valued properties inside `module.exports = { ... }`, whether an
 * `ObjectMethod` (`{ getRawSql() { return sql; } }`) or an arrow/function
 * property value (`{ getRawSql: () => sql }`)). `return sql;` and an
 * implicit-return arrow `() => sql` both match. A function that merely USES
 * the binding internally (`return sql\`...\``, `return await
 * sql.query(...)`) does not match (ii) in either shape: the return value
 * there is a query result or a template-tag call, never the bare
 * identifier. Live count is 0 (verified 2026-09-23, re-verified after the
 * CJS accessor widening) -- no allowlist entries exist for this kind; any
 * nonzero count is a real finding, not baseline noise.
 *
 * Aliased-require recognition (Codex round 3, P1): buildRequireAliasNames()
 * finds same-file bindings of `require` itself -- `const load = require;`,
 * `const load = module.require;`, or `const { require: r } = module;` --
 * and every check that recognizes a literal `require(...)` call
 * (driver-import, sql/db/pool/namespace binding resolution, the
 * one-hop const-string resolver, and the unresolved-import audit/kind)
 * treats a call through one of those aliases exactly like `require(...)`.
 * `module.require(...)` itself is recognized directly, with no aliasing
 * needed. This closes an evasion where `const load = require; const d =
 * load('pg'); new d.Pool()` previously produced no record at all -- the
 * literal case now classifies normally (driver-import + the returned
 * binding's downstream roles) and a computed source reached the same way
 * (`load(getModuleName())`) is caught as `unresolved-import`, same as a
 * direct `require(getModuleName())` would be.
 *
 * Multi-hop aliasing (Codex round 3, narrow follow-up): `buildRequireAliasNames`
 * and the driver-scoped/sql-tag binding map in `buildBindings` are BOTH a
 * same-file fixpoint over plain identifier-to-identifier declarations AND
 * assignments (`const load2 = load;`, `let l; l = require;`), not a single
 * hop -- an alias can be re-aliased any number of times before use
 * (`load -> load2 -> load3`, `vp -> vp2`) and every hop resolves. Each loop
 * re-walks the file and stops once a pass adds nothing new; this is a
 * fixpoint, not a fixed hop count, so it is not itself re-evadable by
 * adding one more hop.
 *
 * Self-test fixtures (--self-test) are built under a fresh os.tmpdir()
 * mkdtemp() directory, never under a tracked repo path, so a fixture can
 * never be picked up by another gate's scan (which walks lib/, pages/,
 * shared/, modules/ in this repo) and the temp dir is safe to build
 * concurrently with any other session. The fixture tree is removed in a
 * `finally` before this script exits. Ratchet self-test fixtures each build
 * their own tmp root AND their own tmp allowlist file, passed via
 * `--allowlist`, so they never touch the tracked
 * scripts/postgres-access-allowlist.json.
 *
 * Usage:
 *   node scripts/check-postgres-access-layer.js [--root <dir>] [--allowlist <path>] [--report] [--json] [--cast-lint-detail] [--self-test]
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
  unwrapExpression,
  propName,
  toRel,
  buildParentMap,
  isMember,
  isCommonJsExportTarget,
} = require('./lib/ast-scan-core');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ALLOWLIST_PATH = path.join(__dirname, 'postgres-access-allowlist.json');
const SCAN_DIRS = ['pages', 'lib', 'shared', 'modules'];
const JS_EXT_RE = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', '__tests__']);

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
  'unresolved-import',
  'driver-export',
];

// Q5 exemptions -- permanently allowed to import the driver, never ratcheted
// for ANY kind (skipped in checks (a)/(b)), and must not appear in the
// allowlist file. `scripts/**` is already outside SCAN_DIRS so it needs no
// exemption here.
const Q5_EXEMPT_FILES = new Set([
  'lib/utils/migration-drift.js',
  'lib/utils/health-checker.js',
]);

// The driver seam itself (plan §4 "One driver seam"): the ONLY module
// allowed to import a Postgres driver directly, so it is exempt for every
// kind, same as the Q5 files.
const SEAM_FILE = 'lib/postgres/client.js';

// Any OTHER file under lib/postgres/** (a store, per plan §4 "Per-domain
// stores") is exempt ONLY for the kinds that mean "used the seam's sql
// freely" -- it is still ratcheted like any other file for driver-import,
// driver-export, unresolved-import, and new-Pool, because those are exactly
// the ways a store could bypass the seam and touch the driver on its own
// (Codex Stage 2 finding: a blanket lib/postgres/** exemption would let a
// future `lib/postgres/stores/rogue.js` import `pg` directly and stay
// green, silently defeating "one driver seam").
const SEAM_USER_EXEMPT_KINDS = new Set([
  'sql-tag', 'sql.query', 'client.query', 'pool.query', 'db.connect', 'pool.connect', 'begin-literal',
]);

// True if (file, kind) is exempt from ratchet checks (a)/(b) and must NOT
// appear in the allowlist. Q5 files and the seam file are exempt for every
// kind; any other lib/postgres/** file is exempt only for the
// SEAM_USER_EXEMPT_KINDS.
function isExemptKind(rel, kind) {
  if (Q5_EXEMPT_FILES.has(rel) || rel === SEAM_FILE) return true;
  if (rel.startsWith('lib/postgres/')) return SEAM_USER_EXEMPT_KINDS.has(kind);
  return false;
}

// Q2/Q5 do not apply to recognition itself; this predicate matches the
// three driver module names named in the plan (§5 Stage 0 item 1, widened
// by Stage 1 review to include @neondatabase/serverless -- the transport
// @vercel/postgres itself sits on top of, per plan §3 Q1b) and any subpath
// of them (`pg/lib/client`, `@vercel/postgres/index`, ...).
const DRIVER_MODULE_ROOTS = ['pg', '@vercel/postgres', '@neondatabase/serverless'];
function isPostgresDriverSource(value) {
  if (typeof value !== 'string') return false;
  return DRIVER_MODULE_ROOTS.some((root) => value === root || value.startsWith(`${root}/`));
}

// ---- P2-3: one-hop module-source resolution ----------------------------

// Same-file, scope-insensitive map of `const`/`let X = '...'` string-literal
// bindings. Reassignment is not tracked (documented limitation): if a name
// is bound to more than one literal, the first one wins. This is a resolver
// for require()/import() SOURCE arguments only, not a general constant-
// folding pass.
const AMBIGUOUS_BINDING = Symbol('ambiguous-const-string-binding');

function buildConstStringMap(ast) {
  const map = new Map();
  walkAst(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
      && node.init && node.init.type === 'StringLiteral') {
      const name = node.id.name;
      if (map.has(name) && map.get(name) !== AMBIGUOUS_BINDING && map.get(name) !== node.init.value) {
        // More than one distinct same-file string binding of this name
        // (reassignment or a second declaration) -- resolving it to
        // "whichever came first" would be a silent guess, so it is marked
        // ambiguous instead: resolveSourceValue treats it as unresolved
        // (fails open, same as any other non-literal source), and the
        // unresolved-sources audit reports "(ambiguous)" rather than a
        // possibly-wrong literal.
        map.set(name, AMBIGUOUS_BINDING);
      } else if (!map.has(name)) {
        map.set(name, node.init.value);
      }
    }
  });
  return map;
}

// Resolves a require()/import() source ARGUMENT node to a string, either
// directly (a literal) or through one hop of the const-string map (a plain
// Identifier bound to a same-file string literal). Returns null if neither
// applies -- the source stays genuinely unresolved.
function resolveSourceValue(argNode, constMap) {
  const direct = stringLiteralValue(argNode);
  if (direct != null) return direct;
  if (argNode && argNode.type === 'Identifier' && constMap.has(argNode.name)) {
    const bound = constMap.get(argNode.name);
    // An ambiguous (multiply-bound) name resolves to nothing -- fails open,
    // same as any other non-literal source, rather than guessing.
    return bound === AMBIGUOUS_BINDING ? null : bound;
  }
  return null;
}

// Same-file, scope-insensitive set of local names bound to `require` itself
// -- `const load = require;`, `const load = module.require;`, or `const {
// require: r } = module;` -- so a call through one of them is recognized
// exactly like a literal `require(...)` call (Codex round 3: an aliased
// loader was previously invisible to every check below).
// True if `expr` is, or (once already discovered) resolves through the
// alias set to, `require` itself or `module.require`.
function isRequireLikeExpr(expr, names) {
  if (!expr) return false;
  if (expr.type === 'Identifier') return expr.name === 'require' || names.has(expr.name);
  if ((expr.type === 'MemberExpression' || expr.type === 'OptionalMemberExpression') && !expr.computed
    && expr.object.type === 'Identifier' && expr.object.name === 'module'
    && propName(expr.property) === 'require') {
    return true;
  }
  return false;
}

// Same-file, scope-insensitive FIXPOINT over declarations AND plain
// assignments: `const load = require;`, `let l; l = require;`, `const load2
// = load;` (any alias depth), `const { require: r } = module; const r2 =
// r;`, or `module.require` reached the same ways. Iterates to a fixpoint
// (not just one hop) because an alias can itself be re-aliased any number
// of times before use -- round 2 only resolved one hop, which a two-hop
// chain (`load2 = load`) evaded entirely (Codex round 3, narrow follow-up).
function buildRequireAliasNames(ast) {
  const names = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    walkAst(ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.init && node.id.type === 'Identifier') {
        if (!names.has(node.id.name) && isRequireLikeExpr(node.init, names)) {
          names.add(node.id.name);
          changed = true;
        }
        return;
      }
      if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') {
        if (!names.has(node.left.name) && isRequireLikeExpr(node.right, names)) {
          names.add(node.left.name);
          changed = true;
        }
        return;
      }
      if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init
        && node.init.type === 'Identifier' && node.init.name === 'module') {
        for (const prop of node.id.properties || []) {
          if (prop.type !== 'ObjectProperty' || prop.computed || prop.value.type !== 'Identifier') continue;
          if (propName(prop.key) === 'require' && !names.has(prop.value.name)) {
            names.add(prop.value.name);
            changed = true;
          }
        }
      }
    });
  }
  return names;
}

// A require-shaped call: a literal `require(...)`, a call through an
// aliased loader identifier (see buildRequireAliasNames), or a direct
// `module.require(...)` (no aliasing needed for this form).
function isBareRequireCall(node, requireAliasNames) {
  if (!node || node.type !== 'CallExpression' || node.arguments.length === 0) return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name === 'require' || !!(requireAliasNames && requireAliasNames.has(callee.name));
  }
  if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed
    && callee.object.type === 'Identifier' && callee.object.name === 'module'
    && propName(callee.property) === 'require') {
    return true;
  }
  return false;
}

// True if `node` is a require()/dynamic-import() call whose source resolves
// (directly or via the const-string map) to a module matching `isModuleSource`.
function isModuleCallResolved(node, constMap, isModuleSource, requireAliasNames) {
  if (isBareRequireCall(node, requireAliasNames)) return isModuleSource(resolveSourceValue(node.arguments[0], constMap));
  const dynamicSource = importCallSourceNode(node);
  if (dynamicSource) return isModuleSource(resolveSourceValue(dynamicSource, constMap));
  return false;
}

// Collects every require()/dynamic-import() call site in the file whose
// source argument is NOT itself a direct string literal (regardless of
// whether the one-hop resolver above could resolve it) -- surfaced for
// audit and ratcheted as the `unresolved-import` kind. See docblock.
function collectUnresolvedModuleSources(ast, constMap, requireAliasNames) {
  const out = [];
  walkAst(ast, (node) => {
    let argNode = null;
    if (isBareRequireCall(node, requireAliasNames)) argNode = node.arguments[0];
    else {
      const dynamicSource = importCallSourceNode(node);
      if (dynamicSource) argNode = dynamicSource;
    }
    if (!argNode) return;
    if (stringLiteralValue(argNode) != null) return; // a direct literal is not "unresolved"
    const line = (node.loc && node.loc.start && node.loc.start.line) || 0;
    const isAmbiguous = argNode && argNode.type === 'Identifier' && constMap.get(argNode.name) === AMBIGUOUS_BINDING;
    const resolved = isAmbiguous ? '(ambiguous)' : resolveSourceValue(argNode, constMap);
    out.push({ line, resolved });
  });
  out.sort((a, b) => a.line - b.line);
  return out;
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
// a known, tolerated over-approximation for Stage 0/1 (documented, not
// fixed): resolving `WITH <name> AS` bindings would require tracking scope,
// which is out of scope for a regex-based extractor. Reviewers reconciling
// this report's table list against scripts/setup-database.js / migrations
// should expect a handful of CTE-alias entries that are not real tables.
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

// ---- binding resolution (Stage 1 item 0 + P1 sql-tag widening) ---------

// sql-tag bindings are source-agnostic (P1): a `sql` (or renamed `sql`)
// import specifier or require()/dynamic-import() destructure resolves to a
// sql-tag local name no matter what module it comes from -- see docblock.
function bindSqlTagFromObjectPattern(id, bindings) {
  if (id.type !== 'ObjectPattern') return;
  for (const prop of id.properties || []) {
    if (prop.type !== 'ObjectProperty' || prop.value.type !== 'Identifier') continue;
    if (propName(prop.computed ? null : prop.key) === 'sql') bindings.set(prop.value.name, 'sql-tag');
  }
}

// Driver-scoped bindings (namespace / db / pool / pool-ctor) from an
// ImportDeclaration/require()/dynamic-import() destructure whose SOURCE is
// an actual driver import -- unlike sql-tag above, these stay scoped,
// because Q2/Q5 (what may hold a live pool/connection) do not extend to
// arbitrary re-exports.
function bindDriverScopedFromPattern(id, bindings) {
  if (id.type === 'Identifier') {
    bindings.set(id.name, 'namespace');
    return;
  }
  if (id.type === 'ObjectPattern') {
    for (const prop of id.properties || []) {
      if (prop.type !== 'ObjectProperty' || prop.value.type !== 'Identifier') continue;
      const key = propName(prop.computed ? null : prop.key);
      if (key === 'db') bindings.set(prop.value.name, 'db');
      else if (key === 'pool') bindings.set(prop.value.name, 'pool');
      else if (key === 'Pool') bindings.set(prop.value.name, 'pool-ctor');
    }
  }
}

function isPoolConstructorCall(node, bindings) {
  if (!node || node.type !== 'NewExpression' || !node.callee) return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    if (callee.name === 'Pool') return true;
    if (bindings.get(callee.name) === 'pool-ctor') return true;
    return false;
  }
  if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression')
    && !callee.computed
    && callee.object.type === 'Identifier'
    && bindings.get(callee.object.name) === 'namespace'
    && propName(callee.property) === 'Pool') {
    return true;
  }
  return false;
}

// Builds a per-file, scope-insensitive map of local identifier -> role
// ('sql-tag' | 'namespace' | 'db' | 'pool' | 'pool-ctor'). Passes:
//   1. sql-tag bindings, source-agnostic (P1) -- any ImportSpecifier or
//      require()/dynamic-import() destructure naming `sql`.
//   2. Driver-scoped bindings (namespace/db/pool/pool-ctor) from an actual
//      driver import/require/dynamic-import (source resolved per P2-3).
//   3. `new Pool()` (or `new <namespace>.Pool()` / `new <pool-ctor>()`)
//      assigned to a plain variable, which depends on pass 2's bindings.
function buildBindings(ast, constMap, requireAliasNames) {
  const bindings = new Map();

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportSpecifier' && propName(spec.imported) === 'sql') {
          bindings.set(spec.local.name, 'sql-tag');
        }
      }
      return;
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init) {
      const unwrapped = unwrapExpression(node.init);
      const isAnyModuleCall = isBareRequireCall(node.init, requireAliasNames) || isBareRequireCall(unwrapped, requireAliasNames)
        || !!importCallSourceNode(unwrapped);
      if (isAnyModuleCall) bindSqlTagFromObjectPattern(node.id, bindings);
    }
  });

  walkAst(ast, (node) => {
    if ((node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration')
      && node.source && isPostgresDriverSource(stringLiteralValue(node.source))) {
      if (node.type === 'ImportDeclaration') {
        for (const spec of node.specifiers || []) {
          if (spec.type === 'ImportSpecifier') {
            const imported = propName(spec.imported);
            if (imported === 'db') bindings.set(spec.local.name, 'db');
            else if (imported === 'pool') bindings.set(spec.local.name, 'pool');
            else if (imported === 'Pool') bindings.set(spec.local.name, 'pool-ctor');
          } else if (spec.type === 'ImportNamespaceSpecifier' || spec.type === 'ImportDefaultSpecifier') {
            bindings.set(spec.local.name, 'namespace');
          }
        }
      }
      return;
    }
  });

  walkAst(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    const unwrapped = unwrapExpression(node.init);
    if (isModuleCallResolved(node.init, constMap, isPostgresDriverSource, requireAliasNames)
      || isModuleCallResolved(unwrapped, constMap, isPostgresDriverSource, requireAliasNames)) {
      bindDriverScopedFromPattern(node.id, bindings);
    }
  });

  walkAst(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
      && isPoolConstructorCall(node.init, bindings)) {
      bindings.set(node.id.name, 'pool');
    }
  });

  // Alias-of-an-alias fixpoint (Codex round 3, narrow follow-up): a plain
  // identifier-to-identifier declaration or assignment (`const vp2 = vp;`,
  // `const p2 = pool;`, `p3 = p2;`) copies the source's role to the target,
  // repeated until nothing new is found so any alias depth resolves. This
  // was previously single-hop-only (in effect, not at all -- there was no
  // such pass) for namespace/db/pool/pool-ctor/sql-tag bindings, the same
  // gap `buildRequireAliasNames` had for `require` itself.
  let aliasChanged = true;
  while (aliasChanged) {
    aliasChanged = false;
    walkAst(ast, (node) => {
      let targetName = null;
      let sourceName = null;
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
        && node.init && node.init.type === 'Identifier') {
        targetName = node.id.name;
        sourceName = node.init.name;
      } else if (node.type === 'AssignmentExpression' && node.operator === '='
        && node.left.type === 'Identifier' && node.right.type === 'Identifier') {
        targetName = node.left.name;
        sourceName = node.right.name;
      } else {
        return;
      }
      if (!bindings.has(targetName) && bindings.has(sourceName)) {
        bindings.set(targetName, bindings.get(sourceName));
        aliasChanged = true;
      }
    });
  }

  return bindings;
}

// A bare identifier tag literally named `sql` ALWAYS counts (P1,
// source-agnostic); a renamed tag counts if the binding map resolved it to
// 'sql-tag' (also source-agnostic, see bindSqlTagFromObjectPattern /
// ImportSpecifier handling above). A MEMBER tag (`vp.sql\`...\``) counts
// only when `vp` is a driver namespace binding -- that one stays
// driver-scoped, since a bare namespace import of an arbitrary module is a
// much weaker signal than an explicit `sql` name.
function isSqlTagTag(tagNode, bindings) {
  if (tagNode.type === 'Identifier') {
    if (tagNode.name === 'sql') return true;
    return bindings.get(tagNode.name) === 'sql-tag';
  }
  if ((tagNode.type === 'MemberExpression' || tagNode.type === 'OptionalMemberExpression') && !tagNode.computed) {
    // Cosmetic widening: `X.sql\`...\`` counts as sql-tag regardless of
    // what `X` is bound to (not just a recognized driver namespace) --
    // verified zero live-count impact; a `.sql` property name is already a
    // strong, low-noise signal on its own.
    return propName(tagNode.property) === 'sql';
  }
  return false;
}

// Resolves the "role" (sql/client/pool/db) of a `.query()`/`.connect()`
// callee's object -- an Identifier bound via the file's binding map (a
// renamed db/pool import, or a variable holding a `new Pool()` result), an
// Identifier literally named sql/client/pool/db (preserves original
// unbound-identifier behavior), or a nested member access whose own
// property is one of those names (`this.pool`, `self.db`).
function resolveObjectRole(objectNode, bindings) {
  if (objectNode.type === 'Identifier') {
    const bound = bindings.get(objectNode.name);
    if (bound === 'pool' || bound === 'db') return bound;
    if (objectNode.name === 'sql' || objectNode.name === 'client'
      || objectNode.name === 'pool' || objectNode.name === 'db') {
      return objectNode.name;
    }
    return null;
  }
  if (objectNode.type === 'MemberExpression' || objectNode.type === 'OptionalMemberExpression') {
    if (objectNode.computed) return null;
    const prop = propName(objectNode.property);
    if (prop === 'sql' || prop === 'client' || prop === 'pool' || prop === 'db') return prop;
    return null;
  }
  return null;
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

// ---- driver-export: an allowlisted service laundering raw driver access
// out through its own exports (Codex round 2, P1) --------------------------

// A binding whose role is one of these is a live handle on the driver
// (a tagged-template function, a connect()-capable db/pool, a Pool
// constructor, or a whole driver namespace) -- exporting it verbatim, or
// returning it from an exported function, hands an arbitrary importer the
// same access the allowlisted file has, without that importer ever showing
// up in this gate's own import/tag/call scan.
const DRIVER_HANDLE_ROLES = new Set(['sql-tag', 'db', 'pool', 'pool-ctor', 'namespace']);

function isBareModuleExportsTarget(node) {
  return !!node && node.type === 'MemberExpression' && !node.computed
    && node.object.type === 'Identifier' && node.object.name === 'module'
    && propName(node.property) === 'exports';
}

// Local names that appear as the LOCAL side of a bare `export { name }` /
// `export { name as other }` specifier, or as a default-exported bare
// identifier -- used only to recognize `const name = () => sql; export
// { name };` as an exported function (the declaration site itself carries
// no export syntax, so it can't be seen by climbing parents alone).
function collectExportedLocalNames(ast) {
  const names = new Set();
  walkAst(ast, (node) => {
    if (node.type === 'ExportNamedDeclaration' && !node.source) {
      for (const spec of node.specifiers || []) {
        if (spec.type !== 'ExportSpecifier') continue;
        const localName = propName(spec.local);
        if (localName) names.add(localName);
      }
    }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration && node.declaration.type === 'Identifier') {
      names.add(node.declaration.name);
    }
  });
  return names;
}

// True if `node` (a Function/ArrowFunctionExpression/FunctionDeclaration) is
// itself in exported position: `export function f(){}`, `export default
// function(){}` / `export default () => ...`, `export const f = () =>
// ...`, or `const f = () => ...; export { f };`.
function isExportedFunctionNode(node, parentMap, exportedLocalNames) {
  if (node.type === 'FunctionDeclaration' && node.id && exportedLocalNames.has(node.id.name)) return true;
  const parent = parentMap.get(node);
  if (!parent) return false;
  if (parent.type === 'ExportDefaultDeclaration' && parent.declaration === node) return true;
  if (parent.type === 'ExportNamedDeclaration' && parent.declaration === node) return true;
  if (parent.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier') {
    if (exportedLocalNames.has(parent.id.name)) return true;
    const declaration = parentMap.get(parent); // VariableDeclaration
    const maybeExport = declaration && parentMap.get(declaration);
    if (maybeExport && maybeExport.type === 'ExportNamedDeclaration' && maybeExport.declaration === declaration) return true;
  }
  return false;
}

// Counts every export/re-export site that hands out a raw driver handle:
// (i) an identity export/re-export (`export { sql }`, `export default db`,
//     `module.exports.sql = sql`, `module.exports = { sql }`,
//     `exports.pool = pool`) whose exported value is a role-bound
//     identifier; (ii) an exported function whose body returns such an
//     identifier directly (`export function getRawSql() { return sql; }`).
// Scope-insensitive, same as the rest of this scanner (see docblock).
// Counts direct returns of a role-bound identifier inside one function-like
// node: an ArrowFunctionExpression (block or implicit-return body), a
// FunctionExpression/FunctionDeclaration, or an ObjectMethod (always a
// block body). Shared by both the ESM exported-function pass and the CJS
// accessor-export pass below -- a function is a function regardless of how
// it got attached to an export.
function countDirectReturnRole(fnLikeNode, bindings) {
  let n = 0;
  if (fnLikeNode.type === 'ArrowFunctionExpression' && fnLikeNode.body.type !== 'BlockStatement') {
    // Implicit-return arrow, e.g. `() => sql`.
    if (fnLikeNode.body.type === 'Identifier' && DRIVER_HANDLE_ROLES.has(bindings.get(fnLikeNode.body.name))) n += 1;
    return n;
  }
  if (!fnLikeNode.body) return n;
  walkAst(fnLikeNode.body, (inner) => {
    if (inner.type === 'ReturnStatement' && inner.argument && inner.argument.type === 'Identifier'
      && DRIVER_HANDLE_ROLES.has(bindings.get(inner.argument.name))) {
      n += 1;
    }
  });
  return n;
}

function isFunctionLikeNode(node) {
  return !!node && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod');
}

function countDriverExports(ast, bindings) {
  let count = 0;

  walkAst(ast, (node) => {
    if (node.type === 'ExportNamedDeclaration' && !node.source) {
      for (const spec of node.specifiers || []) {
        if (spec.type !== 'ExportSpecifier') continue;
        const localName = propName(spec.local);
        if (localName && DRIVER_HANDLE_ROLES.has(bindings.get(localName))) count += 1;
      }
      return;
    }
    if (node.type === 'ExportDefaultDeclaration') {
      if (node.declaration && node.declaration.type === 'Identifier'
        && DRIVER_HANDLE_ROLES.has(bindings.get(node.declaration.name))) {
        count += 1;
      }
      return;
    }
    if (node.type === 'AssignmentExpression') {
      const left = node.left;
      const right = node.right;
      if (isBareModuleExportsTarget(left)) {
        if (right.type === 'Identifier' && DRIVER_HANDLE_ROLES.has(bindings.get(right.name))) {
          count += 1;
        } else if (isFunctionLikeNode(right)) {
          // `module.exports = () => sql;` / `module.exports = function () { return sql; };`
          count += countDirectReturnRole(right, bindings);
        } else if (right.type === 'ObjectExpression') {
          for (const prop of right.properties || []) {
            if (prop.computed) continue;
            if (prop.type === 'ObjectMethod') {
              // `module.exports = { getRawSql() { return sql; } }`
              count += countDirectReturnRole(prop, bindings);
              continue;
            }
            if (prop.type !== 'ObjectProperty' || !prop.value) continue;
            if (prop.value.type === 'Identifier' && DRIVER_HANDLE_ROLES.has(bindings.get(prop.value.name))) {
              count += 1;
            } else if (isFunctionLikeNode(prop.value)) {
              // `module.exports = { getRawSql: () => sql }`
              count += countDirectReturnRole(prop.value, bindings);
            }
          }
        }
      } else if (isMember(left) && isCommonJsExportTarget(left)) {
        // module.exports.X = ... / exports.X = ... (single named property)
        if (right.type === 'Identifier' && DRIVER_HANDLE_ROLES.has(bindings.get(right.name))) {
          count += 1;
        } else if (isFunctionLikeNode(right)) {
          // `module.exports.getRawSql = () => sql;` /
          // `exports.getRawSql = function () { return sql; };`
          count += countDirectReturnRole(right, bindings);
        }
      }
      return;
    }
  });

  const parentMap = buildParentMap(ast);
  const exportedLocalNames = collectExportedLocalNames(ast);
  walkAst(ast, (node) => {
    if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression' && node.type !== 'ArrowFunctionExpression') return;
    if (!isExportedFunctionNode(node, parentMap, exportedLocalNames)) return;
    count += countDirectReturnRole(node, bindings);
  });

  return count;
}

// ---- Q6 cast-lint (warn-only) ------------------------------------------

const CAST_LINT_TOKEN_RE = /\b(jsonb_build_object|jsonb_build_array|concat|format)\s*\(|\bVALUES\s*\(|\bCASE\b|\bEND\b|[()]/gi;

// Canonical report label for each trigger token.
const CAST_LINT_KIND_LABELS = {
  jsonb_build_object: 'jsonb_build_object',
  jsonb_build_array: 'jsonb_build_array',
  concat: 'concat',
  format: 'format',
  values: 'VALUES',
  case: 'CASE',
};

// Best-effort lexical scan (not a real SQL parser, documented limitation):
// walks the template's quasis left to right tracking (1) a stack of
// paren-delimited "cast-sensitive" regions opened by
// jsonb_build_object(/jsonb_build_array(/concat(/format(/VALUES( and closed
// by their matching `)`, and (2) a CASE/END depth counter. At each `${...}`
// placeholder, if either is active and the immediately following quasi text
// (after leading whitespace) does not start with `::`, the placeholder is
// warned and tagged with the innermost active region's kind (paren regions
// take priority over an enclosing CASE, since they are more specific).
function scanCastLintWarnings(taggedTemplate, rel, warnings) {
  const quasis = taggedTemplate.quasi.quasis;
  const exprs = taggedTemplate.quasi.expressions;
  let parenDepth = 0;
  const activeRegions = []; // [{ kind, openDepth }]
  let caseDepth = 0;

  for (let i = 0; i < quasis.length; i++) {
    const text = quasis[i].value.cooked ?? quasis[i].value.raw;
    CAST_LINT_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = CAST_LINT_TOKEN_RE.exec(text))) {
      const tok = match[0].toLowerCase();
      if (tok === '(') {
        parenDepth += 1;
      } else if (tok === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        while (activeRegions.length && activeRegions[activeRegions.length - 1].openDepth > parenDepth) {
          activeRegions.pop();
        }
      } else if (tok === 'case') {
        caseDepth += 1;
      } else if (tok === 'end') {
        caseDepth = Math.max(0, caseDepth - 1);
      } else {
        // one of the paren-opening keyword tokens (already includes the `(`)
        parenDepth += 1;
        const keyword = match[1] ? match[1].toLowerCase() : 'values';
        activeRegions.push({ kind: CAST_LINT_KIND_LABELS[keyword] || keyword, openDepth: parenDepth });
      }
    }

    if (i < exprs.length) {
      const kind = activeRegions.length ? activeRegions[activeRegions.length - 1].kind
        : (caseDepth > 0 ? 'CASE' : null);
      if (kind) {
        const nextText = quasis[i + 1] ? (quasis[i + 1].value.cooked ?? quasis[i + 1].value.raw) : '';
        const followedByCast = /^\s*::/.test(nextText);
        if (!followedByCast) {
          const line = (exprs[i].loc && exprs[i].loc.start.line)
            || (quasis[i].loc && quasis[i].loc.start.line) || 0;
          warnings.push({ file: rel, line, kind });
        }
      }
    }
  }
}

// Classify one already-parsed file. Returns { kinds: Map<kind,count>,
// tables: Set<string>, castWarnings: Array<{file,line,kind}>,
// unresolved: Array<{line,resolved}> }.
function classifyFile(ast, rel) {
  const kinds = new Map();
  const tables = new Set();
  const castWarnings = [];
  const bump = (kind, n = 1) => kinds.set(kind, (kinds.get(kind) || 0) + n);
  const constMap = buildConstStringMap(ast);
  const requireAliasNames = buildRequireAliasNames(ast);
  const bindings = buildBindings(ast, constMap, requireAliasNames);
  const unresolved = collectUnresolvedModuleSources(ast, constMap, requireAliasNames);
  if (unresolved.length) bump('unresolved-import', unresolved.length);
  const driverExportCount = countDriverExports(ast, bindings);
  if (driverExportCount) bump('driver-export', driverExportCount);

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

    // require(<driver>) / dynamic import(<driver>), source resolved
    // directly or through the one-hop const-string map (P2-3).
    if (isModuleCallResolved(node, constMap, isPostgresDriverSource, requireAliasNames)) {
      bump('driver-import');
      return;
    }

    if (node.type === 'TaggedTemplateExpression' && node.tag
      && isSqlTagTag(node.tag, bindings)) {
      bump('sql-tag');
      const text = quasisText(node.quasi);
      extractTables(text, tables);
      if (firstQuasiTrimmed(node.quasi).toUpperCase().startsWith('BEGIN')) bump('begin-literal');
      scanCastLintWarnings(node, rel, castWarnings);
      return;
    }

    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee && (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed) {
        const property = propName(callee.property);
        if (property === 'query') {
          const role = resolveObjectRole(callee.object, bindings);
          if (role === 'sql' || role === 'client' || role === 'pool') {
            bump(`${role}.query`);
            const arg = node.arguments && node.arguments[0];
            const literal = arg ? stringLiteralValue(arg) : null;
            if (literal) extractTables(literal, tables);
            if (firstArgIsBegin(node)) bump('begin-literal');
            return;
          }
        } else if (property === 'connect') {
          const role = resolveObjectRole(callee.object, bindings);
          if (role === 'db' || role === 'pool') {
            bump(`${role}.connect`);
            return;
          }
        }
      }
    }

    if (node.type === 'NewExpression' && isPoolConstructorCall(node, bindings)) {
      bump('new-Pool');
    }
  });

  return { kinds, tables, castWarnings, unresolved };
}

// Shared file walker/skip rules for both the main census scan and the
// pages/api -> lib/postgres ratchet check (c) -- P2 cosmetic fix: the two
// must never disagree about which files are in scope.
function walkJsFiles(baseDir, out) {
  if (!fs.existsSync(baseDir)) return;
  walk(baseDir);
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) continue;
        walk(full);
        continue;
      }
      if (!ent.isFile() || !JS_EXT_RE.test(ent.name)) continue;
      if (/\.test\./.test(ent.name)) continue;
      out.push(full);
    }
  }
}

function collectFiles(root) {
  const files = [];
  for (const relDir of SCAN_DIRS) {
    walkJsFiles(path.join(root, relDir), files);
  }
  return files.sort((a, b) => toRel(root, a).localeCompare(toRel(root, b)));
}

function topDir(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'pages' && parts[1] === 'api') return 'pages/api';
  if (parts[0] === 'lib' && parts[1]) return `lib/${parts[1]}`;
  return parts[0];
}

function analyzeRoot(root) {
  const files = collectFiles(root);
  const records = [];
  const allCastWarnings = [];
  const allUnresolved = [];
  for (const full of files) {
    const rel = toRel(root, full);
    const source = fs.readFileSync(full, 'utf8');
    let ast;
    try {
      ast = parseModule(source);
    } catch (err) {
      throw new Error(`postgres-access-layer parse error in ${rel}: ${err.message}`);
    }
    const { kinds, tables, castWarnings, unresolved } = classifyFile(ast, rel);
    if (castWarnings.length) allCastWarnings.push(...castWarnings);
    if (unresolved.length) allUnresolved.push(...unresolved.map((u) => ({ file: rel, ...u })));
    if (kinds.size === 0) continue; // nothing recognized (an unresolved source now bumps 'unresolved-import')
    records.push({ file: rel, kinds, tables: [...tables].sort(), unresolved });
  }
  records.sort((a, b) => a.file.localeCompare(b.file));
  allCastWarnings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  allUnresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { records, castWarnings: allCastWarnings, unresolved: allUnresolved };
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
    totalFilesInCensus: records.filter((r) => r.kinds.size > 0).length,
  };
}

function formatReport(records, castWarnings, unresolved, castLintDetail) {
  const summary = buildSummary(records);
  const lines = [
    'Postgres access-layer census (Stage 1 -- ratchet law; see exit code)',
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
    if (rec.kinds.size === 0) continue;
    const kindsStr = [...rec.kinds.entries()].map(([k, c]) => `${k}:${c}`).join(', ');
    lines.push(`| ${rec.file} | ${kindsStr} | ${rec.tables.join(', ')} |`);
  }

  lines.push('', '## Cast-lint warnings (Q6, warn-only -- no exit-code effect)', '', `Total: ${castWarnings.length}`, '');
  if (castWarnings.length) {
    const byKind = new Map();
    const byFileKind = new Map();
    for (const w of castWarnings) {
      byKind.set(w.kind, (byKind.get(w.kind) || 0) + 1);
      const fkKey = `${w.file}::${w.kind}`;
      byFileKind.set(fkKey, (byFileKind.get(fkKey) || 0) + 1);
    }
    lines.push('| Region kind | Count |', '|---|---:|');
    for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      lines.push(`| ${kind} | ${count} |`);
    }
    lines.push('', '| File | Region kind | Count |', '|---|---|---:|');
    for (const [key, count] of [...byFileKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [file, kind] = key.split('::');
      lines.push(`| ${file} | ${kind} | ${count} |`);
    }
    if (castLintDetail) {
      lines.push('', '### Full rows (--cast-lint-detail)', '', '| File | Line | Region kind |', '|---|---:|---|');
      for (const w of castWarnings) lines.push(`| ${w.file} | ${w.line} | ${w.kind} |`);
    }
  }

  lines.push('', '## Unresolved module sources (ratcheted as kind `unresolved-import`; rows below explain the per-file count)', '', `Total: ${unresolved.length}`, '');
  if (unresolved.length) {
    lines.push('| File | Line | One-hop resolution |', '|---|---:|---|');
    for (const u of unresolved) lines.push(`| ${u.file} | ${u.line} | ${u.resolved != null ? u.resolved : '(unresolved)'} |`);
  }

  return lines.join('\n');
}

function buildJson(records, castWarnings, unresolved) {
  const summary = buildSummary(records);
  return {
    driverFileTotal: summary.driverFileTotal,
    driverFilesByDir: Object.fromEntries(summary.driverFilesByDir),
    sqlTagFiles: summary.sqlTagFiles,
    sqlTagTotal: summary.sqlTagTotal,
    kindTotals: Object.fromEntries(summary.kindTotals),
    totalFilesInCensus: summary.totalFilesInCensus,
    // Cosmetic (3): only files with at least one recognized kind belong
    // here -- a file whose only auditable content is an unresolved module
    // source (no kind at all) is not "in the census" and appears solely in
    // the top-level `unresolved` array below.
    files: records.filter((rec) => rec.kinds.size > 0).map((rec) => ({
      file: rec.file,
      kinds: Object.fromEntries(rec.kinds),
      tables: rec.tables,
      unresolved: rec.unresolved,
    })),
    castLint: castWarnings,
    unresolved,
  };
}

// ---- Stage 1 ratchet ----------------------------------------------------

// Throws (-> exit 2) on a malformed allowlist: a duplicate (file,kind) key,
// or an entry -- other than a `_comment` metadata entry -- missing any of
// file/kind/count.
function loadAllowlist(allowlistPath) {
  if (!fs.existsSync(allowlistPath)) {
    throw new Error(`allowlist not found: ${allowlistPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`allowlist must be a JSON array: ${allowlistPath}`);

  const entries = [];
  const seenKeys = new Set();
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && '_comment' in entry && !('file' in entry) && !('kind' in entry)) {
      continue; // pure metadata entry
    }
    if (!entry || typeof entry !== 'object'
      || typeof entry.file !== 'string' || !entry.file
      || typeof entry.kind !== 'string' || !entry.kind
      || typeof entry.count !== 'number') {
      throw new Error(`malformed allowlist entry (missing file/kind/count): ${JSON.stringify(entry)}`);
    }
    const key = `${entry.file}::${entry.kind}`;
    if (seenKeys.has(key)) {
      throw new Error(`duplicate allowlist entry: ${entry.file} (${entry.kind})`);
    }
    seenKeys.add(key);
    entries.push(entry);
  }
  return entries;
}

// Reads the raw import/require/dynamic-import source string off any node
// that carries one, for the pages/api -> lib/postgres direct-import check.
// Resolves the same one hop as classification (P2-3) so a route cannot dodge
// this check by aliasing the path through a same-file const.
function importSourceOf(node, constMap) {
  if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
    return stringLiteralValue(node.source);
  }
  if (isBareRequireCall(node)) {
    return resolveSourceValue(node.arguments[0], constMap);
  }
  const dynamicSource = importCallSourceNode(node);
  if (dynamicSource) return resolveSourceValue(dynamicSource, constMap);
  return null;
}

// P2-4: match `lib/postgres` as a path SEGMENT, not merely a substring, so
// both `.../lib/postgres` (index) and `.../lib/postgres/client` count, but
// e.g. `.../lib/postgres-legacy` does not.
const LIB_POSTGRES_IMPORT_RE = /(^|\/)lib\/postgres(\/|$)/;

// Check (c): any pages/api/** file importing lib/postgres/** directly. A
// clean no-op while lib/postgres/ does not exist in the tree under `root`.
// Shares walkJsFiles with the main census scan (cosmetic fix) so the two
// scans can never disagree about which files are in scope.
function checkPagesApiPostgresImports(root) {
  const violations = [];
  if (!fs.existsSync(path.join(root, 'lib', 'postgres'))) return violations;
  const files = [];
  walkJsFiles(path.join(root, 'pages', 'api'), files);

  for (const full of files) {
    const rel = toRel(root, full);
    let ast;
    try {
      ast = parseModule(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      continue; // parse failures are reported separately by analyzeRoot
    }
    const constMap = buildConstStringMap(ast);
    walkAst(ast, (node) => {
      const source = importSourceOf(node, constMap);
      if (source && LIB_POSTGRES_IMPORT_RE.test(source)) {
        violations.push(`pages/api route imports lib/postgres/** directly: ${rel} (source: "${source}")`);
      }
    });
  }
  return violations;
}

function runRatchet(records, allowlist, root) {
  const violations = [];
  const allowMap = new Map();
  for (const entry of allowlist) {
    allowMap.set(`${entry.file}::${entry.kind}`, entry.count);
  }

  const censusMap = new Map();
  for (const rec of records) {
    for (const [kind, count] of rec.kinds) {
      if (isExemptKind(rec.file, kind)) continue;
      censusMap.set(`${rec.file}::${kind}`, count);
    }
  }

  // (a) every census (file,kind) must be allowed, at or under its count.
  for (const [key, count] of censusMap) {
    const [file, kind] = key.split('::');
    const allowed = allowMap.get(key);
    if (allowed === undefined || count > allowed) {
      if (kind === 'unresolved-import') {
        violations.push(`${file} (unresolved-import): computed module source — the Postgres ratchet cannot see what it loads; either use a literal specifier or, if this is a deliberate bundler bypass, add the key to scripts/postgres-access-allowlist.json in a reviewed commit`);
      } else if (allowed === undefined) {
        violations.push(`not in allowlist: ${file} (${kind}) count=${count}`);
      } else {
        violations.push(`census count exceeds allowlist: ${file} (${kind}) census=${count} allowed=${allowed}`);
      }
    }
  }

  // (b) every allowlist (file,kind) must still exist, at or under its count.
  for (const [key, allowed] of allowMap) {
    const [file, kind] = key.split('::');
    if (isExemptKind(file, kind)) {
      violations.push(`allowlist must not list an exempt file: ${file} (${kind})`);
      continue;
    }
    const count = censusMap.get(key);
    if (count === undefined) {
      violations.push(`stale entry -- shrink the allowlist: ${file} (${kind}) allowlist=${allowed}, no longer present in the census`);
    } else if (allowed > count) {
      violations.push(`stale entry -- shrink the allowlist: ${file} (${kind}) allowlist=${allowed} exceeds census=${count}`);
    }
  }

  // (c) pages/api -> lib/postgres/** direct import.
  violations.push(...checkPagesApiPostgresImports(root));

  return violations;
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_ROOT,
    allowlist: DEFAULT_ALLOWLIST_PATH,
    report: false,
    json: false,
    selfTest: false,
    castLintDetail: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root requires a directory');
      args.root = path.resolve(value);
    } else if (arg === '--allowlist') {
      const value = argv[++i];
      if (!value) throw new Error('--allowlist requires a path');
      args.allowlist = path.resolve(value);
    } else if (arg === '--report') {
      args.report = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--cast-lint-detail') {
      args.castLintDetail = true;
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
    'Usage: node scripts/check-postgres-access-layer.js [--root <dir>] [--allowlist <path>] [--report] [--json] [--cast-lint-detail] [--self-test]',
    '',
    'Stage 1 ratchet gate (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).',
    'Default mode, --report, and --json all APPLY the ratchet against',
    'scripts/postgres-access-allowlist.json (or --allowlist) and exit 1 on',
    'any violation. Parse failure or a malformed allowlist is always exit 2.',
    '--report prints dir/kind rollups, the full per-file table, Q6 cast-lint',
    '  per-kind/per-file totals, and unresolved module sources (both audit',
    '  sections, no exit-code effect).',
    '--json prints the same data as JSON (full castLint/unresolved rows).',
    '  If both --json and --report are given, the report goes to stderr so',
    '  stdout stays valid JSON.',
    '--cast-lint-detail adds the full per-line cast-lint rows to --report.',
    '--self-test builds isolated fixture trees (and, for ratchet fixtures,',
    '  isolated allowlists) under os.tmpdir(), verifies every recognized',
    '  kind including the Stage 1 binding-resolution fixes, the ratchet',
    '  pass/fail cases, and the Q6 warn scan, then cleans up.',
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

function runJson(tempRoot, allowlistPath) {
  const args = [__filename, '--root', tempRoot, '--json'];
  if (allowlistPath) args.push('--allowlist', allowlistPath);
  try {
    const output = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output, json: JSON.parse(output) };
  } catch (err) {
    return { status: err.status, output: err.stdout, stderr: err.stderr, json: err.stdout ? JSON.parse(err.stdout) : null };
  }
}

function runDefault(tempRoot, allowlistPath) {
  const args = [__filename, '--root', tempRoot];
  if (allowlistPath) args.push('--allowlist', allowlistPath);
  try {
    const output = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output, stderr: '' };
  } catch (err) {
    return { status: err.status, output: err.stdout || '', stderr: err.stderr ? err.stderr.toString() : '' };
  }
}

function writeAllowlist(tempDir, entries) {
  const p = path.join(tempDir, `allowlist-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(entries, null, 2));
  return p;
}

function runClassificationSelfTest() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-access-layer-selftest-'));
  try {
    write(tempRoot, 'lib/services/plain-import.js', `
      import { sql } from '@vercel/postgres';
      export async function get() {
        return sql\`SELECT 1 FROM user_profiles\`;
      }
    `);

    // Namespace import + member tag: item 0(a) form 3 -- now recognized.
    write(tempRoot, 'lib/services/namespace-import.js', `
      import * as pgDriver from '@vercel/postgres';
      export async function get() {
        return pgDriver.sql\`SELECT 1\`;
      }
    `);

    // require() bound to a plain identifier + member tag: item 0(a) form 4.
    write(tempRoot, 'lib/services/cjs-require.js', `
      const postgres = require('@vercel/postgres');
      module.exports.run = () => postgres.sql\`SELECT 1\`;
    `);

    write(tempRoot, 'lib/services/destructured-require.js', `
      const { sql } = require('@vercel/postgres');
      module.exports.run = () => sql\`SELECT 1 FROM system_alerts\`;
    `);

    // Barrel + consumer: P1 fix -- sql-tag recognition is source-agnostic,
    // so the consumer's `sql\`...\`` counts as sql-tag even though its
    // import source is the barrel, not the driver directly. This is the
    // exact evasion the fix closes (re-exporting `sql` through an arbitrary
    // file). driver-import itself still does NOT propagate through the
    // barrel (documented, unrelated design choice).
    write(tempRoot, 'lib/services/barrel.js', `
      export { sql } from '@vercel/postgres';
    `);
    write(tempRoot, 'lib/services/barrel-consumer.js', `
      import { sql } from './barrel';
      export async function get() {
        return sql\`SELECT 1 FROM barrel_table\`;
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

    // Comment-only member-tag mention: rule 12 still applies after widening
    // sql-tag recognition -- a comment is not an AST edge.
    write(tempRoot, 'lib/services/comment-only-vp-sql.js', `
      // Formerly: import * as vp from '@vercel/postgres'; vp.sql\`SELECT 1\`;
      module.exports.run = () => 1;
    `);

    // Item 0(a) form 1: renamed destructured import.
    write(tempRoot, 'lib/services/alias-import.js', `
      import { sql as q } from '@vercel/postgres';
      export async function get() {
        return q\`SELECT 1 FROM aliased_table\`;
      }
    `);
    // Item 0(a) form 2: renamed require destructure.
    write(tempRoot, 'lib/services/alias-require.js', `
      const { sql: q } = require('@vercel/postgres');
      module.exports.run = () => q\`SELECT 1\`;
    `);

    write(tempRoot, 'lib/services/sql-query-call.js', `
      import { sql } from '@vercel/postgres';
      export async function run(id) {
        return sql.query('SELECT 1 FROM foo WHERE id = $1', [id]);
      }
    `);

    write(tempRoot, 'lib/services/pool-connect.js', `
      const { Pool } = require('pg');
      module.exports.run = async () => {
        const pool = new Pool();
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
      };
    `);

    // Item 0(b): new pg.Pool() -- member-callee form.
    write(tempRoot, 'lib/services/pg-namespace-pool.js', `
      const pg = require('pg');
      const pool = new pg.Pool();
      module.exports.run = () => pool.query('SELECT 1 FROM widget_requests');
    `);

    // P2-5: renamed Pool specifier / require destructure.
    write(tempRoot, 'lib/services/renamed-pool-import.js', `
      import { Pool as P } from 'pg';
      const pool = new P();
      module.exports.run = () => pool.query('SELECT 1 FROM renamed_pool_table');
    `);
    write(tempRoot, 'lib/services/renamed-pool-require.js', `
      const { Pool: P } = require('pg');
      const pool = new P();
      module.exports.run = () => pool.query('SELECT 1');
    `);

    // Item 0(c) form 1: nested member path, this.pool.query(...).
    write(tempRoot, 'lib/services/nested-pool-query.js', `
      const { Pool } = require('pg');
      class Service {
        constructor() { this.pool = new Pool(); }
        async run() {
          return this.pool.query('SELECT 1 FROM nested_table');
        }
      }
      module.exports = Service;
    `);

    // Item 0(c) form 2: nested member path, self.db.connect().
    write(tempRoot, 'lib/services/nested-db-connect.js', `
      const { db } = require('@vercel/postgres');
      const self = { db };
      module.exports.run = async () => {
        const client = await self.db.connect();
        await client.query('SELECT 1');
        client.release();
      };
    `);

    // Item 0(c) form 3: p.connect() where p is bound to a new Pool() result.
    write(tempRoot, 'lib/services/pool-var-connect.js', `
      const { Pool } = require('pg');
      module.exports.run = async () => {
        const p = new Pool();
        const client = await p.connect();
        await client.query('SELECT 1');
        client.release();
      };
    `);

    // Item 0(c) form 4: p.connect() where p is bound to an imported `db`
    // under a renamed local name.
    write(tempRoot, 'lib/services/imported-db-var-connect.js', `
      const { db: p } = require('@vercel/postgres');
      module.exports.run = async () => {
        const client = await p.connect();
        await client.query('SELECT 1');
        client.release();
      };
    `);

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

    // Q6 cast-lint: one warned jsonb_build_object placeholder (no cast), one
    // safe (::text cast immediately follows, inside the same region).
    write(tempRoot, 'lib/services/cast-lint-cases.js', `
      import { sql } from '@vercel/postgres';
      export async function run(id, name) {
        await sql\`SELECT jsonb_build_object('id', \${id})\`;
        await sql\`SELECT jsonb_build_object('name', \${name}::text)\`;
      }
    `);

    // P2-2: @neondatabase/serverless and driver subpaths.
    write(tempRoot, 'lib/services/neon-driver.js', `
      import { sql } from '@neondatabase/serverless';
      module.exports = { run: () => sql\`SELECT 1\` };
    `);
    write(tempRoot, 'lib/services/pg-subpath.js', `
      const { Client } = require('pg/lib/client');
      module.exports.run = () => new Client();
    `);
    write(tempRoot, 'lib/services/vercel-postgres-subpath.js', `
      const { sql } = require('@vercel/postgres/index');
      module.exports.run = () => sql\`SELECT 1\`;
    `);

    // P2-3: non-literal source resolved one hop through a same-file const.
    write(tempRoot, 'lib/services/resolved-const-require.js', `
      const driverName = '@vercel/postgres';
      const { sql } = require(driverName);
      module.exports.run = () => sql\`SELECT 1\`;
    `);

    // P2-3: genuinely unresolved dynamic import source (a function
    // parameter, not a same-file const) -- must be reported as unresolved,
    // must NOT fail the gate, and must NOT be recognized as a driver import.
    write(tempRoot, 'lib/services/unresolved-dynamic-import.js', `
      export async function loadFallback(fallbackModule) {
        const mod = await import(fallbackModule);
        return mod;
      }
    `);
    // A non-postgres one-hop-resolved require (mirrors the live bundler-
    // bypass pattern: const fsName = 'fs'; require(fsName)) -- resolves,
    // but to a non-driver module, so no driver-import record, and it still
    // appears in the unresolved-sources audit list (the ARGUMENT itself is
    // not a literal, even though it resolves).
    write(tempRoot, 'lib/services/resolved-non-driver-require.js', `
      function loadFs() {
        const fsName = 'fs';
        return require(fsName);
      }
      module.exports = { loadFs };
    `);

    write(tempRoot, 'pages/api/health.js', `
      import { sql } from '@vercel/postgres';
      export default async function handler(req, res) {
        res.json(await sql\`SELECT 1\`);
      }
    `);

    // P2-B: pin the bare-unbound-`sql`-tag case with NO import/require of
    // any kind in the file at all -- a regression here (e.g. accidentally
    // re-requiring a driver import before counting) would otherwise go
    // unnoticed since every other sql-tag fixture also has an import.
    write(tempRoot, 'lib/services/bare-sql-param.js', `
      export const f = (sql) => sql\`SELECT 1 FROM bare_param_table\`;
    `);
    write(tempRoot, 'lib/services/bare-sql-from-call.js', `
      const sql = neon(url);
      module.exports.run = () => sql\`SELECT 1 FROM bare_call_table\`;
    `);

    // Codex round 2, P1: a computed module specifier
    // (`['@vercel','postgres'].join('/')`) evades driver-import recognition
    // entirely -- the require() argument is an Identifier whose init is a
    // CallExpression, not a string literal, so it never lands in the
    // const-string map either. It must be caught as `unresolved-import`.
    write(tempRoot, 'lib/services/computed-driver-require.js', `
      const packageName = ['@vercel','postgres'].join('/');
      const driver = require(packageName);
      module.exports.run = () => driver['sql']\`SELECT 1\`;
    `);

    // Codex round 2, P1: driver-export -- laundering raw driver access back
    // out through an allowlisted service's own exports.
    write(tempRoot, 'lib/services/raw-sql-getter.js', `
      import { sql } from '@vercel/postgres';
      export function getRawSql() { return sql; }
    `);
    write(tempRoot, 'lib/services/reexport-sql.js', `
      import { sql } from '@vercel/postgres';
      export { sql };
    `);
    // A service that USES sql internally but never hands out the raw
    // binding -- must stay green (no driver-export record at all).
    write(tempRoot, 'lib/services/uses-sql-internally.js', `
      import { sql } from '@vercel/postgres';
      export async function getWidgets() {
        return sql\`SELECT * FROM widget_requests\`;
      }
    `);

    // Codex round 3, P1 shape 1: CJS accessor exports -- a function
    // expression/arrow/method assigned to a CJS export target, or a
    // function-valued property in a `module.exports = { ... }` object.
    write(tempRoot, 'lib/services/cjs-getter-property-assign.js', `
      const { sql } = require('@vercel/postgres');
      module.exports.getRawSql = () => sql;
    `);
    write(tempRoot, 'lib/services/cjs-getter-exports-fn.js', `
      const { sql } = require('@vercel/postgres');
      exports.getRawSql = function () { return sql; };
    `);
    write(tempRoot, 'lib/services/cjs-getter-object-method.js', `
      const { sql } = require('@vercel/postgres');
      module.exports = {
        getRawSql() { return sql; },
      };
    `);
    write(tempRoot, 'lib/services/cjs-getter-object-arrow.js', `
      const { sql } = require('@vercel/postgres');
      module.exports = { getRawSql: () => sql };
    `);
    // CJS control: uses sql internally, never returns/exports it raw.
    write(tempRoot, 'lib/services/cjs-uses-sql-internally.js', `
      const { sql } = require('@vercel/postgres');
      module.exports.getWidgets = () => sql\`SELECT * FROM widget_requests\`;
    `);

    // Codex round 3, P1 shape 2: aliased require hides a literal/computed
    // load from every check that only recognized the bare identifier
    // `require`.
    write(tempRoot, 'lib/services/aliased-require-literal.js', `
      const load = require;
      const d = load('pg');
      const pool = new d.Pool();
      module.exports.run = () => pool.query('SELECT 1 FROM aliased_table');
    `);
    write(tempRoot, 'lib/services/aliased-require-computed.js', `
      function getName() { return '@vercel/postgres'; }
      const load = require;
      const packageName = getName();
      const driver = load(packageName);
      module.exports.run = () => driver;
    `);
    write(tempRoot, 'lib/services/module-dot-require.js', `
      const { sql } = module.require('@vercel/postgres');
      module.exports.run = () => sql\`SELECT 1\`;
    `);

    // Codex round 3 (narrow follow-up): a TWO-HOP require alias
    // (load -> load2) with a literal source. `Client` is not a recognized
    // role today (only `Pool` is), so `new driver.Client()` produces no
    // kind of its own -- only driver-import is expected here.
    write(tempRoot, 'lib/services/two-hop-require-literal.js', `
      const load = require;
      const load2 = load;
      const driver = load2('pg');
      module.exports.run = () => new driver.Client();
    `);

    // Three-hop alias with a COMPUTED source -- must be unresolved-import,
    // not driver-import.
    write(tempRoot, 'lib/services/three-hop-require-computed.js', `
      function getName() { return '@vercel/postgres'; }
      const load = require;
      const load2 = load;
      const load3 = load2;
      const packageName = getName();
      const driver = load3(packageName);
      module.exports.run = () => driver;
    `);

    // Two-hop NAMESPACE alias member tag: vp bound via the import, vp2
    // aliased to vp, then tagged as `vp2.sql\`...\``.
    write(tempRoot, 'lib/services/two-hop-namespace-alias.js', `
      import * as vp from '@vercel/postgres';
      const vp2 = vp;
      export const run = () => vp2.sql\`SELECT 1 FROM two_hop_table\`;
    `);

    // Build the census in-process (this file's own analyzeRoot/buildJson)
    // and a permissive allowlist derived from it, so the CLI sanity checks
    // below (--report/default mode) exit 0 without duplicating the exact
    // ratchet semantics tested separately in runRatchetSelfTest().
    const { records: fixtureRecords, castWarnings: fixtureCastWarnings, unresolved: fixtureUnresolved } = analyzeRoot(tempRoot);
    const json = buildJson(fixtureRecords, fixtureCastWarnings, fixtureUnresolved);
    const permissiveEntries = [];
    for (const rec of fixtureRecords) {
      for (const [kind, count] of rec.kinds) {
        if (isExemptKind(rec.file, kind)) continue;
        permissiveEntries.push({ file: rec.file, kind, count });
      }
    }
    const permissiveAllowlist = writeAllowlist(tempRoot, permissiveEntries);

    // Comment-only mentions must produce zero records (rule 12), including
    // the member-tag comment-only case.
    expect(findRecord(json, 'lib/services/comment-only.js') === undefined,
      'comment-only.js must not appear in the census');
    expect(findRecord(json, 'lib/services/comment-only-vp-sql.js') === undefined,
      'comment-only-vp-sql.js must not appear in the census');

    const driverImportFiles = json.files.filter((f) => f.kinds['driver-import']).map((f) => f.file).sort();
    expect(!driverImportFiles.includes('lib/services/barrel-consumer.js'),
      `barrel-consumer.js must NOT be recorded as driver-import (no propagation); got ${JSON.stringify(driverImportFiles)}`);
    expect(!driverImportFiles.includes('lib/services/resolved-non-driver-require.js'),
      'resolved-non-driver-require.js resolves to fs, not a driver -- must not be driver-import');
    expect(!driverImportFiles.includes('lib/services/unresolved-dynamic-import.js'),
      'unresolved-dynamic-import.js must not be driver-import (fails open, per P2-3)');
        const expectedDriverImportFiles = [
      'lib/services/alias-import.js',
      'lib/services/alias-require.js',
      'lib/services/aliased-require-literal.js',
      'lib/services/barrel.js',
      'lib/services/begin-client.js',
      'lib/services/cast-lint-cases.js',
      'lib/services/cjs-getter-exports-fn.js',
      'lib/services/cjs-getter-object-arrow.js',
      'lib/services/cjs-getter-object-method.js',
      'lib/services/cjs-getter-property-assign.js',
      'lib/services/cjs-require.js',
      'lib/services/cjs-uses-sql-internally.js',
      'lib/services/destructured-require.js',
      'lib/services/dynamic-import.js',
      'lib/services/imported-db-var-connect.js',
      'lib/services/module-dot-require.js',
      'lib/services/namespace-import.js',
      'lib/services/neon-driver.js',
      'lib/services/nested-db-connect.js',
      'lib/services/nested-pool-query.js',
      'lib/services/pg-namespace-pool.js',
      'lib/services/pg-pool.js',
      'lib/services/pg-subpath.js',
      'lib/services/plain-import.js',
      'lib/services/pool-connect.js',
      'lib/services/pool-var-connect.js',
      'lib/services/raw-sql-getter.js',
      'lib/services/reexport-sql.js',
      'lib/services/renamed-pool-import.js',
      'lib/services/renamed-pool-require.js',
      'lib/services/resolved-const-require.js',
      'lib/services/sql-query-call.js',
      'lib/services/table-edge-cases.js',
      'lib/services/two-hop-namespace-alias.js',
      'lib/services/two-hop-require-literal.js',
      'lib/services/uses-sql-internally.js',
      'lib/services/vercel-postgres-subpath.js',
      'pages/api/health.js',
    ];
    expect(JSON.stringify(driverImportFiles) === JSON.stringify(expectedDriverImportFiles),
      `driver-import file set mismatch: got ${JSON.stringify(driverImportFiles)}, expected ${JSON.stringify(expectedDriverImportFiles)}`);
    expect(json.driverFileTotal === expectedDriverImportFiles.length,
      `driverFileTotal expected ${expectedDriverImportFiles.length}, got ${json.driverFileTotal}`);

    // sql-tag: P1 -- source-agnostic. Now includes the barrel consumer.
    const sqlTagFiles = json.files.filter((f) => f.kinds['sql-tag']).map((f) => f.file).sort();
        const expectedSqlTagFiles = [
      'lib/services/alias-import.js',
      'lib/services/alias-require.js',
      'lib/services/bare-sql-from-call.js',
      'lib/services/bare-sql-param.js',
      'lib/services/barrel-consumer.js',
      'lib/services/cast-lint-cases.js',
      'lib/services/cjs-require.js',
      'lib/services/cjs-uses-sql-internally.js',
      'lib/services/destructured-require.js',
      'lib/services/dynamic-import.js',
      'lib/services/module-dot-require.js',
      'lib/services/namespace-import.js',
      'lib/services/neon-driver.js',
      'lib/services/plain-import.js',
      'lib/services/resolved-const-require.js',
      'lib/services/table-edge-cases.js',
      'lib/services/two-hop-namespace-alias.js',
      'lib/services/uses-sql-internally.js',
      'lib/services/vercel-postgres-subpath.js',
      'pages/api/health.js',
    ];
    expect(JSON.stringify(sqlTagFiles) === JSON.stringify(expectedSqlTagFiles),
      `sql-tag file set mismatch: got ${JSON.stringify(sqlTagFiles)}, expected ${JSON.stringify(expectedSqlTagFiles)}`);
    expect(findRecord(json, 'lib/services/barrel-consumer.js').tables.includes('barrel_table'),
      'barrel-consumer.js sql-tag statement table extraction should still work');

    // P2-B: bare unbound `sql` tag, no import/require of any kind anywhere
    // in the file -- must still count as sql-tag, and must NOT count as
    // driver-import (there is nothing to import here).
    const bareParam = findRecord(json, 'lib/services/bare-sql-param.js');
    expect(bareParam && bareParam.kinds['sql-tag'] === 1 && !bareParam.kinds['driver-import'],
      `bare-sql-param.js (sql as a bare function parameter) should be sql-tag only, got ${JSON.stringify(bareParam)}`);
    const bareCall = findRecord(json, 'lib/services/bare-sql-from-call.js');
    expect(bareCall && bareCall.kinds['sql-tag'] === 1 && !bareCall.kinds['driver-import'],
      `bare-sql-from-call.js (sql assigned from neon(url), no import) should be sql-tag only, got ${JSON.stringify(bareCall)}`);
    expect(!driverImportFiles.includes('lib/services/bare-sql-param.js') && !driverImportFiles.includes('lib/services/bare-sql-from-call.js'),
      'neither bare-sql fixture should be driver-import');

    // P2-5: renamed Pool specifier/require both count as new-Pool.
    expect(findRecord(json, 'lib/services/renamed-pool-import.js').kinds['new-Pool'] === 1,
      'renamed-pool-import.js (import { Pool as P }; new P()) should record new-Pool');
    expect(findRecord(json, 'lib/services/renamed-pool-require.js').kinds['new-Pool'] === 1,
      'renamed-pool-require.js (const { Pool: P } = require(...); new P()) should record new-Pool');

    // Codex round 2, P1: a computed require() specifier is invisible to
    // driver-import recognition by construction, but must be caught as
    // unresolved-import (which IS ratcheted -- see runRatchetSelfTest for
    // the red-without-an-allowlist-entry case).
    const computedDriverRequire = findRecord(json, 'lib/services/computed-driver-require.js');
    expect(computedDriverRequire && computedDriverRequire.kinds['unresolved-import'] === 1,
      `computed-driver-require.js should record unresolved-import:1, got ${JSON.stringify(computedDriverRequire)}`);
    expect(!computedDriverRequire.kinds['driver-import'],
      `computed-driver-require.js must NOT be driver-import (the source cannot be resolved), got ${JSON.stringify(computedDriverRequire.kinds)}`);

    // Codex round 2, P1: driver-export -- identity export/re-export of a
    // role-bound identifier, and the internal-use-only control case.
    const rawSqlGetter = findRecord(json, 'lib/services/raw-sql-getter.js');
    expect(rawSqlGetter && rawSqlGetter.kinds['driver-export'] === 1,
      `raw-sql-getter.js (export function getRawSql(){ return sql; }) should record driver-export:1, got ${JSON.stringify(rawSqlGetter)}`);
    const reexportSql = findRecord(json, 'lib/services/reexport-sql.js');
    expect(reexportSql && reexportSql.kinds['driver-export'] === 1,
      `reexport-sql.js (export { sql }) should record driver-export:1, got ${JSON.stringify(reexportSql)}`);
    const usesSqlInternally = findRecord(json, 'lib/services/uses-sql-internally.js');
    expect(usesSqlInternally && !usesSqlInternally.kinds['driver-export'],
      `uses-sql-internally.js (returns a query result, not the sql binding) must NOT record driver-export, got ${JSON.stringify(usesSqlInternally && usesSqlInternally.kinds)}`);

    // Codex round 3, P1 shape 1: CJS accessor exports -- function
    // expression/arrow/method assigned to a CJS export target.
    for (const cjsFile of [
      'lib/services/cjs-getter-property-assign.js',
      'lib/services/cjs-getter-exports-fn.js',
      'lib/services/cjs-getter-object-method.js',
      'lib/services/cjs-getter-object-arrow.js',
    ]) {
      const rec = findRecord(json, cjsFile);
      expect(rec && rec.kinds['driver-export'] === 1,
        `${cjsFile} should record driver-export:1, got ${JSON.stringify(rec)}`);
    }
    const cjsUsesInternally = findRecord(json, 'lib/services/cjs-uses-sql-internally.js');
    expect(cjsUsesInternally && !cjsUsesInternally.kinds['driver-export'],
      `cjs-uses-sql-internally.js must NOT record driver-export, got ${JSON.stringify(cjsUsesInternally && cjsUsesInternally.kinds)}`);

    // Codex round 3, P1 shape 2: aliased/module.require loaders.
    const aliasedLiteral = findRecord(json, 'lib/services/aliased-require-literal.js');
    expect(aliasedLiteral && aliasedLiteral.kinds['driver-import'] === 1
      && aliasedLiteral.kinds['new-Pool'] === 1 && aliasedLiteral.kinds['pool.query'] === 1,
      `aliased-require-literal.js (const load = require; load('pg')) should record driver-import/new-Pool/pool.query, got ${JSON.stringify(aliasedLiteral && aliasedLiteral.kinds)}`);
    const aliasedComputed = findRecord(json, 'lib/services/aliased-require-computed.js');
    expect(aliasedComputed && aliasedComputed.kinds['unresolved-import'] === 1 && !aliasedComputed.kinds['driver-import'],
      `aliased-require-computed.js (load(packageName), non-literal) should record unresolved-import:1 and NOT driver-import, got ${JSON.stringify(aliasedComputed && aliasedComputed.kinds)}`);
    const moduleDotRequire = findRecord(json, 'lib/services/module-dot-require.js');
    expect(moduleDotRequire && moduleDotRequire.kinds['driver-import'] === 1,
      `module-dot-require.js (module.require('@vercel/postgres')) should record driver-import:1, got ${JSON.stringify(moduleDotRequire && moduleDotRequire.kinds)}`);

    // Codex round 3 (narrow): multi-hop require aliases and a two-hop
    // namespace alias tag.
    const twoHopLiteral = findRecord(json, 'lib/services/two-hop-require-literal.js');
    expect(twoHopLiteral && twoHopLiteral.kinds['driver-import'] === 1,
      `two-hop-require-literal.js (load -> load2 -> load2('pg')) should record driver-import:1, got ${JSON.stringify(twoHopLiteral && twoHopLiteral.kinds)}`);
    const threeHopComputed = findRecord(json, 'lib/services/three-hop-require-computed.js');
    expect(threeHopComputed && threeHopComputed.kinds['unresolved-import'] === 1 && !threeHopComputed.kinds['driver-import'],
      `three-hop-require-computed.js (load -> load2 -> load3, computed source) should record unresolved-import:1 and NOT driver-import, got ${JSON.stringify(threeHopComputed && threeHopComputed.kinds)}`);
    const twoHopNamespace = findRecord(json, 'lib/services/two-hop-namespace-alias.js');
    expect(twoHopNamespace && twoHopNamespace.kinds['sql-tag'] === 1,
      `two-hop-namespace-alias.js (vp -> vp2; vp2.sql\`...\`) should record sql-tag:1, got ${JSON.stringify(twoHopNamespace && twoHopNamespace.kinds)}`);

    // P2-3: unresolved module sources are audited (and, per Codex round 2,
    // ratcheted as the unresolved-import kind above).
    const unresolvedFiles = json.unresolved.map((u) => u.file);
    expect(unresolvedFiles.includes('lib/services/unresolved-dynamic-import.js'),
      `unresolved-dynamic-import.js should appear in the unresolved-sources audit, got ${JSON.stringify(json.unresolved)}`);
    expect(unresolvedFiles.includes('lib/services/resolved-non-driver-require.js'),
      `resolved-non-driver-require.js (argument is an Identifier, even though resolvable) should appear in the unresolved-sources audit, got ${JSON.stringify(json.unresolved)}`);
    const resolvedConstEntry = json.unresolved.find((u) => u.file === 'lib/services/resolved-non-driver-require.js');
    expect(resolvedConstEntry && resolvedConstEntry.resolved === 'fs',
      `resolved-non-driver-require.js should report its one-hop resolution ('fs'), got ${JSON.stringify(resolvedConstEntry)}`);
    const unresolvedDynamicEntry = json.unresolved.find((u) => u.file === 'lib/services/unresolved-dynamic-import.js');
    expect(unresolvedDynamicEntry && unresolvedDynamicEntry.resolved === null,
      `unresolved-dynamic-import.js should have no one-hop resolution, got ${JSON.stringify(unresolvedDynamicEntry)}`);

    // Kind-specific occurrence checks, incl. the Stage 1 item 0 additions.
    expect(json.kindTotals['new-Pool'] === 8, `expected new-Pool: 8, got ${json.kindTotals['new-Pool']}`);
    expect(json.kindTotals['pool.query'] === 6, `expected pool.query: 6, got ${json.kindTotals['pool.query']}`);
    expect(json.kindTotals['db.connect'] === 3, `expected db.connect: 3, got ${json.kindTotals['db.connect']}`);
    expect(json.kindTotals['pool.connect'] === 2, `expected pool.connect: 2, got ${json.kindTotals['pool.connect']}`);
    expect(json.kindTotals['client.query'] === 6, `expected client.query: 6, got ${json.kindTotals['client.query']}`);
    expect(json.kindTotals['begin-literal'] === 1, `expected begin-literal: 1, got ${json.kindTotals['begin-literal']}`);
    expect(json.kindTotals['sql.query'] === 1, `expected sql.query: 1, got ${json.kindTotals['sql.query']}`);

    // Item 0(b): member-callee new Pool().
    const pgNamespacePool = findRecord(json, 'lib/services/pg-namespace-pool.js');
    expect(pgNamespacePool.kinds['new-Pool'] === 1,
      `pg-namespace-pool.js should record new-Pool via new pg.Pool(), got ${JSON.stringify(pgNamespacePool.kinds)}`);

    // Item 0(c): nested member paths and variable-bound instances.
    expect(findRecord(json, 'lib/services/nested-pool-query.js').kinds['pool.query'] === 1,
      'nested-pool-query.js (this.pool.query(...)) should record pool.query');
    expect(findRecord(json, 'lib/services/nested-db-connect.js').kinds['db.connect'] === 1,
      'nested-db-connect.js (self.db.connect()) should record db.connect');
    expect(findRecord(json, 'lib/services/pool-var-connect.js').kinds['pool.connect'] === 1,
      'pool-var-connect.js (p bound to new Pool()) should record pool.connect');
    expect(findRecord(json, 'lib/services/imported-db-var-connect.js').kinds['db.connect'] === 1,
      'imported-db-var-connect.js (p bound to an imported db) should record db.connect');

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

    // Q6 cast-lint: the uncast jsonb_build_object(...) placeholder warns
    // (kind === 'jsonb_build_object'); the ::text-cast placeholder must not.
    // table-edge-cases.js also legitimately warns once with kind === 'VALUES'
    // (its `VALUES (${id})` placeholder has no cast) -- correct Q6 behavior.
    const castLintFiles = json.castLint.map((w) => w.file).sort();
    expect(JSON.stringify(castLintFiles) === JSON.stringify(['lib/services/cast-lint-cases.js', 'lib/services/table-edge-cases.js']),
      `unexpected cast-lint warning file set: ${JSON.stringify(json.castLint)}`);
    const castLintCasesWarnings = json.castLint.filter((w) => w.file === 'lib/services/cast-lint-cases.js');
    expect(castLintCasesWarnings.length === 1 && castLintCasesWarnings[0].kind === 'jsonb_build_object',
      `cast-lint-cases.js should warn exactly once with kind jsonb_build_object, got ${JSON.stringify(castLintCasesWarnings)}`);
    const edgeCaseWarnings = json.castLint.filter((w) => w.file === 'lib/services/table-edge-cases.js');
    expect(edgeCaseWarnings.length === 1 && edgeCaseWarnings[0].kind === 'VALUES',
      `table-edge-cases.js should warn exactly once with kind VALUES, got ${JSON.stringify(edgeCaseWarnings)}`);

    const { output: reportOutput } = (() => {
      const out = execFileSync(process.execPath, [__filename, '--root', tempRoot, '--report', '--allowlist', permissiveAllowlist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { output: out };
    })();
    expect(reportOutput.includes(`Driver-import files (import/require/dynamic-import of a driver): ${json.driverFileTotal}`),
      `--report headline missing/mismatched driver-import count:\n${reportOutput}`);
    expect(reportOutput.includes(`Files with any recognized record (incl. non-driver-import callers, e.g. a client passed in as an argument): ${json.totalFilesInCensus}`),
      `--report headline missing/mismatched total-files-in-census count:\n${reportOutput}`);
    expect(reportOutput.includes('## Cast-lint warnings') && reportOutput.includes(`Total: ${json.castLint.length}`),
      `--report must include the cast-lint warnings section with the right total:\n${reportOutput}`);
    expect(reportOutput.includes('| Region kind | Count |') && reportOutput.includes('jsonb_build_object'),
      `--report cast-lint section must include the per-kind total table:\n${reportOutput}`);
    expect(!reportOutput.includes('### Full rows'),
      `--report without --cast-lint-detail must NOT include the full per-line rows:\n${reportOutput}`);
    expect(reportOutput.includes('## Unresolved module sources') && reportOutput.includes('lib/services/unresolved-dynamic-import.js'),
      `--report must include the unresolved module sources section naming the file:\n${reportOutput}`);

    const detailReportOutput = execFileSync(process.execPath, [__filename, '--root', tempRoot, '--report', '--cast-lint-detail', '--allowlist', permissiveAllowlist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(detailReportOutput.includes('### Full rows'),
      `--report --cast-lint-detail must include the full per-line rows:\n${detailReportOutput}`);

    // --json + --report together: stdout must stay valid JSON (report goes
    // to stderr).
    const combined = execFileSync(process.execPath, [__filename, '--root', tempRoot, '--json', '--report', '--allowlist', permissiveAllowlist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let parsedCombined;
    try {
      parsedCombined = JSON.parse(combined);
    } catch (err) {
      throw new Error(`self-test FAILED: --json --report stdout must stay valid JSON, got parse error: ${err.message}\n${combined}`);
    }
    expect(parsedCombined.driverFileTotal === json.driverFileTotal,
      '--json --report combined stdout should still be the full JSON payload');

    console.log('postgres-access-layer classification self-test OK -- Stage 1 binding-resolution fixes (a)/(b)/(c), P1 source-agnostic sql-tag, P2-2 driver sources, P2-3 one-hop resolution + unresolved audit, P2-5 renamed Pool, P2-6 cast-lint kinds, comment exclusion verified.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runRatchetSelfTest() {
  // ---- green: exact-match allowlist ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', `
        import { sql } from '@vercel/postgres';
        export async function get() { return sql\`SELECT 1 FROM foo\`; }
      `);
      const { json } = runJson(tempRoot, writeAllowlist(tempRoot, []));
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/foo-store.js', kind: 'driver-import', count: json.files[0].kinds['driver-import'] },
        { file: 'lib/services/foo-store.js', kind: 'sql-tag', count: json.files[0].kinds['sql-tag'] },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green at exact-match allowlist, got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (a): unknown key not in allowlist ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', `
        import { sql } from '@vercel/postgres';
        export async function get() { return sql\`SELECT 1 FROM foo\`; }
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (unknown key), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/foo-store.js') && result.stderr.includes('not in allowlist'),
        `expected violation to name the offending file, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (a): census count above allowed ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', `
        import { sql } from '@vercel/postgres';
        export async function get() {
          await sql\`SELECT 1 FROM foo\`;
          return sql\`SELECT 2 FROM foo\`;
        }
      `);
      const { json } = runJson(tempRoot, writeAllowlist(tempRoot, []));
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/foo-store.js', kind: 'driver-import', count: json.files[0].kinds['driver-import'] },
        { file: 'lib/services/foo-store.js', kind: 'sql-tag', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (count above allowed), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/foo-store.js') && result.stderr.includes('sql-tag')
        && result.stderr.includes('exceeds allowlist'),
        `expected violation to name file+kind, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (b): allowlist count above census ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', `
        import { sql } from '@vercel/postgres';
        export async function get() { return sql\`SELECT 1 FROM foo\`; }
      `);
      const { json } = runJson(tempRoot, writeAllowlist(tempRoot, []));
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/foo-store.js', kind: 'driver-import', count: json.files[0].kinds['driver-import'] },
        { file: 'lib/services/foo-store.js', kind: 'sql-tag', count: 5 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (allowlist above census), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/foo-store.js') && result.stderr.includes('shrink the allowlist'),
        `expected 'shrink the allowlist' naming the file, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (b): vanished key ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', 'module.exports.get = () => 1;\n');
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/foo-store.js', kind: 'driver-import', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (vanished key), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/foo-store.js') && result.stderr.includes('shrink the allowlist'),
        `expected 'shrink the allowlist' for a vanished key, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (b): allowlist entry naming a Q5-exempt file ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/utils/health-checker.js', `
        const { Pool } = require('pg');
        module.exports.check = async () => new Pool().query('SELECT 1');
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/utils/health-checker.js', kind: 'driver-import', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (allowlist lists an exempt file), got status ${result.status}`);
      expect(result.stderr.includes('lib/utils/health-checker.js') && result.stderr.includes('must not list an exempt file'),
        `expected 'must not list an exempt file' naming health-checker.js, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (c): pages/api importing lib/postgres/** when it exists ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/postgres/client.js', 'module.exports.sql = null;\n');
      write(tempRoot, 'pages/api/widgets.js', `
        const { sql } = require('../../lib/postgres/client');
        module.exports = async (req, res) => { res.json(await sql\`SELECT 1\`); };
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'pages/api/widgets.js', kind: 'sql-tag', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (pages/api imports lib/postgres), got status ${result.status}`);
      expect(result.stderr.includes('pages/api/widgets.js') && result.stderr.includes('lib/postgres'),
        `expected violation naming the route, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red (c): index-form import (no trailing segment after lib/postgres) ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/postgres/index.js', 'module.exports.sql = null;\n');
      write(tempRoot, 'pages/api/widgets.js', `
        const { sql } = require('../../lib/postgres');
        module.exports = async (req, res) => { res.json(await sql\`SELECT 1\`); };
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'pages/api/widgets.js', kind: 'sql-tag', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (index-form lib/postgres import), got status ${result.status}`);
      expect(result.stderr.includes('pages/api/widgets.js'),
        `expected violation naming the route for the index-form import, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green (c): no-op when lib/postgres/ does not exist in the tree ----
  // (P1 means the bare `sql` tag here DOES count as sql-tag now, so the
  // allowlist needs that entry for the fixture to stay green on other
  // grounds -- the point of THIS fixture is specifically that check (c)
  // itself is a no-op without lib/postgres/ present, not that the file has
  // no census record at all.)
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'pages/api/widgets.js', `
        const { sql } = require('../../lib/postgres/client');
        module.exports = async (req, res) => { res.json(await sql\`SELECT 1\`); };
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'pages/api/widgets.js', kind: 'sql-tag', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green (c) no-op without lib/postgres/, got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green: Q5 exemption (lib/utils/health-checker.js), no allowlist entry needed ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/utils/health-checker.js', `
        const { Pool } = require('pg');
        module.exports.check = async () => {
          const pool = new Pool();
          return pool.query('SELECT 1 FROM information_schema.tables');
        };
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green (Q5 exemption, no allowlist entry needed), got status ${result.status}\n${result.stderr}`);
      const { json } = runJson(tempRoot, allowlist);
      expect(findRecord(json, 'lib/utils/health-checker.js') !== undefined,
        'lib/utils/health-checker.js must still appear in --json/--report despite being ratchet-exempt');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green: Q5 exemption (lib/utils/migration-drift.js), no allowlist entry needed ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/utils/migration-drift.js', `
        const { Pool } = require('pg');
        module.exports.check = async () => new Pool().query('SELECT 1 FROM schema_migrations');
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green (migration-drift.js Q5 exemption), got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: lib/postgres/** kind-specific exemption (Codex Stage 2) -- a
  // store bypassing the seam and importing pg directly ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/postgres/stores/rogue.js', `
        const { Pool } = require('pg');
        module.exports.run = () => new Pool().query('SELECT 1');
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (lib/postgres/** store bypassing the seam via driver-import), got status ${result.status}`);
      expect(result.stderr.includes('lib/postgres/stores/rogue.js') && result.stderr.includes('driver-import'),
        `expected violation naming the file and driver-import, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: lib/postgres/** store laundering the seam's sql back out ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/postgres/client.js', `
        const { sql } = require('@vercel/postgres');
        module.exports = { sql };
      `);
      write(tempRoot, 'lib/postgres/stores/x.js', `
        const { sql } = require('../client');
        export { sql };
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (lib/postgres/** store re-exporting sql, driver-export), got status ${result.status}`);
      expect(result.stderr.includes('lib/postgres/stores/x.js') && result.stderr.includes('driver-export'),
        `expected violation naming the file and driver-export, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green: lib/postgres/** store using the seam's sql freely, no allowlist entry needed ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/postgres/client.js', `
        const { sql } = require('@vercel/postgres');
        module.exports = { sql };
      `);
      write(tempRoot, 'lib/postgres/stores/ok.js', `
        const { sql } = require('../client');
        module.exports.getWidgets = () => sql\`SELECT * FROM widget_requests\`;
        module.exports.getUsers = () => sql\`SELECT * FROM user_profiles\`;
        module.exports.getBills = () => sql\`SELECT * FROM bill_records\`;
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green (lib/postgres/stores/ok.js uses the seam's sql freely), got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green: lib/postgres/client.js itself (the seam), all kinds exempt ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/postgres/client.js', `
        const { sql, db } = require('@vercel/postgres');
        const { Pool } = require('pg');
        let poolInstance;
        function getPool() {
          if (!poolInstance) poolInstance = new Pool();
          return poolInstance;
        }
        async function withClient(fn) {
          const client = await db.connect();
          try {
            return await fn(client);
          } finally {
            client.release();
          }
        }
        module.exports = { sql, getPool, withClient };
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green (lib/postgres/client.js is the seam, exempt for every kind), got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- exit 2: duplicate allowlist (file,kind) key ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', 'module.exports.get = () => 1;\n');
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/foo-store.js', kind: 'driver-import', count: 1 },
        { file: 'lib/services/foo-store.js', kind: 'driver-import', count: 2 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 2, `expected exit 2 (duplicate allowlist key), got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- exit 2: allowlist entry missing a required field (not _comment) ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/foo-store.js', 'module.exports.get = () => 1;\n');
      const allowlist = writeAllowlist(tempRoot, [
        { _comment: 'this metadata entry is fine, no file/kind' },
        { file: 'lib/services/foo-store.js', kind: 'driver-import' }, // missing count
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 2, `expected exit 2 (malformed entry missing count), got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green: legitimate count shrink, allowlist already reduced to match ----
  // (Codex round 2, P2: proves the ratchet itself tolerates a shrink fine --
  // any pinned-exact-number brittleness lives in a test's OWN assertions,
  // never in the ratchet, which only ever compares census vs. allowlist.)
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      // Simulates a file whose sql-tag count shrank from a prior baseline
      // of 2 down to 1 (e.g. one statement moved to lib/postgres/**); the
      // allowlist has ALREADY been hand-edited down to match.
      write(tempRoot, 'lib/services/shrinking-store.js', `
        import { sql } from '@vercel/postgres';
        export async function get() { return sql\`SELECT 1 FROM foo\`; }
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/shrinking-store.js', kind: 'driver-import', count: 1 },
        { file: 'lib/services/shrinking-store.js', kind: 'sql-tag', count: 1 }, // reduced from a prior 2
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green after a legitimate shrink with a matching reduced allowlist, got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: unresolved-import (Codex round 2, P1) -- computed module specifier ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/computed-driver-require.js', `
        const packageName = ['@vercel','postgres'].join('/');
        const driver = require(packageName);
        module.exports.run = () => driver['sql']\`SELECT 1\`;
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (unresolved-import, no allowlist entry), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/computed-driver-require.js')
        && result.stderr.includes('unresolved-import')
        && result.stderr.includes('computed module source')
        && result.stderr.includes('the Postgres ratchet cannot see what it loads')
        && result.stderr.includes('scripts/postgres-access-allowlist.json'),
        `expected the unresolved-import violation message naming the file, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: driver-export (Codex round 2, P1) -- getRawSql() ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/raw-sql-getter.js', `
        import { sql } from '@vercel/postgres';
        export function getRawSql() { return sql; }
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/raw-sql-getter.js', kind: 'driver-import', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (driver-export via getRawSql), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/raw-sql-getter.js') && result.stderr.includes('driver-export'),
        `expected violation naming the file and driver-export, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: driver-export (Codex round 2, P1) -- export { sql } ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/reexport-sql.js', `
        import { sql } from '@vercel/postgres';
        export { sql };
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/reexport-sql.js', kind: 'driver-import', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (driver-export via export { sql }), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/reexport-sql.js') && result.stderr.includes('driver-export'),
        `expected violation naming the file and driver-export, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- green: driver-export control -- internal use only, nothing to allowlist ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/uses-sql-internally.js', `
        import { sql } from '@vercel/postgres';
        export async function getWidgets() {
          return sql\`SELECT * FROM widget_requests\`;
        }
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/uses-sql-internally.js', kind: 'driver-import', count: 1 },
        { file: 'lib/services/uses-sql-internally.js', kind: 'sql-tag', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 0, `expected green (sql used internally, never returned/exported raw), got status ${result.status}\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: driver-export (Codex round 3, P1 shape 1) -- CJS accessor exports ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/cjs-getter-property-assign.js', `
        const { sql } = require('@vercel/postgres');
        module.exports.getRawSql = () => sql;
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/cjs-getter-property-assign.js', kind: 'driver-import', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (CJS accessor export), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/cjs-getter-property-assign.js') && result.stderr.includes('driver-export'),
        `expected violation naming the file and driver-export, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: unresolved-import (Codex round 3, P1 shape 2) -- aliased computed require ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/aliased-require-computed.js', `
        function getName() { return '@vercel/postgres'; }
        const load = require;
        const packageName = getName();
        const driver = load(packageName);
        module.exports.run = () => driver;
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (aliased computed require), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/aliased-require-computed.js') && result.stderr.includes('unresolved-import'),
        `expected violation naming the file and unresolved-import, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: driver-import (Codex round 3, P1 shape 2) -- aliased literal require, no allowlist entry ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/aliased-require-literal.js', `
        const load = require;
        const d = load('pg');
        const pool = new d.Pool();
        module.exports.run = () => pool.query('SELECT 1');
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (aliased literal require, unratcheted), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/aliased-require-literal.js') && result.stderr.includes('driver-import'),
        `expected violation naming the file and driver-import, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: driver-import (Codex round 3 narrow) -- two-hop require alias, no allowlist entry ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/two-hop-require-literal.js', `
        const load = require;
        const load2 = load;
        const driver = load2('pg');
        module.exports.run = () => new driver.Client();
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (two-hop require alias, unratcheted), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/two-hop-require-literal.js') && result.stderr.includes('driver-import'),
        `expected violation naming the file and driver-import, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: unresolved-import (Codex round 3 narrow) -- three-hop require alias, computed source ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/three-hop-require-computed.js', `
        function getName() { return '@vercel/postgres'; }
        const load = require;
        const load2 = load;
        const load3 = load2;
        const packageName = getName();
        const driver = load3(packageName);
        module.exports.run = () => driver;
      `);
      const allowlist = writeAllowlist(tempRoot, []);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (three-hop require alias, computed source), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/three-hop-require-computed.js') && result.stderr.includes('unresolved-import'),
        `expected violation naming the file and unresolved-import, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // ---- red: sql-tag (Codex round 3 narrow) -- two-hop namespace alias tag ----
  {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-ratchet-selftest-'));
    try {
      write(tempRoot, 'lib/services/two-hop-namespace-alias.js', `
        import * as vp from '@vercel/postgres';
        const vp2 = vp;
        export const run = () => vp2.sql\`SELECT 1\`;
      `);
      const allowlist = writeAllowlist(tempRoot, [
        { file: 'lib/services/two-hop-namespace-alias.js', kind: 'driver-import', count: 1 },
      ]);
      const result = runDefault(tempRoot, allowlist);
      expect(result.status === 1, `expected red (two-hop namespace alias tag, unratcheted sql-tag), got status ${result.status}`);
      expect(result.stderr.includes('lib/services/two-hop-namespace-alias.js') && result.stderr.includes('sql-tag'),
        `expected violation naming the file and sql-tag, got:\n${result.stderr}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  console.log('postgres-access-layer ratchet self-test OK -- green exact-match, red (a)/(a-count)/(b)/(b-vanished)/(b-exempt)/(c)/(c-index-form), green (c) no-op, Q5 exemptions, malformed-allowlist exit-2, legitimate-shrink green, unresolved-import/driver-export red+green, CJS-accessor-export red, aliased-require red, multi-hop-alias (require + namespace) red, and lib/postgres/** kind-specific-exemption red/green cases verified.');
}

// P2-A: a `--json` payload over ~64 KiB used to be truncated by
// `process.exit(main())` racing the async stdout-to-pipe write (observed
// exactly at the 64 KiB highWaterMark via `node ... --json | wc -c`). Runs
// through a REAL shell pipe (not just execFileSync's internal capture,
// which reads via a synchronous blocking loop and can mask the bug) against
// this repo's own tree/allowlist, whose --json output is well over 64 KiB.
// P2-A/P2 (Codex round 2): checks the pipe-truncation regression WITHOUT
// pinning any live count -- a legitimate future shrink (or Stage 2 adding
// an exempt seam file) must never break this test. Instead it checks (1)
// the piped payload is over the historical truncation threshold, (2) it is
// valid JSON, (3) it is byte-for-byte the same JSON as a payload generated
// directly in-process for the same tree (no subprocess, no pipe at all --
// proves the piped bytes are the real payload, not a coincidentally-valid
// truncation), and (4) a handful of structural invariants that hold no
// matter what the live counts are.
function runJsonPipeSelfTest() {
  const wcOutput = execFileSync('/bin/sh', ['-c', `'${process.execPath}' '${__filename}' --json | wc -c`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const byteCount = parseInt(wcOutput.trim(), 10);
  expect(byteCount > 65536, `expected piped --json output over 65536 bytes (regression guard for the exit()-truncation bug), got ${byteCount}`);

  const pipedOutput = execFileSync('/bin/sh', ['-c', `'${process.execPath}' '${__filename}' --json | cat`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
  let piped;
  try {
    piped = JSON.parse(pipedOutput);
  } catch (err) {
    throw new Error(`self-test FAILED: piped --json output did not parse as JSON (truncated?): ${err.message}`);
  }

  // Structural invariants -- true regardless of the live census's exact
  // numbers, so they survive a legitimate shrink or a new exempt file.
  expect(Array.isArray(piped.files) && piped.files.length > 0
    && piped.files.every((f) => f.kinds && Object.keys(f.kinds).length > 0),
    'every files[] entry must carry at least one recognized kind, and there must be at least one file');
  expect(piped.totalFilesInCensus === piped.files.length,
    `totalFilesInCensus (${piped.totalFilesInCensus}) must equal files.length (${piped.files.length})`);
  const summedFromFiles = {};
  for (const f of piped.files) {
    for (const [kind, count] of Object.entries(f.kinds)) summedFromFiles[kind] = (summedFromFiles[kind] || 0) + count;
  }
  for (const [kind, total] of Object.entries(piped.kindTotals)) {
    expect((summedFromFiles[kind] || 0) === total,
      `kindTotals.${kind} (${total}) must equal the sum of per-file counts (${summedFromFiles[kind] || 0})`);
  }

  // Deep-equal against a directly (in-process, no subprocess/pipe at all)
  // generated payload for the same tree.
  const { records, castWarnings, unresolved } = analyzeRoot(DEFAULT_ROOT);
  const direct = buildJson(records, castWarnings, unresolved);
  expect(JSON.stringify(piped) === JSON.stringify(direct),
    'piped --json payload must deep-equal a directly generated (in-process) payload for the same tree');

  console.log(`postgres-access-layer JSON-pipe self-test OK -- ${byteCount} bytes through a real shell pipe, structurally valid and deep-equal to a direct in-process payload.`);
}

function runSelfTest() {
  runClassificationSelfTest();
  runRatchetSelfTest();
  runJsonPipeSelfTest();
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

  const { records, castWarnings, unresolved } = analyzeRoot(args.root);

  if (args.report) {
    const reportOut = formatReport(records, castWarnings, unresolved, args.castLintDetail);
    // Cosmetic fix: with both --json and --report, the report goes to
    // stderr so stdout stays valid JSON.
    if (args.json) console.error(reportOut);
    else console.log(reportOut);
  }
  if (args.json) {
    console.log(JSON.stringify(buildJson(records, castWarnings, unresolved), null, 2));
  }
  if (!args.report && !args.json) {
    console.log('postgres-access-layer: use --report or --json for detail (ratchet still applies).');
  }

  const allowlist = loadAllowlist(args.allowlist);
  const violations = runRatchet(records, allowlist, args.root);
  if (violations.length) {
    for (const v of violations) console.error(`VIOLATION: ${v}`);
    console.error(`postgres-access-layer ratchet: ${violations.length} violation(s) -- see docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md §5 Stage 1`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  // P2-A: process.exitCode + a natural exit (never process.exit(...) here),
  // so Node drains a piped stdout before the process ends -- process.exit()
  // can truncate a large --json payload when stdout is a pipe (observed at
  // exactly the 64 KiB highWaterMark).
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 2;
  }
}

module.exports = {
  analyzeRoot,
  buildSummary,
  buildJson,
  formatReport,
  isPostgresDriverSource,
  runRatchet,
  loadAllowlist,
  isExemptKind,
};

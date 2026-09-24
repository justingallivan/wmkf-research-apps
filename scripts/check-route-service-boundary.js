#!/usr/bin/env node
/**
 * Stage-7 Route→Service boundary gate -- Dataverse LAW + Postgres
 * LAW-with-shrink-only-carry-over.
 *
 * The Route→Service consolidation campaign (docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md,
 * Stages 0-5) shelled every `pages/api` route onto per-domain
 * `lib/services/<domain>/` services and drove the boundary census to zero.
 * Stage 7 made that permanent law: ANY in-scope route file that reaches the
 * Dataverse layer directly -- importing a `lib/dataverse/adapters/*` module or
 * `lib/services/dynamics-service` -- outside the one carried-over exempt dir
 * (pages/api/dataverse-export/) fails this gate. There is no baseline file
 * and no count ratchet for Dataverse -- this is pure law, mirroring
 * scripts/check-dataverse-access-layer.js one layer up.
 *
 * Postgres access layer migration Stage 1 item 2
 * (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md) widened the
 * SAME boundary-source recognition to a `pages/api` route reaching Postgres
 * directly -- importing `@vercel/postgres`/`pg` (or a subpath) or anything
 * under `lib/postgres/` -- with a narrowly scoped, SHRINK-ONLY carry-over:
 * `POSTGRES_CARRYOVER` below lists the routes that were already red under the
 * widened definition when it landed. A route on that list may keep reaching
 * Postgres; an unlisted route reaching Postgres fails as law; a listed route
 * that no longer reaches Postgres fails the gate too (stale entry -- forces
 * the list to shrink, never grow silently). Dataverse detection has no list
 * and is never excused by a Postgres carry-over entry in the same file. The
 * carry-over is pinned exact-set by
 * tests/unit/route-service-boundary-postgres-carryover.test.js; the list must
 * reach zero by the end of Stage 6, at which point the array and that test
 * are deleted and the gate is pure law again for both families.
 *
 * Detection reuses the hardened scanner primitives from
 * scripts/lib/ast-scan-core.js (the same core the Dataverse access-layer gate
 * uses): static import, ESM re-export, dynamic import(), and inline require()
 * of a boundary source are all recognized, and re-export through a thin
 * wrapper module consumed by a route taints the route -- for BOTH the
 * Dataverse and the Postgres source families, via the same propagation
 * mechanism. This deliberately avoids a looser per-file string matcher, which
 * ordinary indirection evades. Non-literal require()/import() sources
 * reachable from a route fail CLOSED.
 *
 * A route that USES a normal per-domain service (which internally calls an
 * adapter or Postgres but does NOT re-export it) is NOT counted -- that is
 * the desired end state. Only direct boundary imports and thin re-export
 * wrappers count.
 *
 * Modes:
 *   --report  Domain + family rollup, Postgres carry-over count, and the
 *             per-route listing of any in-scope boundary-reaching routes
 *             (informational; exits 0). The Stage 1-5 wave classification was
 *             retired with the campaign.
 *   --json    Raw { file, domain, reason, boundaryFamily } rows for in-scope
 *             boundary-reaching routes -- one row per (file, family) so a
 *             route hitting both families reports both reasons.
 *   (default) LAW MODE: exits non-zero naming every in-scope Dataverse
 *             violation, every unlisted Postgres violation, and every stale
 *             Postgres carry-over entry.
 *   --postgres-carryover <file>  SELF-TEST ONLY override: read the carry-over
 *             list from a JSON array file instead of the in-script
 *             POSTGRES_CARRYOVER constant, so fixtures can exercise the
 *             stale-entry and unlisted-entry paths without touching the real
 *             list.
 */

const fs = require('fs');
const path = require('path');
const {
  parseModule,
  walkAst,
  stringLiteralValue,
  importCallSourceNode,
  buildParentMap,
  propName,
  nodeLine,
  bindingNames,
  climbExpressionWrappers,
  unwrapExpression,
  isCommonJsExportTarget,
  isInsideCommonJsExportRight,
  toRel,
} = require('./lib/ast-scan-core');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['pages', 'lib', 'shared', 'modules'];
const JS_EXT_RE = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/;
const RESOLVE_EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.ts'];

const ROUTE_ROOT = 'pages/api/';
const EXEMPT_ROUTE_DIRS = [
  'pages/api/dataverse-export/',
];

function isDynamicsServiceSource(value) {
  return typeof value === 'string' && /(?:^|\/)dynamics-service(?:\.js)?$/.test(value);
}

// S338 Stage 0 (Q4/C5): the decomposition submodules are as much the
// Dataverse boundary as dynamics-service.js itself; a route importing
// lib/services/dynamics/write-core.js directly is the same bypass as
// importing the facade.
function isDynamicsSubmoduleSource(value) {
  return typeof value === 'string' && /(?:^|\/)lib\/services\/dynamics\//.test(value);
}

function isAdapterSource(value) {
  return typeof value === 'string' && /(?:^|\/)lib\/dataverse\/adapters\/[^/]+/.test(value);
}

// Postgres access layer migration Stage 1 item 2: bare-package driver sources
// only -- exact match or a `<pkg>/subpath` form. Deliberately does NOT match
// `pg` as a substring of another package name (`pg-copy-streams` is a real,
// unrelated dependency used by lib/services/irs-bmf-service.js).
function isPostgresDriverSource(value) {
  if (typeof value !== 'string') return false;
  return value === '@vercel/postgres' || value.startsWith('@vercel/postgres/')
    || value === 'pg' || value.startsWith('pg/');
}

// Any source resolving under lib/postgres/ (the future access-layer dir),
// matched the same way isDynamicsSubmoduleSource is -- directly on the raw
// specifier string (so an aliased `@/lib/postgres/client` matches without
// resolution) as well as on a resolved relative path.
function isPostgresLayerSource(value) {
  return typeof value === 'string' && /(?:^|\/)lib\/postgres(?:\/|$)/.test(value);
}

function isPostgresSource(value) {
  return isPostgresDriverSource(value) || isPostgresLayerSource(value);
}

function isBoundarySource(value) {
  return isAdapterSource(value) || isDynamicsServiceSource(value) || isDynamicsSubmoduleSource(value)
    || isPostgresSource(value);
}

// Postgres access layer migration Stage 1 item 2 (docs/plans/
// POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md): the 17 pages/api
// routes that reached Postgres directly when the widened definition landed.
// SHRINK-ONLY -- pinned exact-set by
// tests/unit/route-service-boundary-postgres-carryover.test.js. Widening this
// array requires editing that test in the same reviewed commit. The list must
// reach zero by the end of Stage 6, at which point this array and that test
// are deleted and the gate becomes pure law for Postgres too.
const POSTGRES_CARRYOVER = [
  'pages/api/admin/health-history.js',
  'pages/api/admin/stats.js',
  'pages/api/auth/[...nextauth].js',
  'pages/api/auth/link-profile.js',
  'pages/api/cron/drain-submissions.js',
  'pages/api/cron/health-check.js',
  'pages/api/cron/pricing-canary.js',
  'pages/api/cron/pricing-refresh.js',
  'pages/api/cron/secret-check.js',
  'pages/api/cron/spend-check.js',
  'pages/api/dynamics-explorer/restrictions.js',
  'pages/api/dynamics-explorer/roles.js',
  'pages/api/expertise-finder/history.js',
  'pages/api/expertise-finder/match.js',
  'pages/api/expertise-finder/roster.js',
  'pages/api/intake/submit.js',
  'pages/api/webhooks/bill.js',
].sort();

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, report: false, json: false, postgresCarryoverFile: null };
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
    } else if (arg === '--postgres-carryover') {
      const value = argv[++i];
      if (!value) throw new Error('--postgres-carryover requires a JSON file path');
      args.postgresCarryoverFile = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function loadCarryover(file) {
  if (!file) return POSTGRES_CARRYOVER;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`--postgres-carryover file must contain a JSON array: ${file}`);
  for (const entry of parsed) {
    if (typeof entry !== 'string') {
      throw new Error(`--postgres-carryover file must contain only strings, got ${JSON.stringify(entry)}: ${file}`);
    }
  }
  return parsed;
}

function usage() {
  return [
    'Usage: node scripts/check-route-service-boundary.js [--root <dir>] [--report] [--json]',
    '                                                     [--postgres-carryover <file>]',
    '',
    'Default mode is LAW MODE (Route→Service consolidation Stage 7): any',
    'pages/api route importing Dataverse adapters or dynamics-service (outside',
    'the exempt dir) fails the gate -- pure law, no baseline, no ratchet.',
    'A route importing a Postgres driver (@vercel/postgres, pg) or lib/postgres/',
    'also fails UNLESS it is one of the 17 POSTGRES_CARRYOVER entries (shrink-only',
    '-- a listed route that no longer reaches Postgres fails too, as a stale entry).',
    '--report prints a domain + family rollup, the Postgres carry-over count, and',
    'the offending routes (exit 0).',
    '--json prints the raw boundary-reaching route rows (one per family; exit 0).',
    '--postgres-carryover <file> is a SELF-TEST-ONLY override: read the carry-over',
    'list from a JSON array file instead of the in-script POSTGRES_CARRYOVER. Rejected',
    '(exit 2) unless --root is also set to something other than the real repo root.',
  ].join('\n');
}

function isExemptRoute(rel) {
  return EXEMPT_ROUTE_DIRS.some((dir) => rel.startsWith(dir));
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
        if (ent.name === 'node_modules' || ent.name === '.next') continue;
        walkDir(full);
        continue;
      }
      if (!ent.isFile() || !JS_EXT_RE.test(ent.name)) continue;
      files.push(full);
    }
  }
}

// Everything about a file the boundary analysis needs, via the hardened
// mechanisms the shared core recognizes:
//   - refs: every module-source reference. `reexport` marks references that
//     re-publish the source to the importer (ESM export-from / CJS
//     module.exports = require(...)), which is how a thin wrapper taints
//     consumers.
//   - importedBindings: local name -> { spec, imported } for every binding
//     introduced by a static import or `const x = require('<spec>')`. `imported`
//     is the EXTERNAL name pulled from the source ('*' for a namespace/whole-CJS
//     import, 'default' for a default import). Paired with exportedBindings this
//     catches the import-then-export wrapper (a binding pulled from a boundary
//     source and re-published by IDENTITY), which `export ... from` misses.
//   - exportedBindings: external export name -> local name, for identity
//     re-exports via `export { local as external }`, `export default local`,
//     `module.exports = { external: local }`, or `exports.external = local`.
//     A bare `module.exports = local` re-publishes the WHOLE namespace and is
//     recorded as exportsWholeNamespace (the local name). Locally DEFINED
//     functions are never in importedBindings, so exporting them never taints
//     (the legitimate-service false-positive guard). Taint is tracked per
//     EXPORT NAME, so a service that re-exports one adapter constant does not
//     taint consumers that import only its own functions.
//   - unresolved: non-literal require()/import() sources. These fail OPEN in a
//     plain census (their target is unknowable), so we record them and fail
//     CLOSED downstream. `reexport` marks a non-literal source in a re-export
//     position, which could silently confer boundary-equivalence.
//   - unresolvedBindings: local name -> line, for locals initialized by a
//     non-literal require()/import() declarator (incl. destructuring and
//     awaited import). Identity-exporting such a local re-publishes an
//     unknowable source, so it must also fail closed -- but a locally DEFINED
//     function that merely CALLS the unresolved value is not an identity
//     export (keeps lazy-backend services green).
function collectFileInfo(ast) {
  const refs = [];
  const importedBindings = new Map();
  const exportedBindings = new Map();
  const exportsWholeNamespace = new Set();
  const unresolved = [];
  const unresolvedBindings = new Map();
  // Same-file Identifier->Identifier alias edges (`const b = a` / `b = a`).
  // Provenance flows from `from` to `to` in a post-walk fixpoint, so an alias
  // chain (a -> b -> c) cannot launder a require()/import() binding before an
  // identity export. Collection is module-agnostic, matching the binding
  // captures above; the identity-export check is the noise filter.
  const aliasEdges = [];
  const parentMap = buildParentMap(ast);

  // If `callNode` (possibly wrapped in await/parens/TS casts) is the RHS of a
  // plain `name = ...` assignment, return the target identifier's name. Late
  // assignment (`let a; a = require(...)`) carries the same provenance as a
  // declarator initializer; without this it evades both taint paths.
  function assignedIdentifierTarget(callNode) {
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    if (parent && parent.type === 'AssignmentExpression'
      && parent.operator === '='
      && parent.right === climbed
      && parent.left.type === 'Identifier') {
      return parent.left.name;
    }
    return null;
  }

  // Record provenance for a LITERAL require()/import() bound to a local: as a
  // declarator initializer (incl. destructuring) or via late assignment.
  function captureResolvedBinding(callNode, spec) {
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    if (parent && parent.type === 'VariableDeclarator' && parent.init === climbed) {
      bindRequireDestructure(parent.id, spec, importedBindings);
      return;
    }
    const target = assignedIdentifierTarget(callNode);
    if (target) importedBindings.set(target, { spec, imported: '*' });
  }

  // Record every local a NON-LITERAL require()/import() binds as unresolved:
  // declarator patterns and late `name = require(p)` assignments alike.
  function captureUnresolvedBinding(callNode) {
    const climbed = climbExpressionWrappers(callNode, parentMap);
    const parent = parentMap.get(climbed);
    if (parent && parent.type === 'VariableDeclarator' && parent.init === climbed) {
      for (const name of bindingNames(parent.id)) unresolvedBindings.set(name, nodeLine(callNode));
      return;
    }
    const target = assignedIdentifierTarget(callNode);
    if (target) unresolvedBindings.set(target, nodeLine(callNode));
  }

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration' && node.source) {
      refs.push({ spec: node.source.value, kind: 'import', reexport: false });
      for (const spec of node.specifiers || []) {
        if (!spec.local || !spec.local.name) continue;
        let imported = '*';
        if (spec.type === 'ImportDefaultSpecifier') imported = 'default';
        else if (spec.type === 'ImportSpecifier') imported = spec.imported ? (spec.imported.name || spec.imported.value) : spec.local.name;
        importedBindings.set(spec.local.name, { spec: node.source.value, imported });
      }
      return;
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      refs.push({ spec: node.source.value, kind: 'export-from', reexport: true });
      return;
    }
    // `export { local }` / `export { local as external }` (no source).
    if (node.type === 'ExportNamedDeclaration' && !node.source && node.specifiers) {
      for (const spec of node.specifiers) {
        if (spec.type === 'ExportSpecifier' && spec.local && spec.local.name) {
          const external = spec.exported ? (spec.exported.name || spec.exported.value) : spec.local.name;
          exportedBindings.set(external, spec.local.name);
        }
      }
      return;
    }
    // `export default local`.
    if (node.type === 'ExportDefaultDeclaration' && node.declaration && node.declaration.type === 'Identifier') {
      exportedBindings.set('default', node.declaration.name);
      return;
    }
    // Alias edge: `const b = a` (Identifier declarator with Identifier init).
    if (node.type === 'VariableDeclarator'
      && node.id.type === 'Identifier'
      && node.init) {
      const init = unwrapExpression(node.init);
      if (init && init.type === 'Identifier') {
        aliasEdges.push({ from: init.name, to: node.id.name });
      }
    }
    // Alias edge: `b = a` (plain assignment, Identifier on both sides).
    if (node.type === 'AssignmentExpression'
      && node.operator === '='
      && node.left.type === 'Identifier') {
      const right = unwrapExpression(node.right);
      if (right && right.type === 'Identifier') {
        aliasEdges.push({ from: right.name, to: node.left.name });
      }
    }
    // CJS identity re-exports: `module.exports = local` (whole namespace),
    // `module.exports = { external: local }`, `exports.external = local`.
    if (node.type === 'AssignmentExpression' && isCommonJsExportTarget(node.left)) {
      const right = node.right;
      const targetProp = node.left.type !== 'Identifier' && propName(node.left.property);
      if (right.type === 'Identifier') {
        if (isModuleExportsRoot(node.left)) exportsWholeNamespace.add(right.name);
        else if (targetProp) exportedBindings.set(targetProp, right.name);
      } else if (right.type === 'ObjectExpression' && isModuleExportsRoot(node.left)) {
        for (const prop of right.properties || []) {
          if (prop.type === 'ObjectProperty' && prop.value && prop.value.type === 'Identifier') {
            const external = propName(prop.key);
            if (external) exportedBindings.set(external, prop.value.name);
          }
        }
      }
    }
    if (node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length > 0) {
      const spec = stringLiteralValue(node.arguments[0]);
      if (spec != null) {
        refs.push({ spec, kind: 'require', reexport: isInsideCommonJsExportRight(node, parentMap) });
        captureResolvedBinding(node, spec);
      } else {
        unresolved.push({ kind: 'require', line: nodeLine(node), reexport: isInsideCommonJsExportRight(node, parentMap) });
        captureUnresolvedBinding(node);
      }
      return;
    }
    const dynSource = importCallSourceNode(node);
    if (dynSource) {
      const spec = stringLiteralValue(dynSource);
      if (spec != null) {
        refs.push({ spec, kind: 'dynamic-import', reexport: false });
        captureResolvedBinding(node, spec);
      } else {
        unresolved.push({ kind: 'dynamic-import', line: nodeLine(node), reexport: isInsideCommonJsExportRight(node, parentMap) });
        captureUnresolvedBinding(node);
      }
    }
  });

  // Transitive same-file alias provenance: fixpoint-propagate membership in
  // importedBindings and unresolvedBindings across alias edges, so chains of
  // any length carry provenance to the identity-export check.
  let aliasChanged = true;
  while (aliasChanged) {
    aliasChanged = false;
    for (const { from, to } of aliasEdges) {
      if (!importedBindings.has(to) && importedBindings.has(from)) {
        importedBindings.set(to, importedBindings.get(from));
        aliasChanged = true;
      }
      if (!unresolvedBindings.has(to) && unresolvedBindings.has(from)) {
        unresolvedBindings.set(to, unresolvedBindings.get(from));
        aliasChanged = true;
      }
    }
  }

  return { refs, importedBindings, exportedBindings, exportsWholeNamespace, unresolved, unresolvedBindings };
}

// `module.exports = X` (or `module.exports.foo`/`exports.foo` where the ROOT is
// module.exports) replaces the whole namespace; distinguish it from a
// `exports.name = X` single-name export.
function isModuleExportsRoot(target) {
  return target.type === 'MemberExpression'
    && target.object.type === 'Identifier'
    && target.object.name === 'module'
    && propName(target.property) === 'exports';
}

// `const a = require(spec)` -> local a imports '*'; `const { y: z } = require(spec)`
// -> local z imports external y. Only flat Identifier/ObjectPattern handled.
function bindRequireDestructure(id, spec, importedBindings) {
  if (!id) return;
  if (id.type === 'Identifier') {
    importedBindings.set(id.name, { spec, imported: '*' });
    return;
  }
  if (id.type === 'ObjectPattern') {
    for (const prop of id.properties || []) {
      if (prop.type === 'ObjectProperty' && prop.value && prop.value.type === 'Identifier') {
        const external = propName(prop.key);
        if (external) importedBindings.set(prop.value.name, { spec, imported: external });
      }
    }
  }
}

function resolveLocalSpec(fromRel, spec, fileSet) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return null;
  const baseDir = path.posix.dirname(fromRel);
  const joined = path.posix.normalize(path.posix.join(baseDir, spec));
  for (const ext of RESOLVE_EXTS) {
    const candidate = ext.startsWith('/') ? path.posix.normalize(joined + ext) : joined + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// Build the graph, then evaluate every in-scope route for boundary reach.
function analyzeRoot(root) {
  const files = collectFiles(root);
  const relPaths = files.map((f) => toRel(root, f));
  const fileSet = new Set(relPaths);
  const infoByFile = new Map();

  for (const full of files) {
    const rel = toRel(root, full);
    const source = fs.readFileSync(full, 'utf8');
    let ast;
    try {
      ast = parseModule(source);
    } catch (err) {
      throw new Error(`route-service-boundary parse error in ${rel}: ${err.message}`);
    }
    infoByFile.set(rel, collectFileInfo(ast));
  }

  // Match a reference against the boundary families. A relative specifier is
  // resolved to its repo-relative target first (a wrapper's own re-export may
  // read `../dataverse/adapters/x`, which only reveals its adapter identity
  // after resolution); the raw string is the fallback when unresolvable.
  // Returns { kind, family } ('dataverse' or 'postgres') or null.
  function boundaryKind(fromRel, spec) {
    const resolved = resolveLocalSpec(fromRel, spec, fileSet);
    const matchPath = resolved || spec;
    if (isAdapterSource(matchPath)) return { kind: 'adapter', family: 'dataverse' };
    if (isDynamicsServiceSource(matchPath)) return { kind: 'dynamics', family: 'dataverse' };
    if (isDynamicsSubmoduleSource(matchPath)) return { kind: 'dynamics', family: 'dataverse' };
    if (isPostgresDriverSource(matchPath)) return { kind: 'postgres-driver', family: 'postgres' };
    if (isPostgresLayerSource(matchPath)) return { kind: 'postgres-layer', family: 'postgres' };
    return null;
  }

  const EMPTY_INFO = { refs: [], importedBindings: new Map(), exportedBindings: new Map(), exportsWholeNamespace: new Set(), unresolved: [], unresolvedBindings: new Map() };
  const infoOf = (rel) => infoByFile.get(rel) || EMPTY_INFO;

  // A file is boundary-equivalent (a thin PASSTHROUGH wrapper) if it re-exports a
  // boundary source wholesale via `export * from` / `export ... from` /
  // `module.exports = require(...)`, or does so for another boundary-equivalent
  // module. Importing ANY name from such a file reaches the boundary. Values
  // are a Set<family> ('dataverse' and/or 'postgres') -- a wrapper CAN re-export
  // both families at once (e.g. `export * from '@vercel/postgres'; export *
  // from '<adapter>'`), and every family it reaches must be tracked, not just
  // the first one a scan happens to hit, or a route consuming it would only
  // ever fail on one family and silently pass the other.
  const boundaryEquivalent = new Map();
  // Binding-level taint: per module, the EXTERNAL export names that re-publish a
  // boundary binding by identity (import-then-export), mapped to the Set<family>
  // they reach. A route reaches the boundary only if it imports one of THESE
  // names -- so a legitimate service that re-exports one adapter constant does
  // not taint consumers that import only its own functions. boundaryNamespace
  // holds files whose WHOLE namespace is a re-published boundary binding
  // (`module.exports = adapterBinding`), mapped to Set<family>.
  const boundaryExports = new Map();
  const boundaryNamespace = new Map();
  const exportsOf = (rel) => {
    let m = boundaryExports.get(rel);
    if (!m) { m = new Map(); boundaryExports.set(rel, m); }
    return m;
  };
  const familiesOf = (map, rel) => map.get(rel) || new Set();
  // Union `families` into `map.get(key)` (creating it if absent). Returns
  // true if any NEW family was added, for fixpoint change tracking.
  function unionFamilies(map, key, families) {
    if (!families || families.size === 0) return false;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    let added = false;
    for (const f of families) {
      if (!set.has(f)) { set.add(f); added = true; }
    }
    return added;
  }
  // Every family a local binding (an { spec, imported } entry) is
  // boundary-tainted with -- a binding can reach BOTH families at once
  // (e.g. `import * as m from '<mixed-wrapper>'` where the wrapper re-exports
  // both an adapter and a Postgres driver).
  function bindingBoundaryFamilies(fromRel, entry) {
    const result = new Set();
    if (!entry) return result;
    const bk = boundaryKind(fromRel, entry.spec);
    if (bk) result.add(bk.family);
    const target = resolveLocalSpec(fromRel, entry.spec, fileSet);
    if (target == null) return result;
    for (const f of familiesOf(boundaryEquivalent, target)) result.add(f);
    for (const f of familiesOf(boundaryNamespace, target)) result.add(f);
    const exp = boundaryExports.get(target);
    if (exp) {
      if (entry.imported === '*') {
        for (const famSet of exp.values()) for (const f of famSet) result.add(f);
      } else if (exp.has(entry.imported)) {
        for (const f of exp.get(entry.imported)) result.add(f);
      }
    }
    return result;
  }

  // A file is unresolved-equivalent if a non-literal require()/import() sits in
  // a re-export position (its published identity is a boundary source we cannot
  // see), or it re-publishes another unresolved-equivalent module. `origin`
  // remembers the file:line of the non-literal source for the failure message.
  const unresolvedEquivalent = new Set();
  const unresolvedOrigin = new Map();

  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of relPaths) {
      const info = infoOf(rel);

      // boundaryEquivalent: union the family from EVERY re-export ref (not
      // just the first that matches), so a wrapper re-exporting both an
      // adapter AND a Postgres driver is tracked as reaching both families.
      {
        const wrapFamilies = new Set();
        for (const ref of info.refs) {
          if (!ref.reexport) continue;
          const bk = boundaryKind(rel, ref.spec);
          if (bk) { wrapFamilies.add(bk.family); continue; }
          const target = resolveLocalSpec(rel, ref.spec, fileSet);
          if (target != null) {
            for (const f of familiesOf(boundaryEquivalent, target)) wrapFamilies.add(f);
          }
        }
        if (unionFamilies(boundaryEquivalent, rel, wrapFamilies)) changed = true;
      }

      // boundaryNamespace: union across EVERY exportsWholeNamespace local.
      {
        const nsFamilies = new Set();
        for (const local of info.exportsWholeNamespace) {
          for (const f of bindingBoundaryFamilies(rel, info.importedBindings.get(local))) nsFamilies.add(f);
        }
        if (unionFamilies(boundaryNamespace, rel, nsFamilies)) changed = true;
      }

      for (const [external, local] of info.exportedBindings) {
        const fams = bindingBoundaryFamilies(rel, info.importedBindings.get(local));
        if (unionFamilies(exportsOf(rel), external, fams)) changed = true;
      }

      if (!unresolvedEquivalent.has(rel)) {
        const selfMarker = info.unresolved.find((u) => u.reexport);
        let origin = selfMarker ? { file: rel, line: selfMarker.line } : null;
        // An unresolved LOCAL BINDING (`const a = require(p)`) that is
        // identity-exported re-publishes the unknowable source just like a
        // require in export position. A locally defined function that merely
        // CALLS the unresolved value is never an identity export.
        if (!origin) {
          const identityExportedLocals = [
            ...info.exportsWholeNamespace,
            ...[...info.exportedBindings.values()],
          ];
          for (const local of identityExportedLocals) {
            if (info.unresolvedBindings.has(local)) {
              origin = { file: rel, line: info.unresolvedBindings.get(local) };
              break;
            }
          }
        }
        if (!origin) {
          const propagate = (spec) => {
            const target = resolveLocalSpec(rel, spec, fileSet);
            return target != null && unresolvedEquivalent.has(target) ? unresolvedOrigin.get(target) : null;
          };
          for (const ref of info.refs) {
            if (!ref.reexport) continue;
            origin = propagate(ref.spec);
            if (origin) break;
          }
          if (!origin) {
            for (const local of [...info.exportsWholeNamespace, ...[...info.exportedBindings.values()]]) {
              const entry = info.importedBindings.get(local);
              if (!entry) continue;
              origin = propagate(entry.spec);
              if (origin) break;
            }
          }
        }
        if (origin) {
          unresolvedEquivalent.add(rel);
          unresolvedOrigin.set(rel, origin);
          changed = true;
        }
      }
    }
  }

  // Fail closed on non-literal require()/import() sources that can affect the
  // census: a non-literal source directly in a route (the route may be pulling
  // a boundary source we cannot see), or a route that reaches a module made
  // unresolved-equivalent by a non-literal re-export.
  const unresolvedFailures = [];
  for (const rel of relPaths) {
    if (!rel.startsWith(ROUTE_ROOT) || isExemptRoute(rel)) continue;
    const info = infoOf(rel);
    for (const u of info.unresolved) {
      unresolvedFailures.push(`${rel}:${u.line} (non-literal ${u.kind}() in route)`);
    }
    for (const ref of info.refs) {
      const target = resolveLocalSpec(rel, ref.spec, fileSet);
      if (target != null && unresolvedEquivalent.has(target)) {
        const o = unresolvedOrigin.get(target);
        unresolvedFailures.push(`${rel} reaches unresolved boundary source via ${target} (non-literal ${o ? `at ${o.file}:${o.line}` : 'source'})`);
      }
    }
  }
  if (unresolvedFailures.length > 0) {
    throw new Error(
      'route-service-boundary: unresolved-boundary-source -- a non-literal require()/import() '
      + 'source reachable from a route cannot be resolved, so the boundary census would fail OPEN. '
      + 'Make the source a string literal (or route it through a per-domain service):\n'
      + unresolvedFailures.map((f) => `  + ${f}`).join('\n'),
    );
  }

  // Why each route reaches the boundary, per family, for reporting. Returns
  // { dataverse?: reason, postgres?: reason } -- a route can reach both
  // families (e.g. a route importing an adapter AND a Postgres driver
  // directly), and both are reported.
  function routeReachByFamily(rel) {
    const info = infoOf(rel);
    const found = {};
    const record = (family, reason) => { if (!found[family]) found[family] = reason; };
    const label = (family) => (family === 'postgres' ? 'postgres' : 'adapter');

    for (const ref of info.refs) {
      const bk = boundaryKind(rel, ref.spec);
      if (!bk) continue;
      if (bk.kind === 'adapter') record('dataverse', `adapter import (${ref.kind})`);
      else if (bk.kind === 'dynamics') record('dataverse', `dynamics-service import (${ref.kind})`);
      else if (bk.kind === 'postgres-driver') record('postgres', `postgres driver import (${ref.kind})`);
      else if (bk.kind === 'postgres-layer') record('postgres', `postgres layer import (${ref.kind})`);
    }
    for (const ref of info.refs) {
      const target = resolveLocalSpec(rel, ref.spec, fileSet);
      if (target == null) continue;
      for (const fam of familiesOf(boundaryEquivalent, target)) {
        record(fam, `${label(fam)} re-export via ${target} (${ref.kind})`);
      }
    }
    // Binding-level: the route imports a specific name that a module re-publishes
    // from a boundary source by identity (import-then-export). Every family the
    // target reaches is recorded -- a mixed wrapper (e.g. `import * as m` from a
    // module re-exporting both an adapter and a Postgres driver) must report both.
    for (const [, entry] of info.importedBindings) {
      const target = resolveLocalSpec(rel, entry.spec, fileSet);
      if (target == null) continue;
      for (const fam of familiesOf(boundaryNamespace, target)) {
        record(fam, `${label(fam)} binding re-export via ${target} (import)`);
      }
      const exp = boundaryExports.get(target);
      if (!exp) continue;
      if (entry.imported === '*') {
        for (const [name, famSet] of exp) {
          for (const fam of famSet) {
            record(fam, `${label(fam)} binding '${name}' re-export via ${target} (import)`);
          }
        }
      } else if (exp.has(entry.imported)) {
        for (const fam of exp.get(entry.imported)) {
          record(fam, `${label(fam)} binding '${entry.imported}' re-export via ${target} (import)`);
        }
      }
    }
    return found;
  }

  const routes = [];
  for (const rel of relPaths) {
    if (!rel.startsWith(ROUTE_ROOT) || isExemptRoute(rel)) continue;
    const reach = routeReachByFamily(rel);
    if (Object.keys(reach).length > 0) routes.push({ file: rel, reach });
  }
  routes.sort((a, b) => a.file.localeCompare(b.file));
  return routes;
}

// Domain = first path segment under pages/api/ ('(root)' for root-level
// routes). The Stage 1-5 wave classification was retired at Stage 7 -- law
// mode fails on ANY boundary route regardless of where it lives, so the
// report keeps only the domain rollup.
function routeDomain(rel) {
  const sub = rel.slice(ROUTE_ROOT.length);
  const slash = sub.indexOf('/');
  return slash === -1 ? '(root)' : sub.slice(0, slash);
}

// One row per (file, family) so a route reaching both families reports both
// reasons; `boundaryFamily` is 'dataverse' or 'postgres'.
function buildRows(routes) {
  const rows = [];
  for (const route of routes) {
    for (const family of Object.keys(route.reach)) {
      rows.push({
        file: route.file,
        reason: route.reach[family],
        domain: routeDomain(route.file),
        boundaryFamily: family,
      });
    }
  }
  return rows;
}

function formatReport(routes, carryover = POSTGRES_CARRYOVER) {
  const rows = buildRows(routes);

  const byDomain = new Map();
  for (const row of rows) {
    byDomain.set(row.domain, (byDomain.get(row.domain) || 0) + 1);
  }
  const domainRollup = [...byDomain.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const familyRollup = { dataverse: 0, postgres: 0 };
  for (const row of rows) familyRollup[row.boundaryFamily] = (familyRollup[row.boundaryFamily] || 0) + 1;

  const postgresRoutes = new Set(routes.filter((r) => r.reach.postgres).map((r) => r.file));
  const staleEntries = carryover.filter((entry) => !postgresRoutes.has(entry));

  const lines = [
    'Route-service boundary census (Dataverse law since Stage 7; Postgres law + shrink-only carry-over since Stage 1 item 2)',
    `Boundary-reaching routes (in scope): ${routes.length}`,
    `Domains: ${byDomain.size}`,
    `Family rollup: dataverse=${familyRollup.dataverse}, postgres=${familyRollup.postgres}`,
    `Postgres carry-over: ${carryover.length} listed, ${staleEntries.length} stale`,
  ];
  if (rows.length > 0) {
    lines.push('', '| Domain | Routes |', '|---|---:|');
    for (const [domain, count] of domainRollup) {
      lines.push(`| ${domain} | ${count} |`);
    }
    lines.push('', '## Boundary-reaching routes');
    for (const row of rows.sort((a, b) => a.file.localeCompare(b.file) || a.boundaryFamily.localeCompare(b.boundaryFamily))) {
      lines.push(`  - ${row.file}  [${row.boundaryFamily}: ${row.reason}]`);
    }
  }
  if (staleEntries.length > 0) {
    lines.push('', '## Stale Postgres carry-over entries (no longer reach Postgres -- remove)');
    for (const entry of staleEntries) lines.push(`  - ${entry}`);
  }
  return lines.join('\n');
}

// Stage 7 Dataverse law + Postgres access-layer Stage 1 item 2 law-with-carry-over:
//   - a route reaching Dataverse (adapter/dynamics-service, directly or via a
//     thin re-export wrapper) always fails -- no list excuses it, ever.
//   - a route reaching Postgres directly (or via a thin re-export wrapper)
//     fails UNLESS it is a listed POSTGRES_CARRYOVER entry.
//   - a listed POSTGRES_CARRYOVER entry that no longer reaches Postgres under
//     the current scan fails too (stale entry -- the list is shrink-only).
// A route on the carry-over list that ALSO reaches Dataverse still fails, on
// the Dataverse reason -- the carry-over only ever excuses Postgres.
function evaluateLawFailures(routes, carryover) {
  const carrySet = new Set(carryover);
  const postgresRoutes = new Set();
  const failures = [];

  for (const route of routes) {
    if (route.reach.dataverse) {
      failures.push({ file: route.file, boundaryFamily: 'dataverse', reason: route.reach.dataverse, stale: false });
    }
    if (route.reach.postgres) {
      postgresRoutes.add(route.file);
      if (!carrySet.has(route.file)) {
        failures.push({ file: route.file, boundaryFamily: 'postgres', reason: route.reach.postgres, stale: false });
      }
    }
  }
  for (const entry of carryover) {
    if (!postgresRoutes.has(entry)) {
      failures.push({
        file: entry,
        boundaryFamily: 'postgres',
        reason: 'stale Postgres carry-over entry -- remove it',
        stale: true,
      });
    }
  }
  failures.sort((a, b) => a.file.localeCompare(b.file) || a.boundaryFamily.localeCompare(b.boundaryFamily));
  return failures;
}

function checkLaw(routes, carryover = POSTGRES_CARRYOVER) {
  const failures = evaluateLawFailures(routes, carryover);
  if (failures.length === 0) return 0;

  console.error('route-service-boundary LAW VIOLATION:');
  console.error(`  boundary violation(s) (${failures.length}):`);
  for (const f of failures.slice(0, 60)) {
    if (f.stale) {
      console.error(`    + ${f.file} | stale Postgres carry-over entry -- remove ${f.file}`);
    } else {
      console.error(`    + ${f.file} | [${f.boundaryFamily}] ${f.reason}`);
    }
  }
  if (failures.length > 60) console.error(`    ... ${failures.length - 60} more`);
  console.error('  Shell the route onto a per-domain lib/services/<domain>/ service;');
  console.error('  a route may not import lib/dataverse/adapters/* or lib/services/dynamics-service');
  console.error('  (no list excuses this), and may not import a Postgres driver or lib/postgres/');
  console.error('  unless carried over in POSTGRES_CARRYOVER (shrink-only -- a listed route that');
  console.error('  no longer reaches Postgres must be removed from the list).');
  console.error('  (docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md, Stage 7; docs/plans/');
  console.error('  POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md, Stage 1 item 2.)');
  return 1;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  // --postgres-carryover is a SELF-TEST-ONLY override. Reject it against the
  // real repo root -- a package.json/CI edit passing this flag must never be
  // able to bypass the pinned POSTGRES_CARRYOVER list.
  if (args.postgresCarryoverFile && args.root === DEFAULT_ROOT) {
    console.error(
      'route-service-boundary: --postgres-carryover is a self-test-only override and '
      + 'requires a non-default --root; it cannot be used against the real repo root.',
    );
    return 2;
  }

  const carryover = loadCarryover(args.postgresCarryoverFile);
  const routes = analyzeRoot(args.root);
  if (args.json) {
    console.log(JSON.stringify(buildRows(routes), null, 2));
  }
  if (args.report) {
    console.log(formatReport(routes, carryover));
  }
  if (args.report || args.json) return 0;
  return checkLaw(routes, carryover);
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
  routeDomain,
  buildRows,
  formatReport,
  checkLaw,
  evaluateLawFailures,
  loadCarryover,
  isBoundarySource,
  isAdapterSource,
  isDynamicsServiceSource,
  isPostgresDriverSource,
  isPostgresLayerSource,
  isPostgresSource,
  POSTGRES_CARRYOVER,
};

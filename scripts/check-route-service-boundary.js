#!/usr/bin/env node
/**
 * Stage-7 Route→Service boundary LAW gate.
 *
 * The Route→Service consolidation campaign (docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md,
 * Stages 0-5) shelled every `pages/api` route onto per-domain
 * `lib/services/<domain>/` services and drove the boundary census to zero.
 * Stage 7 made that permanent law: ANY in-scope route file that reaches the
 * Dataverse layer directly -- importing a `lib/dataverse/adapters/*` module or
 * `lib/services/dynamics-service` -- outside the two carried-over exempt dirs
 * (pages/api/dynamics-explorer/, pages/api/dataverse-export/) fails this gate.
 * There is no baseline file and no count ratchet -- this is the law, mirroring
 * scripts/check-dataverse-access-layer.js one layer up.
 *
 * Detection reuses the hardened scanner primitives from
 * scripts/lib/ast-scan-core.js (the same core the Dataverse access-layer gate
 * uses): static import, ESM re-export, dynamic import(), and inline require()
 * of a boundary source are all recognized, and adapter re-export through a
 * thin wrapper module consumed by a route taints the route. This deliberately
 * avoids a looser per-file string matcher, which ordinary indirection evades.
 * Non-literal require()/import() sources reachable from a route fail CLOSED.
 *
 * A route that USES a normal per-domain service (which internally calls an
 * adapter but does NOT re-export it) is NOT counted -- that is the desired end
 * state. Only direct boundary imports and thin re-export wrappers count.
 *
 * Modes:
 *   --report  Domain rollup + per-route listing of any in-scope
 *             boundary-importing routes (informational; exits 0). The Stage 1-5
 *             wave classification was retired with the campaign.
 *   --json    Raw { file, domain, reason } entries for in-scope
 *             boundary-importing routes.
 *   (default) LAW MODE: exits non-zero naming every in-scope
 *             boundary-importing route. Zero is the only passing state.
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
  'pages/api/dynamics-explorer/',
  'pages/api/dataverse-export/',
];

function isDynamicsServiceSource(value) {
  return typeof value === 'string' && /(?:^|\/)dynamics-service(?:\.js)?$/.test(value);
}

function isAdapterSource(value) {
  return typeof value === 'string' && /(?:^|\/)lib\/dataverse\/adapters\/[^/]+/.test(value);
}

function isBoundarySource(value) {
  return isAdapterSource(value) || isDynamicsServiceSource(value);
}

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, report: false, json: false };
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
    'Usage: node scripts/check-route-service-boundary.js [--root <dir>] [--report] [--json]',
    '',
    'Default mode is LAW MODE (Route→Service consolidation Stage 7): any',
    'pages/api route importing Dataverse adapters or dynamics-service (outside',
    'the exempt dirs) fails the gate. No baseline file, no count ratchet.',
    '--report prints a per-domain rollup and the offending routes (exit 0).',
    '--json prints the raw boundary-importing route entries.',
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
  function boundaryKind(fromRel, spec) {
    const resolved = resolveLocalSpec(fromRel, spec, fileSet);
    const matchPath = resolved || spec;
    if (isAdapterSource(matchPath)) return 'adapter';
    if (isDynamicsServiceSource(matchPath)) return 'dynamics';
    return null;
  }

  const EMPTY_INFO = { refs: [], importedBindings: new Map(), exportedBindings: new Map(), exportsWholeNamespace: new Set(), unresolved: [], unresolvedBindings: new Map() };
  const infoOf = (rel) => infoByFile.get(rel) || EMPTY_INFO;

  // A file is boundary-equivalent (a thin PASSTHROUGH wrapper) if it re-exports a
  // boundary source wholesale via `export * from` / `export ... from` /
  // `module.exports = require(...)`, or does so for another boundary-equivalent
  // module. Importing ANY name from such a file reaches the boundary.
  const boundaryEquivalent = new Set();
  // Binding-level taint: per module, the EXTERNAL export names that re-publish a
  // boundary binding by identity (import-then-export). A route reaches the
  // boundary only if it imports one of THESE names -- so a legitimate service
  // that re-exports one adapter constant does not taint consumers that import
  // only its own functions. boundaryNamespace holds files whose WHOLE namespace
  // is a re-published boundary binding (`module.exports = adapterBinding`).
  const boundaryExports = new Map();
  const boundaryNamespace = new Set();
  const exportsOf = (rel) => {
    let s = boundaryExports.get(rel);
    if (!s) { s = new Set(); boundaryExports.set(rel, s); }
    return s;
  };
  // Is a local binding (an { spec, imported } entry) boundary-tainted?
  function bindingIsBoundary(fromRel, entry) {
    if (!entry) return false;
    if (boundaryKind(fromRel, entry.spec)) return true;
    const target = resolveLocalSpec(fromRel, entry.spec, fileSet);
    if (target == null) return false;
    if (boundaryEquivalent.has(target) || boundaryNamespace.has(target)) return true;
    const exp = boundaryExports.get(target);
    if (!exp) return false;
    return entry.imported === '*' ? exp.size > 0 : exp.has(entry.imported);
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

      if (!boundaryEquivalent.has(rel)) {
        const wraps = info.refs.some((ref) => {
          if (!ref.reexport) return false;
          if (boundaryKind(rel, ref.spec)) return true;
          const target = resolveLocalSpec(rel, ref.spec, fileSet);
          return target != null && boundaryEquivalent.has(target);
        });
        if (wraps) {
          boundaryEquivalent.add(rel);
          changed = true;
        }
      }

      if (!boundaryNamespace.has(rel)) {
        for (const local of info.exportsWholeNamespace) {
          if (bindingIsBoundary(rel, info.importedBindings.get(local))) {
            boundaryNamespace.add(rel);
            changed = true;
            break;
          }
        }
      }

      const already = boundaryExports.get(rel);
      for (const [external, local] of info.exportedBindings) {
        if (already && already.has(external)) continue;
        if (bindingIsBoundary(rel, info.importedBindings.get(local))) {
          exportsOf(rel).add(external);
          changed = true;
        }
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

  // Why each route reaches the boundary, for reporting.
  function routeReach(rel) {
    const info = infoOf(rel);
    for (const ref of info.refs) {
      const kind = boundaryKind(rel, ref.spec);
      if (kind === 'adapter') return `adapter import (${ref.kind})`;
      if (kind === 'dynamics') return `dynamics-service import (${ref.kind})`;
    }
    for (const ref of info.refs) {
      const target = resolveLocalSpec(rel, ref.spec, fileSet);
      if (target != null && boundaryEquivalent.has(target)) return `adapter re-export via ${target} (${ref.kind})`;
    }
    // Binding-level: the route imports a specific name that a module re-publishes
    // from a boundary source by identity (import-then-export).
    for (const [, entry] of info.importedBindings) {
      const target = resolveLocalSpec(rel, entry.spec, fileSet);
      if (target == null) continue;
      if (boundaryNamespace.has(target)) return `adapter binding re-export via ${target} (import)`;
      const exp = boundaryExports.get(target);
      if (!exp) continue;
      if (entry.imported === '*' ? exp.size > 0 : exp.has(entry.imported)) {
        return `adapter binding '${entry.imported}' re-export via ${target} (import)`;
      }
    }
    return null;
  }

  const routes = [];
  for (const rel of relPaths) {
    if (!rel.startsWith(ROUTE_ROOT) || isExemptRoute(rel)) continue;
    const reason = routeReach(rel);
    if (reason) routes.push({ file: rel, reason });
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

function buildRows(routes) {
  return routes.map((route) => ({
    file: route.file,
    reason: route.reason,
    domain: routeDomain(route.file),
  }));
}

function formatReport(routes) {
  const rows = buildRows(routes);

  const byDomain = new Map();
  for (const row of rows) {
    byDomain.set(row.domain, (byDomain.get(row.domain) || 0) + 1);
  }
  const domainRollup = [...byDomain.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const lines = [
    'Route-service boundary census (law mode since Stage 7 -- 0 is the only passing state)',
    `Boundary-importing routes (in scope): ${rows.length}`,
    `Domains: ${byDomain.size}`,
  ];
  if (rows.length > 0) {
    lines.push('', '| Domain | Routes |', '|---|---:|');
    for (const [domain, count] of domainRollup) {
      lines.push(`| ${domain} | ${count} |`);
    }
    lines.push('', '## Boundary-importing routes');
    for (const row of rows.sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`  - ${row.file}  [${row.reason}]`);
    }
  }
  return lines.join('\n');
}

// Stage 7 law: no in-scope pages/api route may import lib/dataverse/adapters/*
// or lib/services/dynamics-service (directly or through a thin re-export
// wrapper). There is no allowlist and no count ratchet left to exempt a route.
function checkLaw(routes) {
  if (routes.length === 0) return 0;

  console.error('route-service-boundary LAW VIOLATION:');
  console.error(`  pages/api route(s) reaching the Dataverse layer directly (${routes.length}):`);
  for (const route of routes.slice(0, 60)) {
    console.error(`    + ${route.file} | ${route.reason}`);
  }
  if (routes.length > 60) console.error(`    ... ${routes.length - 60} more`);
  console.error('  Shell the route onto a per-domain lib/services/<domain>/ service;');
  console.error('  a route may not import lib/dataverse/adapters/* or lib/services/dynamics-service.');
  console.error('  (docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md, Stage 7 — law mode.)');
  return 1;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const routes = analyzeRoot(args.root);
  if (args.json) {
    console.log(JSON.stringify(buildRows(routes), null, 2));
  }
  if (args.report) {
    console.log(formatReport(routes));
  }
  if (args.report || args.json) return 0;
  return checkLaw(routes);
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
  isBoundarySource,
  isAdapterSource,
  isDynamicsServiceSource,
};

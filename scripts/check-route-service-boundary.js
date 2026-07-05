#!/usr/bin/env node
/**
 * Stage-0 Route→Service boundary census gate.
 *
 * Counts how many pages/api route files still reach the Dataverse layer
 * directly -- either importing a `lib/dataverse/adapters/*` module or importing
 * `lib/services/dynamics-service` -- outside the two carried-over exempt dirs
 * (pages/api/dynamics-explorer/, pages/api/dataverse-export/). This is the
 * Route→Service consolidation campaign's ratchet: as routes are shelled onto
 * per-domain services, the count falls; it may never rise.
 *
 * Detection reuses the hardened scanner primitives from
 * scripts/lib/ast-scan-core.js (the same core the Dataverse access-layer gate
 * uses): static import, ESM re-export, dynamic import(), and inline require()
 * of a boundary source are all recognized, and adapter re-export through a
 * thin wrapper module consumed by a route taints the route. This deliberately
 * avoids a looser per-file string matcher, which ordinary indirection evades.
 *
 * A route that USES a normal per-domain service (which internally calls an
 * adapter but does NOT re-export it) is NOT counted -- that is the desired end
 * state. Only direct boundary imports and thin re-export wrappers count.
 *
 * Modes:
 *   --report  Rollup by domain plus a wave-bucket classification of EVERY
 *             in-scope route (Stages 1-5 of docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md).
 *             An unclassifiable route is a hard error, never a silent skip.
 *   --json    Raw { file, domain, stage, reason } entries for in-scope
 *             boundary-importing routes.
 *   (default) Ratchet against scripts/route-service-boundary-baseline.json
 *             { "boundaryImportingRoutes": N }. Fails if the live count RISES;
 *             a FALLING count must update the baseline in the same commit.
 */

const fs = require('fs');
const path = require('path');
const {
  parseModule,
  walkAst,
  stringLiteralValue,
  importCallSourceNode,
  buildParentMap,
  isInsideCommonJsExportRight,
  toRel,
} = require('./lib/ast-scan-core');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.resolve(__dirname, 'route-service-boundary-baseline.json');
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
    'Default mode ratchets the count of pages/api routes importing Dataverse',
    'adapters or dynamics-service (outside exempt dirs) against',
    'scripts/route-service-boundary-baseline.json. A rising count fails; a',
    'falling count requires updating the baseline in the same commit.',
    '--report prints a per-domain rollup and wave-bucket classification.',
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

// Every module-source reference a file makes, via the hardened mechanisms the
// shared core recognizes. `reexport` marks references that re-publish the
// source to the importer (ESM export-from / CJS module.exports = require(...)),
// which is how a thin wrapper taints its consumers.
function collectReferences(ast) {
  const refs = [];
  const parentMap = buildParentMap(ast);

  walkAst(ast, (node) => {
    if (node.type === 'ImportDeclaration' && node.source) {
      refs.push({ spec: node.source.value, kind: 'import', reexport: false });
      return;
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      refs.push({ spec: node.source.value, kind: 'export-from', reexport: true });
      return;
    }
    if (node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
      && node.arguments.length > 0) {
      const spec = stringLiteralValue(node.arguments[0]);
      if (spec != null) {
        refs.push({ spec, kind: 'require', reexport: isInsideCommonJsExportRight(node, parentMap) });
      }
      return;
    }
    const dynSource = importCallSourceNode(node);
    if (dynSource) {
      const spec = stringLiteralValue(dynSource);
      if (spec != null) refs.push({ spec, kind: 'dynamic-import', reexport: false });
    }
  });

  return refs;
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
  const refsByFile = new Map();

  for (const full of files) {
    const rel = toRel(root, full);
    const source = fs.readFileSync(full, 'utf8');
    let ast;
    try {
      ast = parseModule(source);
    } catch (err) {
      throw new Error(`route-service-boundary parse error in ${rel}: ${err.message}`);
    }
    refsByFile.set(rel, collectReferences(ast));
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

  // A file is boundary-equivalent (a thin re-export wrapper) if it re-exports a
  // boundary source, or re-exports another boundary-equivalent module.
  const boundaryEquivalent = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of relPaths) {
      if (boundaryEquivalent.has(rel)) continue;
      const refs = refsByFile.get(rel) || [];
      const wraps = refs.some((ref) => {
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
  }

  // Why each route reaches the boundary, for reporting.
  function routeReach(rel) {
    const refs = refsByFile.get(rel) || [];
    for (const ref of refs) {
      const kind = boundaryKind(rel, ref.spec);
      if (kind === 'adapter') return `adapter import (${ref.kind})`;
      if (kind === 'dynamics') return `dynamics-service import (${ref.kind})`;
    }
    for (const ref of refs) {
      const target = resolveLocalSpec(rel, ref.spec, fileSet);
      if (target != null && boundaryEquivalent.has(target)) return `adapter re-export via ${target} (${ref.kind})`;
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

// Wave-bucket classification per docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
// Stages 1-5. Returns null for an unclassifiable route (a hard error).
const WAVE_STAGES = {
  1: 'Stage 1 - pilot (review-manager/withdraw-sufficient)',
  2: 'Stage 2 - review-manager, non-streaming',
  '2s': 'Stage 2s - streaming pilot (reviewer-finder/generate-emails)',
  '2b': 'Stage 2b - review-manager/send-emails (streaming)',
  3: 'Stage 3 - reviewer-finder, remaining',
  4: 'Stage 4 - workbench',
  5: 'Stage 5 - tail (admin/external/cron/expertise-finder/grant-reporting/phase-i-dynamics/field-primer/root-level)',
};
const TAIL_DOMAINS = new Set([
  'admin', 'external', 'cron', 'expertise-finder',
  'grant-reporting', 'phase-i-dynamics', 'field-primer',
]);

function classifyRoute(rel) {
  const sub = rel.slice(ROUTE_ROOT.length);
  const slash = sub.indexOf('/');
  const domain = slash === -1 ? '(root)' : sub.slice(0, slash);

  if (sub === 'review-manager/withdraw-sufficient.js') return { domain, stage: 1 };
  if (sub === 'review-manager/send-emails.js') return { domain, stage: '2b' };
  if (sub === 'reviewer-finder/generate-emails.js') return { domain, stage: '2s' };

  if (domain === 'review-manager') return { domain, stage: 2 };
  if (domain === 'reviewer-finder') return { domain, stage: 3 };
  if (domain === 'workbench') return { domain, stage: 4 };
  if (domain === '(root)' || TAIL_DOMAINS.has(domain)) return { domain, stage: 5 };
  return { domain, stage: null };
}

function buildClassification(routes) {
  const rows = routes.map((route) => {
    const { domain, stage } = classifyRoute(route.file);
    return { file: route.file, reason: route.reason, domain, stage };
  });
  const unclassifiable = rows.filter((r) => r.stage === null);
  if (unclassifiable.length > 0) {
    throw new Error(
      'route-service-boundary: unclassifiable in-scope route(s) -- resolve the wave taxonomy, do not skip:\n'
      + unclassifiable.map((r) => `  + ${r.file} (domain: ${r.domain})`).join('\n'),
    );
  }
  return rows;
}

function formatReport(routes) {
  const rows = buildClassification(routes);

  const byDomain = new Map();
  for (const row of rows) {
    byDomain.set(row.domain, (byDomain.get(row.domain) || 0) + 1);
  }
  const domainRollup = [...byDomain.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const byStage = new Map();
  for (const row of rows) {
    if (!byStage.has(row.stage)) byStage.set(row.stage, []);
    byStage.get(row.stage).push(row);
  }
  const stageOrder = [1, 2, '2s', '2b', 3, 4, 5];

  const lines = [
    'Route-service boundary census',
    `Boundary-importing routes (in scope): ${rows.length}`,
    `Domains: ${byDomain.size}`,
    '',
    '| Domain | Routes |',
    '|---|---:|',
  ];
  for (const [domain, count] of domainRollup) {
    lines.push(`| ${domain} | ${count} |`);
  }
  lines.push('', '## Wave classification');
  for (const stage of stageOrder) {
    const stageRows = byStage.get(stage) || [];
    lines.push('', `### ${WAVE_STAGES[stage]} - ${stageRows.length} route(s)`);
    for (const row of stageRows.sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`  - ${row.file}  [${row.reason}]`);
    }
  }
  return lines.join('\n');
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`baseline file missing: ${BASELINE_PATH}`);
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (typeof parsed.boundaryImportingRoutes !== 'number') {
    throw new Error('baseline must contain numeric "boundaryImportingRoutes"');
  }
  return parsed.boundaryImportingRoutes;
}

function checkRatchet(routes) {
  const baseline = readBaseline();
  const count = routes.length;

  if (count > baseline) {
    console.error('route-service-boundary RATCHET VIOLATION:');
    console.error(`  boundary-importing routes rose from ${baseline} to ${count} (+${count - baseline}).`);
    console.error('  Shell the new route(s) onto per-domain lib/services/<domain>/ services;');
    console.error('  a route may not import lib/dataverse/adapters/* or lib/services/dynamics-service directly.');
    console.error('  In-scope boundary-importing routes:');
    for (const route of routes.slice(0, 60)) {
      console.error(`    + ${route.file} | ${route.reason}`);
    }
    if (routes.length > 60) console.error(`    ... ${routes.length - 60} more`);
    return 1;
  }

  if (count < baseline) {
    console.error('route-service-boundary RATCHET UPDATE REQUIRED:');
    console.error(`  boundary-importing routes fell from ${baseline} to ${count} (-${baseline - count}).`);
    console.error(`  Update scripts/route-service-boundary-baseline.json "boundaryImportingRoutes" to ${count} in the same commit.`);
    return 1;
  }

  return 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const routes = analyzeRoot(args.root);
  if (args.json) {
    const rows = buildClassification(routes);
    console.log(JSON.stringify(rows, null, 2));
  }
  if (args.report) {
    console.log(formatReport(routes));
  }
  if (args.report || args.json) return 0;
  // Ratchet mode also validates the wave taxonomy so an unclassifiable route
  // fails the gate rather than passing silently.
  buildClassification(routes);
  return checkRatchet(routes);
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
  classifyRoute,
  buildClassification,
  formatReport,
  isBoundarySource,
  isAdapterSource,
  isDynamicsServiceSource,
};

#!/usr/bin/env node
/**
 * CI gate: every API route that resolves an LLM model must warm the override
 * cache first.
 *
 * Background — a recurring, prod-only defect class:
 *   getModelForApp(app) / getFallbackModelForApp(app) (shared/config/baseConfig.js)
 *   resolve a per-app tier alias (e.g. 'sonnet') to a concrete Anthropic model id
 *   SYNCHRONOUSLY, using a cache that loadModelOverrides() (lib/services/
 *   model-override-loader.js) populates from Dataverse settings + the live
 *   /v1/models list. If a request path resolves a model BEFORE that cache is
 *   warmed, the resolver returns the raw tier alias and Anthropic 404s on it.
 *   Unit tests never catch it (they mock the LLM); it only surfaces in prod.
 *
 *   This has bitten repeatedly — S229 (reviewer-finder/web-suggestions),
 *   and again this session (workbench/applicant-reviewers excluded-reviewer
 *   extraction, integrity-screener/screen). Each fix was the same one-liner.
 *   This gate converts the prod-only 404 into a CI failure.
 *
 * Rule:
 *   For every route file under pages/api/, if the route — DIRECTLY or through
 *   any transitively-imported repo-local module — reaches a getModelForApp /
 *   getFallbackModelForApp CALL, the route file itself must contain a
 *   loadModelOverrides() call. (The established convention is to warm at the
 *   top of the handler; services never warm themselves.)
 *
 * Detection is static and comment-stripped (so the doc comments that mention
 * getModelForApp(...) in passing — including this one — don't count as calls).
 *
 * Exemption — a route that imports a MIXED module (one that exports both a
 * model-resolving method and unrelated non-LLM methods) but only calls the
 * non-LLM methods can assert that with a same-file marker:
 *     // model-override-warming:ignore reason=<short-id>
 * Use this sparingly and only when the route genuinely never reaches a model
 * resolution (e.g. integrity-screener/history + dismiss call only the DB
 * methods of integrity-service). A marker on a route that DOES resolve a model
 * silences a real bug — reviewers should treat adding one as load-bearing.
 *
 * Definition file (shared/config/baseConfig.js) is excluded from the resolver
 * set: it DEFINES getModelForApp, it isn't a consumer call site, and nearly
 * every route imports it for BASE_CONFIG.
 *
 * Usage: node scripts/check-model-override-warming.js [--root <dir>]
 *   --root lets the self-test point the scan at an isolated fixture tree.
 * Exit 0 = clean, 1 = violations, 2 = configuration error.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  let root = path.resolve(__dirname, '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const v = argv[i + 1];
      if (!v) throw new Error('--root requires a directory path');
      root = path.resolve(v);
      i++;
    }
  }
  return { root };
}

const SCAN_DIRS = ['pages', 'lib', 'shared'];
const ROUTES_REL_DIR = path.join('pages', 'api');
// The getModelForApp definition lives here; importing it is NOT "reaching a
// resolver". A direct caller is still caught because the CALL appears in the
// caller's own (stripped) source.
const RESOLVER_DEFINITION_EXCLUDE = new Set([path.join('shared', 'config', 'baseConfig.js')]);

const RESOLVER_RE = /\b(?:getModelForApp|getFallbackModelForApp)\s*\(/;
const WARM_RE = /\bloadModelOverrides\s*\(/;
const IGNORE_RE = /model-override-warming:ignore(?:\s+reason=[\w-]+)?/;

// Strip block + line comments so prose mentions of getModelForApp(...) don't
// register as calls. Line-comment strip preserves "://" so URLs survive.
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return s;
}

// Relative import/require/dynamic-import/re-export specifiers.
const SPEC_RES = [
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function collectFiles(root) {
  const out = [];
  for (const d of SCAN_DIRS) {
    const base = path.join(root, d);
    if (!fs.existsSync(base)) continue;
    (function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules') continue;
          walk(full);
        } else if (ent.isFile() && full.endsWith('.js')) {
          out.push(full);
        }
      }
    })(base);
  }
  return out;
}

// Resolve a relative specifier from `fromFile` to an absolute file in `fileSet`.
function resolveSpec(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null;
  const baseAbs = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    baseAbs,
    baseAbs + '.js',
    path.join(baseAbs, 'index.js'),
  ];
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const files = collectFiles(root);
  const fileSet = new Set(files);

  const stripped = new Map(); // abs -> stripped code
  const raw = new Map();      // abs -> raw code
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    raw.set(f, src);
    stripped.set(f, stripComments(src));
  }

  // Resolver files: a real getModelForApp/getFallbackModelForApp call, minus
  // the definition file.
  const resolvers = new Set();
  for (const f of files) {
    const rel = path.relative(root, f);
    if (RESOLVER_DEFINITION_EXCLUDE.has(rel)) continue;
    if (RESOLVER_RE.test(stripped.get(f))) resolvers.add(f);
  }

  // Import graph (repo-local edges only).
  const edges = new Map(); // abs -> Set<abs>
  for (const f of files) {
    const code = stripped.get(f);
    const deps = new Set();
    for (const re of SPEC_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const resolved = resolveSpec(f, m[1], fileSet);
        if (resolved) deps.add(resolved);
      }
    }
    edges.set(f, deps);
  }

  // For a route, does it transitively reach a resolver?
  function reachesResolver(routeFile) {
    const seen = new Set([routeFile]);
    const stack = [routeFile];
    while (stack.length) {
      const cur = stack.pop();
      if (resolvers.has(cur)) return true;
      for (const dep of edges.get(cur) || []) {
        if (!seen.has(dep)) { seen.add(dep); stack.push(dep); }
      }
    }
    return false;
  }

  const routesRoot = path.join(root, ROUTES_REL_DIR);
  const routes = files.filter((f) => f.startsWith(routesRoot + path.sep));

  const violations = [];
  let warmCount = 0;
  let ignoredCount = 0;
  for (const route of routes) {
    if (!reachesResolver(route)) continue;
    if (IGNORE_RE.test(raw.get(route))) { ignoredCount++; continue; }
    if (WARM_RE.test(stripped.get(route))) { warmCount++; continue; }
    violations.push(path.relative(root, route));
  }

  if (violations.length > 0) {
    console.error(
      `model-override-warming FAILED: ${violations.length} route(s) resolve an LLM model ` +
      `(directly or via an imported service) but never call loadModelOverrides().\n` +
      `Without warming, getModelForApp() returns the raw tier alias (e.g. "sonnet") and Anthropic 404s in prod.\n` +
      `Fix: add\n` +
      `    import { loadModelOverrides } from '<path>/lib/services/model-override-loader';\n` +
      `  and \`await loadModelOverrides();\` near the top of the handler, BEFORE any model resolution.\n` +
      `If the route imports a mixed module but genuinely never reaches a model resolution, assert it with:\n` +
      `    // model-override-warming:ignore reason=<short-id>\n`
    );
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }

  console.log(
    `model-override-warming OK — ${routes.length} route(s) scanned; ` +
    `${warmCount} resolve a model and warm overrides; ${ignoredCount} marked ignore; ` +
    `${resolvers.size} model-resolving module(s).`
  );
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}

#!/usr/bin/env node
/**
 * CI gate: every API route that resolves an LLM model must warm the override
 * cache FIRST — with an awaited loadModelOverrides() that runs before the model
 * is resolved.
 *
 * Background — a recurring, prod-only defect class:
 *   getModelForApp(app) / getFallbackModelForApp(app) (shared/config/baseConfig.js)
 *   resolve a per-app tier alias (e.g. 'sonnet') to a concrete Anthropic model id
 *   SYNCHRONOUSLY, from a cache that loadModelOverrides() (lib/services/
 *   model-override-loader.js) populates from Dataverse settings + the live
 *   /v1/models list. If a request path resolves a model BEFORE that cache is
 *   warmed (or without awaiting the warm), the resolver returns the raw tier
 *   alias and Anthropic 404s on it. Unit tests never catch it (they mock the
 *   LLM); it only surfaces in prod. This has bitten repeatedly — S229
 *   (reviewer-finder/web-suggestions), and again (workbench/applicant-reviewers,
 *   integrity-screener/screen). The gate converts a prod-only 404 into CI red.
 *
 * Rule — for every route file under pages/api/:
 *   1. If the route reaches a getModelForApp/getFallbackModelForApp CALL —
 *      DIRECTLY (call in the route file) or TRANSITIVELY (through a repo-local
 *      imported module) — the route must contain an AWAITED loadModelOverrides()
 *      call. A present-but-un-awaited warm fails.
 *   2. Ordering: within any single function that contains BOTH a direct resolver
 *      call and an awaited warm, the warm must lexically precede the resolver.
 *      (Resolver calls reached via a helper/service are covered by the await
 *      requirement, not positional ordering — lexical position ≠ execution order
 *      across function boundaries, so we don't false-positive on those.)
 *
 * Detection is AST-based (@babel/parser): calls are real CallExpressions, so
 * getModelForApp(...) appearing in a COMMENT or a STRING never counts, and
 * "awaited" is a true AwaitExpression parent — not a text heuristic.
 *
 * Exemption — a route that imports a MIXED module (one exporting both a
 * model-resolving method and unrelated non-LLM methods) but only calls the
 * non-LLM methods can assert that with a same-file marker:
 *     // model-override-warming:ignore reason=<short-id>
 * The marker exempts ONLY transitive reachability. If the route file itself
 * contains a direct resolver call, the marker is IGNORED and warming is still
 * required — so a future model call added to a marked file is not silently
 * hidden. Use the marker sparingly; reviewers should treat adding one as
 * load-bearing.
 *
 * Definition file (shared/config/baseConfig.js) is excluded from the resolver
 * set: it DEFINES getModelForApp, isn't a consumer call site, and nearly every
 * route imports it for BASE_CONFIG.
 *
 * Known residual limits (documented, not silently ignored): model resolution
 * reached via computed/bracket member access (baseConfig['getModelForApp']()),
 * a non-literal dynamic import specifier, a path alias, or a warming wrapper
 * whose name is not loadModelOverrides, would not be modeled. None of these
 * patterns exist in this repo today; if one is introduced, extend this gate.
 *
 * Usage: node scripts/check-model-override-warming.js [--root <dir>]
 *   --root points the scan at an isolated fixture tree (used by the self-test).
 * Exit 0 = clean, 1 = violations, 2 = configuration/parse error.
 */

const fs = require('fs');
const path = require('path');
const babel = require('@babel/parser');

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
const RESOLVER_DEFINITION_EXCLUDE = new Set([path.join('shared', 'config', 'baseConfig.js')]);

const RESOLVER_NAMES = new Set(['getModelForApp', 'getFallbackModelForApp']);
const WARM_NAME = 'loadModelOverrides';
// Same-file marker (a comment) that exempts a route from TRANSITIVE reachability
// only. Scanned on raw source because comments are not in the AST.
const IGNORE_RE = /model-override-warming:ignore(?:\s+reason=[\w-]+)?/;

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

function parseFile(src, rel) {
  try {
    return babel.parse(src, { sourceType: 'unambiguous', errorRecovery: true, plugins: ['jsx'] });
  } catch (e) {
    throw new Error(`model-override-warming parse error in ${rel}: ${e.message}`);
  }
}

// Name of a call's callee for an Identifier callee or a non-computed member
// (foo.bar()). Computed access (foo['bar']()) returns null — documented limit.
function calleeName(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed
      && callee.property && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);

// Walk the AST collecting: literal relative import specifiers, resolver calls
// (with enclosing-function identity + position), and warm calls (with awaited
// flag + enclosing function + position).
function analyze(ast) {
  const importSpecs = new Set();
  const resolverCalls = []; // { pos, fn }
  const warmCalls = [];     // { pos, awaited, fn }

  (function rec(node, parent, fn) {
    if (!node || typeof node.type !== 'string') return;
    const curFn = FN_TYPES.has(node.type) ? node : fn;

    if (node.type === 'ImportDeclaration' && node.source) importSpecs.add(node.source.value);
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      importSpecs.add(node.source.value);
    }
    if (node.type === 'CallExpression') {
      // dynamic import('...')
      if (node.callee && node.callee.type === 'Import'
          && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
        importSpecs.add(node.arguments[0].value);
      }
      const cn = calleeName(node.callee);
      if (cn === 'require' && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
        importSpecs.add(node.arguments[0].value);
      }
      if (RESOLVER_NAMES.has(cn)) resolverCalls.push({ pos: node.start, fn: curFn });
      if (cn === WARM_NAME) {
        warmCalls.push({ pos: node.start, awaited: !!(parent && parent.type === 'AwaitExpression'), fn: curFn });
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k.endsWith('Comments')) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) rec(c, node, curFn); }
      else if (v && typeof v.type === 'string') rec(v, node, curFn);
    }
  })(ast.program, null, null);

  return {
    importSpecs: [...importSpecs],
    resolverCalls,
    warmCalls,
    hasResolver: resolverCalls.length > 0,
  };
}

function resolveSpec(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null;
  const baseAbs = path.resolve(path.dirname(fromFile), spec);
  for (const c of [baseAbs, baseAbs + '.js', path.join(baseAbs, 'index.js')]) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const files = collectFiles(root);
  const fileSet = new Set(files);

  const info = new Map(); // abs -> { analysis, raw, rel }
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    info.set(f, { analysis: analyze(parseFile(raw, rel)), raw, rel });
  }

  // Resolver modules: any file with a real resolver call, minus the definition.
  const resolverModules = new Set();
  for (const f of files) {
    const { analysis, rel } = info.get(f);
    if (RESOLVER_DEFINITION_EXCLUDE.has(rel)) continue;
    if (analysis.hasResolver) resolverModules.add(f);
  }

  // Import graph (repo-local edges).
  const edges = new Map();
  for (const f of files) {
    const deps = new Set();
    for (const spec of info.get(f).analysis.importSpecs) {
      const r = resolveSpec(f, spec, fileSet);
      if (r) deps.add(r);
    }
    edges.set(f, deps);
  }

  function reachesResolverTransitively(routeFile) {
    const seen = new Set([routeFile]);
    const stack = [...(edges.get(routeFile) || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (resolverModules.has(cur)) return true;
      for (const dep of edges.get(cur) || []) if (!seen.has(dep)) stack.push(dep);
    }
    return false;
  }

  const routesRoot = path.join(root, ROUTES_REL_DIR);
  const routes = files.filter((f) => f.startsWith(routesRoot + path.sep));

  const violations = []; // { rel, reason }
  let warmCount = 0;
  let ignoredCount = 0;

  for (const route of routes) {
    const { analysis, raw, rel } = info.get(route);
    const directResolver = analysis.resolverCalls.length > 0;
    const transitive = reachesResolverTransitively(route);
    if (!directResolver && !transitive) continue;

    // Ignore marker exempts transitive-only routes; never a direct in-file call.
    if (!directResolver && IGNORE_RE.test(raw)) { ignoredCount++; continue; }

    const awaitedWarms = analysis.warmCalls.filter((w) => w.awaited);
    if (awaitedWarms.length === 0) {
      violations.push({
        rel,
        reason: analysis.warmCalls.length > 0
          ? 'loadModelOverrides() is present but never awaited'
          : 'no awaited loadModelOverrides() call',
      });
      continue;
    }

    // Ordering: within each function that has both a direct resolver and an
    // awaited warm, the warm must precede the resolver.
    let orderBad = false;
    const fns = new Set([...analysis.resolverCalls.map((r) => r.fn), ...awaitedWarms.map((w) => w.fn)]);
    for (const fn of fns) {
      const rcs = analysis.resolverCalls.filter((r) => r.fn === fn);
      const wcs = awaitedWarms.filter((w) => w.fn === fn);
      if (rcs.length && wcs.length) {
        if (Math.min(...wcs.map((w) => w.pos)) > Math.min(...rcs.map((r) => r.pos))) orderBad = true;
      }
    }
    if (orderBad) {
      violations.push({ rel, reason: 'a getModelForApp/getFallbackModelForApp call precedes the awaited loadModelOverrides() in the same function' });
      continue;
    }

    warmCount++;
  }

  if (violations.length > 0) {
    console.error(
      `model-override-warming FAILED: ${violations.length} route(s) resolve an LLM model ` +
      `(directly or via an imported service) without a correctly-sequenced loadModelOverrides().\n` +
      `Without an awaited warm BEFORE resolution, getModelForApp() returns the raw tier alias (e.g. "sonnet") and Anthropic 404s in prod.\n` +
      `Fix: add\n` +
      `    import { loadModelOverrides } from '<path>/lib/services/model-override-loader';\n` +
      `  and \`await loadModelOverrides();\` near the top of the handler, BEFORE any model resolution.\n` +
      `If the route imports a mixed module but genuinely never reaches a model resolution, assert it with:\n` +
      `    // model-override-warming:ignore reason=<short-id>\n` +
      `(The ignore marker exempts transitive reachability only; a direct getModelForApp call in the route still requires warming.)\n`
    );
    for (const v of violations) console.error(`  ✗ ${v.rel} — ${v.reason}`);
    process.exit(1);
  }

  console.log(
    `model-override-warming OK — ${routes.length} route(s) scanned; ` +
    `${warmCount} resolve a model and warm overrides (awaited, before resolution); ` +
    `${ignoredCount} marked ignore; ${resolverModules.size} model-resolving module(s).`
  );
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}

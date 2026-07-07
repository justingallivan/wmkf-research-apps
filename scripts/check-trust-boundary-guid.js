#!/usr/bin/env node
/**
 * CI gate: a client-supplied id that reaches a Dataverse record-id selector must
 * be GUID-validated first.
 *
 * Background — the recurring trust-boundary defect class Codex caught at S259:
 *   DynamicsService.getRecord/updateRecord/deleteRecord(entitySet, id) interpolate
 *   `id` RAW into the request URL (`${entitySet}(${id})`, lib/services/
 *   dynamics-service.js), and the reviewer-suggestion adapter's findByRequest
 *   interpolates its requestId RAW into an OData `$filter`. When `id` arrives from
 *   `req.query` / `req.body` with only a presence check, a crafted value breaks
 *   out of the key predicate / filter (over-fetch / IDOR / filter injection). The
 *   canonical fix is a strict GUID check at the route edge BEFORE the id reaches
 *   any selector (lib/utils/guid.js: isGuid / allGuids; or an inline GUID_RE.test).
 *   This had been applied to one route (resolve-request.js) but missed across the
 *   rest of the reviewer surface; this gate converts the omission into CI red.
 *
 * Rule — for every route file under pages/api/:
 *   A CallExpression to a known id-SINK whose id-position argument is tainted by
 *   `req.query` / `req.body` must have that taint-root validated, somewhere in the
 *   file, by a recognized GUID guard.
 *
 *   Sinks (id-arg position):
 *     DynamicsService.getRecord/updateRecord/deleteRecord  → arg 1
 *     adapter findById/updateLifecycle/softDelete/findByRequest/bulkUpdateByRequest → arg 0
 *   Object-argument sinks (id is a named property of the first-arg object):
 *     executePrompt({ requestId })  → forwards requestId raw to getById/updateById
 *       inside the Executor, reaching the same `akoya_requests(${id})` predicate.
 *   Recognized guards (must name the same taint-root):
 *     isGuid(x) · allGuids(x) · guidToFolderSuffix(x)
 *     <GUID-ish>.test(x)            (object identifier matching /GUID|UUID/i, e.g. GUID_RE.test, GUID_PATTERN.test)
 *     x.every(isGuid) / x.some(isGuid)
 *   Wrapper-digging: String(x)/x.trim() etc. resolve to root x, so
 *   `GUID_RE.test(String(requestId))` validates `requestId`.
 *
 * Taint model (intra-FILE, conservative):
 *   - Base: any name bound from an initializer whose subtree reads `req.query` /
 *     `req.body` (covers destructuring, `req.body || {}`, and `req.query.x ? … : …`).
 *   - Propagation: `=`/declarator aliasing, `for (const x of TAINTED)`, and
 *     `TAINTED.map/forEach/filter/some/every((x)=>…)` callback params (param's
 *     iterable root is remembered, so a guard on the COLLECTION — allGuids(ids)
 *     or isGuid(d.foo) for d over the collection — validates every iteration).
 *   - An inline `req.query.x` / `req.body.x` passed straight into a sink is always
 *     a violation (there is no named root to validate).
 *
 * Detection is AST-based (@babel/parser): a sink/guard in a COMMENT or STRING
 * never counts. Guard recognition is by taint-ROOT identifier (documented limit:
 * two members off the same guarded root are treated as covered together).
 *
 * Exemption — a same-file marker for a sink whose id is provably not client-
 * controlled in a way this intra-file model can see (e.g. resolved from a record
 * the route already fetched, in a helper this gate doesn't follow):
 *     // trust-boundary-guid:ignore reason=<short-id>
 * Use sparingly; reviewers should treat adding one as load-bearing.
 *
 * Known residual limits (documented, not silently ignored):
 *   - Interprocedural taint is NOT modeled: an id passed into a helper function
 *     and used as a selector inside it is not traced (the guard at the call site
 *     still satisfies a human reviewer; the gate simply won't flag it). Same
 *     boundary class as check-model-override-warming.
 *   - A request object named other than `req` is not recognized as a taint source.
 *   - Validation is presence-based within the file, not control-flow-ordered
 *     (validating a var AFTER its sink use — a nonsensical, unobserved pattern —
 *     would read as guarded).
 * If one of these patterns is introduced, extend this gate.
 *
 * Usage: node scripts/check-trust-boundary-guid.js [--root <dir>]
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

const ROUTES_REL_DIR = path.join('pages', 'api');

// Sink call name → index of the record-id argument.
const SINKS = new Map([
  ['getRecord', 1],
  ['updateRecord', 1],
  ['deleteRecord', 1],
  ['findById', 0],
  ['updateLifecycle', 0],
  ['softDelete', 0],
  ['findByRequest', 0],
  ['bulkUpdateByRequest', 0],
]);

// Object-argument sinks: the record-id is a NAMED property of the first-arg
// object, not a positional argument. executePrompt({ requestId }) forwards
// requestId RAW to grantRequestAdapter.getById/updateById inside the Executor →
// the same `akoya_requests(${id})` key predicate, so a route handing it a
// client-supplied id must GUID-validate exactly as for a direct getRecord call.
const OBJECT_ARG_SINKS = new Map([
  ['executePrompt', 'requestId'],
]);

const GUARD_FN_NAMES = new Set(['isGuid', 'allGuids', 'guidToFolderSuffix']);
const ARRAY_GUARD_METHODS = new Set(['every', 'some']);
const ITERATING_METHODS = new Set(['map', 'forEach', 'filter', 'some', 'every', 'reduce', 'flatMap']);
const IGNORE_RE = /trust-boundary-guid:ignore(?:\s+reason=[\w-]+)?/;

function collectRouteFiles(root) {
  const base = path.join(root, ROUTES_REL_DIR);
  const out = [];
  if (!fs.existsSync(base)) return out;
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
  return out;
}

function parseFile(src, rel) {
  try {
    return babel.parse(src, { sourceType: 'unambiguous', errorRecovery: true, plugins: ['jsx'] });
  } catch (e) {
    throw new Error(`trust-boundary-guid parse error in ${rel}: ${e.message}`);
  }
}

// Leftmost identifier name of a value expression, digging through member access
// and identity-ish wrappers: String(x), x.trim(), x[0]!, etc. → x.
function rootName(node) {
  if (!node) return null;
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return rootName(node.object);
    case 'CallExpression':
    case 'OptionalCallExpression':
      if (node.callee && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')) {
        return rootName(node.callee.object); // x.trim(), x.toString()
      }
      if (node.arguments && node.arguments.length) return rootName(node.arguments[0]); // String(x), Number(x)
      return null;
    case 'TSNonNullExpression':
      return rootName(node.expression);
    default:
      return null;
  }
}

// Callee name for an Identifier or non-computed member (foo.bar() → "bar").
function calleeName(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression')
      && !callee.computed && callee.property && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

// True iff the subtree reads `req.query` or `req.body` (the base taint source).
function containsReqAccess(node, seen = new Set()) {
  if (!node || typeof node.type !== 'string' || seen.has(node)) return false;
  seen.add(node);
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
      && node.object && node.object.type === 'Identifier' && node.object.name === 'req'
      && node.property && node.property.type === 'Identifier'
      && (node.property.name === 'query' || node.property.name === 'body')) {
    return true;
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k.endsWith('Comments')) continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (containsReqAccess(c, seen)) return true; }
    else if (v && typeof v.type === 'string') { if (containsReqAccess(v, seen)) return true; }
  }
  return false;
}

// Bound local identifier names of a binding target (Identifier / ObjectPattern /
// ArrayPattern, incl. rename and rest).
function patternNames(id, out = []) {
  if (!id) return out;
  switch (id.type) {
    case 'Identifier': out.push(id.name); break;
    case 'ObjectPattern':
      for (const p of id.properties || []) {
        if (p.type === 'ObjectProperty') patternNames(p.value, out);
        else if (p.type === 'RestElement') patternNames(p.argument, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of id.elements || []) if (el) patternNames(el.type === 'RestElement' ? el.argument : el, out);
      break;
    case 'AssignmentPattern': patternNames(id.left, out); break;
    case 'RestElement': patternNames(id.argument, out); break;
    default: break;
  }
  return out;
}

function analyze(ast) {
  const baseTainted = new Set();                 // names bound directly from req.query/req.body
  const aliasEdges = [];                          // { targets:[], source } value aliases
  const iterableEdges = [];                       // { param, source } loop/callback params
  const sinkUses = [];                            // { name(sink), argNode, argRoot, inlineReq }
  const guardRoots = new Set();                   // taint-roots named by a recognized guard
  const guardMemberRoots = [];                    // { paramRoot } for guard on P.member (P maybe a callback param)

  (function rec(node) {
    if (!node || typeof node.type !== 'string') return;

    // ── taint sources & aliases ──────────────────────────────────────────
    if (node.type === 'VariableDeclarator' && node.init) {
      if (containsReqAccess(node.init)) {
        for (const n of patternNames(node.id)) baseTainted.add(n);
      } else {
        const src = rootName(node.init);
        if (src) aliasEdges.push({ targets: patternNames(node.id), source: src });
      }
    }
    if (node.type === 'ForOfStatement' && node.left) {
      const decl = node.left.type === 'VariableDeclaration' ? node.left.declarations[0] : null;
      const param = decl ? (decl.id.type === 'Identifier' ? decl.id.name : null)
                         : (node.left.type === 'Identifier' ? node.left.name : null);
      const src = rootName(node.right);
      if (param && src) iterableEdges.push({ param, source: src });
    }

    // ── calls: sinks, guards, iterating-callback params ──────────────────
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const cn = calleeName(node.callee);

      // Iterating method with a function callback → callback param iterates the object.
      if (cn && ITERATING_METHODS.has(cn)
          && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')) {
        const src = rootName(node.callee.object);
        const cb = node.arguments && node.arguments[0];
        if (src && cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression')
            && cb.params && cb.params[0] && cb.params[0].type === 'Identifier') {
          iterableEdges.push({ param: cb.params[0].name, source: src });
        }
      }

      // Guard recognition.
      if (cn && GUARD_FN_NAMES.has(cn)) {
        for (const a of node.arguments || []) {
          const r = rootName(a);
          if (r) { guardRoots.add(r); if (a.type === 'MemberExpression' || a.type === 'OptionalMemberExpression') guardMemberRoots.push(r); }
        }
      }
      // x.every(isGuid) / x.some(isGuid)
      if (cn && ARRAY_GUARD_METHODS.has(cn)
          && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')) {
        const arg0 = node.arguments && node.arguments[0];
        if (arg0 && arg0.type === 'Identifier' && GUARD_FN_NAMES.has(arg0.name)) {
          const r = rootName(node.callee.object);
          if (r) guardRoots.add(r);
        }
      }
      // <GUID-ish>.test(x)
      if (cn === 'test'
          && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')
          && node.callee.object && node.callee.object.type === 'Identifier'
          && /guid|uuid/i.test(node.callee.object.name)) {
        for (const a of node.arguments || []) {
          const r = rootName(a);
          if (r) guardRoots.add(r);
        }
      }

      // Sink (positional id arg).
      if (cn && SINKS.has(cn)) {
        const idx = SINKS.get(cn);
        const argNode = node.arguments && node.arguments[idx];
        if (argNode) {
          sinkUses.push({ name: cn, argNode, argRoot: rootName(argNode), inlineReq: containsReqAccess(argNode) });
        }
      }
      // Sink (id as a named property of the first-arg object, e.g.
      // executePrompt({ requestId })). The property VALUE is the id expression.
      if (cn && OBJECT_ARG_SINKS.has(cn)) {
        const propName = OBJECT_ARG_SINKS.get(cn);
        const argNode = node.arguments && node.arguments[0];
        if (argNode && argNode.type === 'ObjectExpression') {
          for (const p of argNode.properties || []) {
            if (p.type === 'ObjectProperty' && !p.computed && p.key
                && ((p.key.type === 'Identifier' && p.key.name === propName)
                    || (p.key.type === 'StringLiteral' && p.key.value === propName))) {
              sinkUses.push({ name: cn, argNode: p.value, argRoot: rootName(p.value), inlineReq: containsReqAccess(p.value) });
            }
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k.endsWith('Comments')) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) rec(c); }
      else if (v && typeof v.type === 'string') rec(v);
    }
  })(ast.program);

  // Source graph: name → set of names it derives from (alias + iterable edges).
  // Multi-valued because a name can be bound in more than one place (e.g. a `id`
  // reused as both `coll.map(id=>…)` and `for (const id of other)`); we keep ALL
  // sources and later validate if ANY of them reaches a guard — biasing a
  // BLOCKING gate toward never false-positively wedging a correct commit.
  const sourcesOf = new Map();
  const addSource = (t, s) => { if (!sourcesOf.has(t)) sourcesOf.set(t, new Set()); sourcesOf.get(t).add(s); };
  for (const e of aliasEdges) for (const t of e.targets) addSource(t, e.source);
  for (const e of iterableEdges) addSource(e.param, e.source);

  // Fixpoint: propagate base taint forward through alias + iterable edges.
  const tainted = new Set(baseTainted);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of aliasEdges) {
      if (tainted.has(e.source)) for (const t of e.targets) if (!tainted.has(t)) { tainted.add(t); changed = true; }
    }
    for (const e of iterableEdges) {
      if (tainted.has(e.source) && !tainted.has(e.param)) { tainted.add(e.param); changed = true; }
    }
  }

  // A guard on `P.member` validates the collection P iterates, too — every
  // element was checked up front (covers `for (const d of drafts) … isGuid(d.id)`).
  for (const r of guardMemberRoots) {
    for (const s of (sourcesOf.get(r) || [])) guardRoots.add(s);
  }

  return { tainted, sourcesOf, sinkUses, guardRoots };
}

// True iff `root` (or any name it transitively derives from) is GUID-guarded.
function reachesGuard(root, sourcesOf, guardRoots) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (guardRoots.has(cur)) return true;
    for (const s of (sourcesOf.get(cur) || [])) if (!seen.has(s)) stack.push(s);
  }
  return false;
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const routes = collectRouteFiles(root);

  const violations = []; // { rel, sink, arg }
  let guardedRouteCount = 0;
  let ignoredCount = 0;
  let sinkRouteCount = 0;

  for (const route of routes) {
    const raw = fs.readFileSync(route, 'utf8');
    const rel = path.relative(root, route);
    const { tainted, sourcesOf, sinkUses, guardRoots } = analyze(parseFile(raw, rel));
    if (sinkUses.length === 0) continue;

    if (IGNORE_RE.test(raw)) { ignoredCount++; continue; }

    let routeHadTaintedSink = false;
    let routeViolated = false;
    for (const s of sinkUses) {
      const taintedArg = s.inlineReq || (s.argRoot && tainted.has(s.argRoot));
      if (!taintedArg) continue;
      routeHadTaintedSink = true;

      // Validated iff the arg-root (or any name it derives from) is GUID-guarded.
      const validated = !s.inlineReq && s.argRoot && reachesGuard(s.argRoot, sourcesOf, guardRoots);
      if (!validated) {
        routeViolated = true;
        violations.push({
          rel,
          sink: s.name,
          arg: s.inlineReq ? raw.slice(s.argNode.start, s.argNode.end) : (s.argRoot || '<expr>'),
        });
      }
    }
    if (routeHadTaintedSink) sinkRouteCount++;
    if (routeHadTaintedSink && !routeViolated) guardedRouteCount++;
  }

  if (violations.length > 0) {
    console.error(
      `trust-boundary-guid FAILED: ${violations.length} client-supplied id(s) reach a Dataverse selector without a GUID guard.\n` +
      `DynamicsService.getRecord/updateRecord interpolate the id raw into the request URL, and adapter findByRequest into an OData $filter —\n` +
      `an unvalidated req.query/req.body id is an over-fetch / IDOR / filter-injection vector.\n` +
      `Fix: import { isGuid } from '<path>/lib/utils/guid' and reject before the selector, e.g.\n` +
      `    if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId is not a valid GUID' });\n` +
      `(use allGuids(ids) for batch arrays). If the id is provably not client-controlled here, assert it with:\n` +
      `    // trust-boundary-guid:ignore reason=<short-id>\n`
    );
    for (const v of violations) console.error(`  ✗ ${v.rel} — ${v.sink}(…) id arg \`${v.arg}\` is client-tainted but never GUID-validated`);
    process.exit(1);
  }

  console.log(
    `trust-boundary-guid OK — ${routes.length} route(s) scanned; ` +
    `${sinkRouteCount} pass a client id into a Dataverse selector, all GUID-validated; ` +
    `${ignoredCount} marked ignore.`
  );
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(2);
}

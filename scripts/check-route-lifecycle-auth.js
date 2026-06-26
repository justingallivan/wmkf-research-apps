#!/usr/bin/env node
'use strict';

/**
 * check:route-lifecycle-auth
 *
 * Verifies the `guardAppKeys` auth contract declared on each
 * ROUTE_NAMESPACE_LIFECYCLE entry (shared/config/appRegistry.js) against the
 * ACTUAL requireAppAccess(...) app-key arguments in the live route source.
 *
 * This exists because S291 nomenclature Commit 1 hand-wrote a route's auth owner
 * from inference and it was wrong, yet every green gate passed — no gate compared
 * the claim to source. This gate IS that comparison: a skipped or wrong trace now
 * fails CI regardless of whether anyone traced it.
 *
 * SCOPE: ONLY the namespaces listed in ROUTE_NAMESPACE_LIFECYCLE. This is NOT a
 * complete route-auth verifier — repo-wide guard derivation is intentionally out
 * of scope (constant keys, spreads, method-specific guards, HMAC/cron/shared
 * secret guards make a general version unreliable; see the S291 Codex review).
 *
 * FAIL-CLOSED: a handler that can't be located, a guard that can't be statically
 * parsed, or a namespace marked heterogeneous that is actually uniform — all FAIL.
 * Nothing is silently skipped.
 *
 * Each entry must declare `guardAppKeys` explicitly:
 *   - array  → every handler in the namespace must accept exactly that set.
 *   - null   → guards are heterogeneous; requires a `guardNote`, and the gate
 *              confirms the namespace really is heterogeneous (not a uniform set
 *              you forgot to list).
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const repoRoot = path.resolve(__dirname, '..');

function parseJs(source, label) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'dynamicImport', 'objectRestSpread', 'classProperties'],
    errorRecovery: false,
  });
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' ||
        key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    if (Array.isArray(value)) for (const c of value) walk(c, visit);
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

function uniqSort(arr) {
  return [...new Set(arr)].sort();
}

function setsEqual(a, b) {
  const x = uniqSort(a);
  const y = uniqSort(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Parse the requireAppAccess(...) app-key arguments out of one route file source.
 * Resolves string literals, simple top-level const string/array bindings, and
 * `...SPREAD` of a const string array. Anything else marks the call unparseable.
 *
 * Returns { calls: [{ keys: string[], unparseable: boolean }] }.
 * The first two args (req, res) are skipped; app keys are args[2:].
 */
function parseAcceptedKeysFromSource(source, label = '<source>') {
  const ast = parseJs(source, label);

  // Collect simple const bindings: name -> string | string[]
  const bindings = new Map();
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.id || node.id.type !== 'Identifier' || !node.init) return;
    const init = node.init;
    if (init.type === 'StringLiteral') {
      bindings.set(node.id.name, init.value);
    } else if (init.type === 'ArrayExpression' &&
               init.elements.every((e) => e && e.type === 'StringLiteral')) {
      bindings.set(node.id.name, init.elements.map((e) => e.value));
    }
  });

  const calls = [];
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (!callee || callee.type !== 'Identifier' || callee.name !== 'requireAppAccess') return;
    const args = node.arguments.slice(2); // drop req, res
    const keys = [];
    let unparseable = false;
    for (const arg of args) {
      if (arg.type === 'StringLiteral') {
        keys.push(arg.value);
      } else if (arg.type === 'Identifier' && bindings.has(arg.name)) {
        const v = bindings.get(arg.name);
        if (Array.isArray(v)) keys.push(...v); else keys.push(v);
      } else if (arg.type === 'SpreadElement' && arg.argument.type === 'Identifier' &&
                 bindings.has(arg.argument.name) && Array.isArray(bindings.get(arg.argument.name))) {
        keys.push(...bindings.get(arg.argument.name));
      } else {
        unparseable = true;
      }
    }
    calls.push({ keys: uniqSort(keys), unparseable });
  });

  return { calls };
}

/** Extract the ROUTE_NAMESPACE_LIFECYCLE object from appRegistry.js as a plain JS map. */
function loadLifecycleEntries() {
  const rel = 'shared/config/appRegistry.js';
  const ast = parseJs(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), rel);
  let obj = null;
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.id || node.id.name !== 'ROUTE_NAMESPACE_LIFECYCLE') return;
    obj = node.init;
  });
  if (!obj || obj.type !== 'ObjectExpression') {
    throw new Error('ROUTE_NAMESPACE_LIFECYCLE export not found / not an object literal in ' + rel);
  }
  const entries = {};
  for (const prop of obj.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const routePath = prop.key.type === 'StringLiteral' ? prop.key.value
      : (prop.key.type === 'Identifier' ? prop.key.name : null);
    if (!routePath) continue;
    const entry = { hasGuardAppKeys: false, guardAppKeys: undefined, guardNote: undefined };
    if (prop.value.type === 'ObjectExpression') {
      for (const p of prop.value.properties) {
        if (p.type !== 'ObjectProperty' || p.computed || p.key.type !== 'Identifier') continue;
        if (p.key.name === 'guardAppKeys') {
          entry.hasGuardAppKeys = true;
          if (p.value.type === 'NullLiteral') entry.guardAppKeys = null;
          else if (p.value.type === 'ArrayExpression' && p.value.elements.every((e) => e && e.type === 'StringLiteral')) {
            entry.guardAppKeys = p.value.elements.map((e) => e.value);
          } else entry.guardAppKeys = '<unparseable>';
        }
        if (p.key.name === 'guardNote' && p.value.type === 'StringLiteral') entry.guardNote = p.value.value;
      }
    }
    entries[routePath] = entry;
  }
  return entries;
}

/** Resolve a '/api/x' namespace key to its handler file paths (absolute). */
function resolveHandlerFiles(routePath) {
  if (!routePath.startsWith('/api/')) return { error: `not an /api/ route: ${routePath}`, files: [] };
  const rel = routePath.replace(/^\//, ''); // api/x
  const asFile = path.join(repoRoot, 'pages', rel + '.js');
  const asDir = path.join(repoRoot, 'pages', rel);
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return { files: [asFile] };
  if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
    const out = [];
    (function rec(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) rec(full);
        else if (/\.(js|jsx|ts|tsx)$/.test(ent.name)) out.push(full);
      }
    })(asDir);
    if (out.length === 0) return { error: `no handler files under ${routePath}`, files: [] };
    return { files: out };
  }
  return { error: `no route file or directory for ${routePath}`, files: [] };
}

/**
 * Build per-file accepted-key sets for a namespace, using an injectable reader so
 * the self-test can feed synthetic source. reader(file) -> source string.
 * Returns { fileSets: [{ file, sets: string[][], unparseable, noGuard }], error? }
 */
function collectFileSets(files, reader) {
  const fileSets = [];
  for (const file of files) {
    let src;
    try { src = reader(file); } catch (e) { return { error: `cannot read ${file}: ${e.message}`, fileSets }; }
    let parsed;
    try { parsed = parseAcceptedKeysFromSource(src, file); }
    catch (e) { return { error: `cannot parse ${file}: ${e.message}`, fileSets }; }
    const guardCalls = parsed.calls;
    const unparseable = guardCalls.some((c) => c.unparseable);
    fileSets.push({
      file,
      sets: guardCalls.map((c) => c.keys),
      unparseable,
      noGuard: guardCalls.length === 0,
    });
  }
  return { fileSets };
}

/**
 * Pure verification of ONE entry. fileSetsFor(routePath) -> { fileSets, error? }.
 * Returns string[] of errors (empty = ok).
 */
function evaluateEntry(routePath, entry, fileSetsFor) {
  const errors = [];
  if (!entry.hasGuardAppKeys) {
    errors.push(`${routePath}: missing required \`guardAppKeys\` (declare an array, or null + guardNote).`);
    return errors;
  }
  if (entry.guardAppKeys === '<unparseable>') {
    errors.push(`${routePath}: guardAppKeys is neither a string-array nor null.`);
    return errors;
  }

  const resolved = fileSetsFor(routePath);
  if (resolved.error) { errors.push(`${routePath}: ${resolved.error}`); return errors; }
  const fileSets = resolved.fileSets || [];
  if (fileSets.length === 0) { errors.push(`${routePath}: no handler files resolved.`); return errors; }

  // Fail-closed on any unparseable guard.
  for (const fs2 of fileSets) {
    if (fs2.unparseable) errors.push(`${routePath}: requireAppAccess args not statically parseable in ${path.relative(repoRoot, fs2.file)}.`);
  }
  if (errors.length) return errors;

  if (Array.isArray(entry.guardAppKeys)) {
    // Every handler must declare a guard, and every call must accept exactly the set.
    for (const fs2 of fileSets) {
      if (fs2.noGuard) { errors.push(`${routePath}: ${path.relative(repoRoot, fs2.file)} has no requireAppAccess guard (cannot confirm guardAppKeys).`); continue; }
      for (const set of fs2.sets) {
        if (!setsEqual(set, entry.guardAppKeys)) {
          errors.push(`${routePath}: ${path.relative(repoRoot, fs2.file)} accepts [${set.join(', ')}] but guardAppKeys declares [${entry.guardAppKeys.join(', ')}].`);
        }
      }
    }
  } else {
    // null → must have a guardNote, every route must still carry a parseable
    // guard (fail-closed — an aliased/out-of-file/missing guard is NOT silently
    // accepted), AND the namespace must be genuinely heterogeneous.
    if (!entry.guardNote) errors.push(`${routePath}: guardAppKeys is null but no guardNote explains the heterogeneity.`);
    const distinct = new Set();
    let noGuardCount = 0;
    for (const fs2 of fileSets) {
      if (fs2.noGuard) {
        noGuardCount++;
        errors.push(`${routePath}: ${path.relative(repoRoot, fs2.file)} has no parseable requireAppAccess guard (a heterogeneous namespace still requires every route to carry a recognizable guard — fail-closed).`);
        continue;
      }
      for (const set of fs2.sets) distinct.add(uniqSort(set).join('|'));
    }
    if (noGuardCount === 0 && distinct.size <= 1) {
      const only = [...distinct][0] || '';
      errors.push(`${routePath}: marked heterogeneous (guardAppKeys: null) but all handlers share one accepted set [${only.split('|').join(', ')}] — declare guardAppKeys explicitly instead.`);
    }
  }
  return errors;
}

function main() {
  const entries = loadLifecycleEntries();
  const fileSetsFor = (routePath) => {
    const r = resolveHandlerFiles(routePath);
    if (r.error) return { error: r.error };
    return collectFileSets(r.files, (f) => fs.readFileSync(f, 'utf8'));
  };

  const allErrors = [];
  const checked = [];
  for (const [routePath, entry] of Object.entries(entries)) {
    const errs = evaluateEntry(routePath, entry, fileSetsFor);
    if (errs.length) allErrors.push(...errs);
    else checked.push(routePath);
  }

  if (allErrors.length) {
    console.error('✗ route-lifecycle-auth: guardAppKeys does not match live route source:\n');
    for (const e of allErrors) console.error('  ✗ ' + e);
    console.error(`\n${allErrors.length} problem(s). guardAppKeys is the auth contract — fix it to match the route\'s requireAppAccess args (or fix the route).`);
    process.exit(1);
  }
  console.log(`route-lifecycle-auth OK — ${checked.length} ROUTE_NAMESPACE_LIFECYCLE entr${checked.length === 1 ? 'y' : 'ies'} verified against live route source.`);
}

module.exports = {
  parseAcceptedKeysFromSource,
  evaluateEntry,
  collectFileSets,
  loadLifecycleEntries,
  resolveHandlerFiles,
  setsEqual,
};

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('✗ route-lifecycle-auth: ' + (e.message || e)); process.exit(1); }
}

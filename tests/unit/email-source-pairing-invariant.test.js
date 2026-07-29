/**
 * @jest-environment node
 *
 * S387 invariant, third adversarial review: a reviewer ADDRESS is never written without its
 * PROVENANCE. `potential-reviewer.js`'s four writers (create / upsertByEmail / update /
 * clearEmail) all carry `wmkf_emailsource`, but the field is dropped by `pruneEmpty` when a
 * CALLER omits it — so adapter support alone does not make the invariant hold. Two reviews
 * each found a caller I had missed (`save-candidates`' person upsert, then
 * `backfill-postgres-to-dataverse.js`), which is exactly the "which sibling surfaces have
 * the same shape?" failure this test exists to end.
 *
 * It scans real call sites rather than asserting behavior, because the defect is an OMISSION
 * at a call site: no behavioral test can see a caller nobody wrote a test for.
 */

const fs = require('fs');
const path = require('path');
// `@babel/parser` is a declared dependency; `@babel/traverse` is NOT — it is only present
// as a transitive of @babel/core, so importing it would make this test depend on hoisting
// that no manifest guarantees. The walk below is 10 lines and needs nothing extra.
const parser = require('@babel/parser');

/** Depth-first visit of every AST node of a given type. */
function walk(node, type, visit, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) walk(child, type, visit, seen);
    return;
  }
  if (node.type === type) visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk(node[key], type, visit, seen);
  }
}

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'pages', 'scripts', 'shared'];

// Receivers known to be the potential-reviewer adapter. A bare `upsertByEmail` is included
// for test/alias imports and known adapter aliases may call `.upsertByEmail`, `.update`,
// or `.create`; the generic method names stay qualified to avoid matching other adapters
// that legitimately take an `email` field with no provenance concept.

// Deliberate exemptions, each with its reason stated. Adding one requires arguing for it
// here rather than quietly omitting a source. These two are NOT writers of application
// state in the sense the invariant governs:
const EXEMPT = new Set([
  // A field-DESCRIPTION map inside a prompt (`wmkf_emailaddress: 'string — email'`), not a
  // write payload. It documents the entity's shape for the model; pairing a doc entry with
  // a provenance entry would be meaningless.
  'shared/config/prompts/dynamics-explorer.js',
  // A probe whose entire PURPOSE is to observe Dataverse's `wmkf_emailaddress_unique`
  // alt-key behavior — it sets the address alone, deliberately, to see which orderings 412.
  // Adding a source would change what it measures, and it writes throwaway probe rows.
  'scripts/probe-merge-altkey-ordering.mjs',
]);

function listFiles(dir) {
  const out = [];
  const stack = [path.join(ROOT, dir)];
  if (!fs.existsSync(stack[0])) {
    throw new Error(`email-source scanner root is missing: ${dir}`);
  }
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (/\.(js|mjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

function parseFile(file) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'importAssertions', 'topLevelAwait'],
    errorRecovery: true,
  });
  // `errorRecovery` keeps a syntax the plugin list does not cover from throwing — but a
  // partially-parsed file would be scanned partially and SILENTLY, which is the vacuous-pass
  // failure this scanner exists to avoid. Zero of the 1053 scanned files produce errors
  // today, so make a future one loud instead of invisible.
  if (ast.errors?.length) {
    const detail = ast.errors.slice(0, 3).map((e) => e.reasonCode || e.message).join(', ');
    throw new Error(`email-source scanner could not fully parse ${path.relative(ROOT, file)}: ${detail}`);
  }
  return ast;
}

function keyName(key) {
  if (!key) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  return null;
}

function hasObjectProperty(node, name) {
  return node?.type === 'ObjectExpression'
    && node.properties.some((prop) => prop.type === 'ObjectProperty' && keyName(prop.key) === name);
}

function calleeName(callee) {
  if (callee?.type === 'Identifier') return callee.name;
  if (callee?.type !== 'MemberExpression') return null;
  const object = callee.object?.type === 'Identifier' ? callee.object.name : null;
  const property = keyName(callee.property);
  return object && property ? `${object}.${property}` : null;
}

function isPotentialReviewerWriteCallee(name) {
  if (name === 'upsertByEmail' || name === 'createPotentialReviewer') return true;
  return /^(potentialReviewerAdapter|potentialReviewer|prAdapter|pr)\.(create|update|upsertByEmail)$/.test(name || '');
}

function lineOf(node) {
  return node.loc?.start?.line || 0;
}

/**
 * Second class of writer: a RAW Dataverse payload that sets `wmkf_emailaddress` directly,
 * bypassing the adapter (smoke tests and probes do this). The adapter cannot enforce
 * anything about these, so the scan has to see them too — `$select` strings are naturally
 * excluded because they list fields comma-separated, without a colon.
 */
function rawPayloadViolationsIn(file) {
  const rel = path.relative(ROOT, file);
  if (EXEMPT.has(rel)) return [];
  const found = [];
  const ast = parseFile(file);
  walk(ast.program, 'ObjectExpression', (object) => {
    if (hasObjectProperty(object, 'wmkf_emailaddress') && !hasObjectProperty(object, 'wmkf_emailsource')) {
      found.push(`${rel}:${lineOf(object)} — raw payload sets wmkf_emailaddress with no wmkf_emailsource`);
    }
  });
  return found;
}

function violationsIn(file) {
  const rel = path.relative(ROOT, file);
  if (EXEMPT.has(rel)) return [];
  const found = [];
  const ast = parseFile(file);
  walk(ast.program, 'CallExpression', (call) => {
    const name = calleeName(call.callee);
    if (!isPotentialReviewerWriteCallee(name)) return;
    for (const arg of call.arguments) {
      if (hasObjectProperty(arg, 'email') && !hasObjectProperty(arg, 'emailSource')) {
        found.push(`${rel}:${lineOf(arg)} — ${name} passes an address with no emailSource`);
      }
    }
  });
  return found;
}

test('every potential-reviewer write that sets an address also sets its provenance', () => {
  const files = SCAN_DIRS.flatMap(listFiles);
  expect(files.length).toBeGreaterThan(0);
  const violations = files.flatMap(violationsIn);
  expect(violations).toEqual([]);
});

test('no raw Dataverse payload sets the address field without its source field', () => {
  const files = SCAN_DIRS.flatMap(listFiles);
  expect(files.length).toBeGreaterThan(0);
  const violations = files.flatMap(rawPayloadViolationsIn);
  expect(violations).toEqual([]);
});

/** Run the real call-site detector over a source string. */
function detectInSource(source) {
  const ast = parser.parse(source, { sourceType: 'unambiguous' });
  const found = [];
  walk(ast.program, 'CallExpression', (call) => {
    const name = calleeName(call.callee);
    if (!isPotentialReviewerWriteCallee(name)) return;
    for (const arg of call.arguments) {
      if (hasObjectProperty(arg, 'email') && !hasObjectProperty(arg, 'emailSource')) {
        found.push(`${name}@${lineOf(arg)}`);
      }
    }
  });
  return found;
}

test('the scanner actually detects the shape it guards (would fail if the guard were empty)', () => {
  // Positive control: the exact shape the reviews found in production code.
  expect(detectInSource(`
    const { id } = await potentialReviewerAdapter.upsertByEmail({
      name: row.name,
      email: row.email,
      affiliation: row.affiliation,
    });
  `)).toHaveLength(1);

  // …and does NOT flag the paired shape.
  expect(detectInSource(
    `await potentialReviewerAdapter.update(id, { email, emailSource: 'manual' });`,
  )).toEqual([]);

  // Shapes a regex/brace scanner got wrong and an AST walk must not: an address inside a
  // template string, a comment, or a regex containing braces is NOT a write.
  expect(detectInSource('const q = `upsertByEmail({ email: x })`;')).toEqual([]);
  expect(detectInSource('// potentialReviewerAdapter.update(id, { email: x })')).toEqual([]);
  expect(detectInSource('const re = /update\\(id, \\{ email: x \\}\\)/;')).toEqual([]);
  // …and a NESTED literal must not hide a violation from the walk.
  expect(detectInSource(`
    await potentialReviewerAdapter.update(id, { email: e, meta: { emailSource: 'manual' } });
  `)).toHaveLength(1);
});

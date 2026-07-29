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

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'pages', 'scripts', 'shared'];

// Receivers known to be the potential-reviewer adapter. A bare `upsertByEmail(` is included
// for test/alias imports; `.update(`/`.create(` are qualified to avoid matching other
// adapters that legitimately take an `email:` field with no provenance concept.
const CALL_PATTERNS = [
  /\bupsertByEmail\s*\(/g,
  /\b(?:potentialReviewerAdapter|potentialReviewer|prAdapter|pr)\s*\.\s*create\s*\(/g,
  /\b(?:potentialReviewerAdapter|potentialReviewer|prAdapter|pr)\s*\.\s*update\s*\(/g,
  /\bcreatePotentialReviewer\s*\(/g,
];

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

/** Balanced-brace slice of the first object literal after `from`, or null. */
function objectLiteralAfter(text, from) {
  const open = text.indexOf('{', from);
  if (open === -1) return null;
  // Bail if a ')' closes the call before any '{' — then there is no object literal arg.
  const closeParen = text.indexOf(')', from);
  if (closeParen !== -1 && closeParen < open) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/** Balanced-brace slice of the object literal ENCLOSING `index`, or null. */
function enclosingObjectLiteral(text, index) {
  let depth = 0;
  let open = -1;
  for (let i = index; i >= 0; i--) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      if (depth === 0) { open = i; break; }
      depth -= 1;
    }
  }
  if (open === -1) return null;
  return objectLiteralAfter(text, open);
}

/**
 * Second class of writer: a RAW Dataverse payload that sets `wmkf_emailaddress` directly,
 * bypassing the adapter (smoke tests and probes do this). The adapter cannot enforce
 * anything about these, so the scan has to see them too — `$select` strings are naturally
 * excluded because they list fields comma-separated, without a colon.
 */
function rawPayloadViolationsIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  if (EXEMPT.has(rel)) return [];
  const found = [];
  const pattern = /wmkf_emailaddress\s*:/g;
  let match = pattern.exec(text);
  while (match) {
    const literal = enclosingObjectLiteral(text, match.index);
    if (literal && !/wmkf_emailsource/.test(literal)) {
      const line = text.slice(0, match.index).split('\n').length;
      found.push(`${rel}:${line} — raw payload sets wmkf_emailaddress with no wmkf_emailsource`);
    }
    match = pattern.exec(text);
  }
  return found;
}

function violationsIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  if (EXEMPT.has(rel)) return [];
  const found = [];
  for (const pattern of CALL_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const literal = objectLiteralAfter(text, match.index + match[0].length - 1);
      if (literal && /(^|[^a-zA-Z])email\s*[:,}]/.test(literal) && !/emailSource/.test(literal)) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push(`${rel}:${line} — ${match[0].trim()} passes an address with no emailSource`);
      }
      match = pattern.exec(text);
    }
  }
  return found;
}

test('every potential-reviewer write that sets an address also sets its provenance', () => {
  const violations = SCAN_DIRS.flatMap((dir) => listFiles(dir).flatMap(violationsIn));
  expect(violations).toEqual([]);
});

test('no raw Dataverse payload sets the address field without its source field', () => {
  const violations = SCAN_DIRS.flatMap((dir) => listFiles(dir).flatMap(rawPayloadViolationsIn));
  expect(violations).toEqual([]);
});

test('the scanner actually detects the shape it guards (would fail if the guard were empty)', () => {
  // Positive control: the exact shape both reviews found in production code.
  const sample = `
    const { id } = await potentialReviewerAdapter.upsertByEmail({
      name: row.name,
      email: row.email,
      affiliation: row.affiliation,
    });
  `;
  const literal = objectLiteralAfter(sample, sample.indexOf('upsertByEmail('));
  expect(literal).toContain('email:');
  expect(literal).not.toContain('emailSource');

  // …and does NOT flag the paired shape.
  const paired = `await potentialReviewerAdapter.update(id, { email, emailSource: 'manual' });`;
  const pairedLiteral = objectLiteralAfter(paired, paired.indexOf('update('));
  expect(/emailSource/.test(pairedLiteral)).toBe(true);
});

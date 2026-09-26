/**
 * @jest-environment node
 *
 * P2-3 (Opus round 1): the docblock at potential-reviewer.js's
 * `findSyntheticByEmail` cites this file. It pins the allowlist: no ordinary
 * path may import the factory-only synthetic-reservation lookup. The only
 * sanctioned importer today is the definition itself (no production callers
 * exist -- Stage B's own reservation resolver deliberately does NOT use it;
 * see P2-4 below).
 *
 * Allowlist residue (Opus round 2 / P3): Stage B originally re-implemented
 * this adapter's marker/active/Contact-filtered predicate under the SAME
 * name (`findSyntheticByEmail`) in `reviews-sandbox-deps.js` and
 * `rehearse-test-request-sandbox.mjs`, so both were pre-allowlisted. Round 2
 * (P2-4) replaced that filtered predicate with an UNFILTERED
 * `findAnyPersonByEmail` in both files -- a synthetic-only lookup at
 * reservation time was found to let a real reviewer's row silently pass
 * through as "not found" and be handed a fresh preallocated GUID. The CLI
 * script no longer names the identifier `findSyntheticByEmail` anywhere
 * (verified: `grep -n findSyntheticByEmail scripts/rehearse-test-request-
 * sandbox.mjs` finds nothing), so its allowlist entry is removed as
 * vestigial. `reviews-sandbox-deps.js` still names the identifier in prose
 * (documenting why it deliberately does NOT call the adapter), so it stays
 * allowlisted below.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'pages', 'scripts'];
const DEFINITION_FILE = 'lib/dataverse/adapters/potential-reviewer.js';
const ALLOWLISTED_IMPORTERS = new Set([
  DEFINITION_FILE,
  // reviews-sandbox-deps.js names the identifier only in comments explaining
  // why its own `findAnyPersonByEmail` is deliberately unfiltered (P2-4) --
  // it never imports or calls the adapter's `findSyntheticByEmail`.
  'lib/services/test-requests/reviews-sandbox-deps.js',
]);
const IDENTIFIER = 'findSyntheticByEmail';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(js|mjs|cjs|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findImporters() {
  const importers = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(IDENTIFIER)) continue;
      importers.push(relative);
    }
  }
  return importers;
}

test('every file naming findSyntheticByEmail is the definition file or an allowlisted importer', () => {
  const importers = findImporters();
  expect(importers.length).toBeGreaterThan(0); // the definition itself must be found (sanity: the scan works)
  const unexpected = importers.filter((file) => !ALLOWLISTED_IMPORTERS.has(file));
  expect(unexpected).toEqual([]);
});

test('the definition file itself is found by the scan (negative-result sanity)', () => {
  const importers = findImporters();
  expect(importers).toContain(DEFINITION_FILE);
});

// Mutation kill: an ordinary path importing the factory-only lookup must be
// caught. Simulated by adding a throwaway file naming the identifier under a
// scratch subdirectory of lib/, scanned then removed.
describe('mutation: an unauthorized importer is caught', () => {
  const scratchDir = path.join(ROOT, 'lib', '__scratch_boundary_test__');
  const scratchFile = path.join(scratchDir, 'unauthorized-importer.js');

  afterEach(() => {
    if (fs.existsSync(scratchFile)) fs.unlinkSync(scratchFile);
    if (fs.existsSync(scratchDir)) fs.rmdirSync(scratchDir);
  });

  test('an unauthorized file importing findSyntheticByEmail fails the allowlist check', () => {
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(scratchFile, "import { findSyntheticByEmail } from '../dataverse/adapters/potential-reviewer.js';\n");

    const importers = findImporters();
    const unexpected = importers.filter((file) => !ALLOWLISTED_IMPORTERS.has(file));
    expect(unexpected).toEqual(['lib/__scratch_boundary_test__/unauthorized-importer.js']);
  });
});

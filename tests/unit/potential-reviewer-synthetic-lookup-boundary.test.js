/**
 * @jest-environment node
 *
 * P2-3 (Opus round 1): the docblock at potential-reviewer.js's
 * `findSyntheticByEmail` cites this file. It pins the allowlist: no ordinary
 * path may import the factory-only synthetic-reservation lookup. The only
 * sanctioned importer today is the definition itself (no callers exist yet);
 * the seeder module Stage B creates, `lib/services/reviewer-engagement/
 * seed-synthetic-review.js`, is pre-allowlisted so its eventual import does
 * not require touching this gate.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'pages', 'scripts'];
const DEFINITION_FILE = 'lib/dataverse/adapters/potential-reviewer.js';
const ALLOWLISTED_IMPORTERS = new Set([
  DEFINITION_FILE,
  // Stage B seeder (not yet created); pre-allowlisted per the plan's
  // "the pin may list it now" allowance.
  'lib/services/reviewer-engagement/seed-synthetic-review.js',
  // Stage B built the lookup differently than anticipated: the adapter's
  // `findSyntheticByEmail` does not take an `options.svc` (it always reads
  // through the DynamicsService singleton, i.e. process.env.DYNAMICS_URL),
  // so it cannot actually be bound to the sandbox. `reviews-sandbox-deps.js`
  // re-implements the SAME predicate (marker true, active, no Contact link,
  // exact-match) against a sandbox-bound raw read instead of importing the
  // adapter function -- this text-substring scan flags it only because it
  // names the identifier for API-shape consistency with the plan
  // (`deps.findSyntheticByEmail`), not because it imports the adapter.
  'lib/services/test-requests/reviews-sandbox-deps.js',
  // The CLI's reservation-time resolution (runReserve/resolveReviewerAssignments)
  // calls `deps.findSyntheticByEmail(...)` on the sandbox-bound deps object
  // above -- same non-import reason.
  'scripts/rehearse-test-request-sandbox.mjs',
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

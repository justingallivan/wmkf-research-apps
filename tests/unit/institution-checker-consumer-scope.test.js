/**
 * Consumer-scope assertion (docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
 * owner decision 3, "Agent-runnable evaluation harness" deliverable 3).
 *
 * The Stage 1 segment-comparison opt-in must stay confined to the
 * affiliation-mismatch alert; the enrichment and identity-evidence consumers
 * must keep constructing the checker with its legacy (segmentComparison:
 * false) default. This test re-derives the call-site set by scanning the
 * live repo tree rather than trusting a fixed list, so a NEW call site or a
 * scope leak fails the test instead of silently expanding scope.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_ROOTS = ['lib', 'pages', 'shared'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', '.next.nosync', 'node_modules.nosync']);

function listJsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJsFiles(fullPath));
    } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function allSourceFiles() {
  return SCAN_ROOTS.flatMap((root) => listJsFiles(path.join(REPO_ROOT, root)));
}

function relPath(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

describe('institution consistency checker: consumer scope', () => {
  const files = allSourceFiles();

  const callSiteRegex = /createInstitutionConsistencyChecker\s*\(/g;
  const callSitesByFile = new Map();
  const segmentComparisonTrueByFile = new Map();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const callMatches = content.match(callSiteRegex);
    if (callMatches) callSitesByFile.set(relPath(file), callMatches.length);

    const segMatches = content.match(/segmentComparison\s*:\s*true/g);
    if (segMatches) segmentComparisonTrueByFile.set(relPath(file), segMatches.length);
  }

  test('the scan itself found source files (a scan failure must fail a test, not silently pass an empty scope)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('call sites are exactly the expected set, one occurrence each: definition + the three known consumers', () => {
    // Map equality (not just key-set equality) so a SECOND call added inside
    // an already-expected file (e.g. a stray extra checker construction in
    // enrich-recommended-service.js) fails this test too, not just a call in
    // a brand-new file.
    const expected = new Map([
      ['lib/services/institution-affiliation-consistency.js', 1], // definition (the factory itself)
      ['lib/services/alert-reviewer-affiliation-mismatch.js', 1],
      ['lib/services/workbench/enrich-recommended-service.js', 1],
      ['lib/services/reviewer-identity-evidence.js', 1],
    ]);
    expect(callSitesByFile).toEqual(expected);
  });

  test('segmentComparison: true appears exactly once, only in the affiliation-mismatch alert', () => {
    expect(segmentComparisonTrueByFile).toEqual(new Map([
      ['lib/services/alert-reviewer-affiliation-mismatch.js', 1],
    ]));
  });

  test('the factory default is off: institution-affiliation-consistency.js destructures segmentComparison = false', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/services/institution-affiliation-consistency.js'),
      'utf8',
    );
    expect(source).toMatch(/segmentComparison\s*=\s*false/);
  });

  test('enrich-recommended-service.js constructs the checker with no options (bare call)', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/services/workbench/enrich-recommended-service.js'),
      'utf8',
    );
    expect(source).toMatch(/createInstitutionConsistencyChecker\(\s*\)/);
    // Guard against a bare-looking call that secretly passes an options
    // object across a line break (e.g. "createInstitutionConsistencyChecker(\n  {").
    const callMatch = source.match(/createInstitutionConsistencyChecker\(([^)]*)\)/);
    expect(callMatch).not.toBeNull();
    expect(callMatch[1].trim()).toBe('');
  });
});

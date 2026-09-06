/**
 * @jest-environment node
 *
 * Permanent removal pin for `bulkUpdateByRequest` (Reviewer Lifecycle
 * Stage 7, docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md, "7B — delete
 * bulkUpdateByRequest"). Stage 3K's interim census recorded exactly two
 * production files still naming the identifier (the adapter's own
 * definition/delegation and the trust-boundary-guid gate's sink table);
 * Stage 7 inlined the function's body verbatim into `setRequestMetadata`,
 * removed the standalone export, dropped the sink-table entry, and
 * reworded the remaining explanatory comments so the name no longer
 * appears anywhere in application code.
 *
 * This test now asserts ZERO word-bounded references to the identifier
 * `bulkUpdateByRequest` across all five production roots — `lib`, `pages`,
 * `shared`, `modules`, `scripts` — and stays the permanent "it stays
 * deleted" pin: a reintroduced import, a re-added export, or a stray
 * comment mentioning the name anywhere in production code fails this test.
 *
 * Carve-out: `scripts/check-reviewer-engagement-boundary.js` and its
 * self-test deliberately keep `bulkUpdateByRequest` in the Stage 7 gate's
 * GENERIC_WRITERS list, and `scripts/check-script-suggestion-writers.js`
 * (owner decision D5, 2026-09-06) keeps the same list for `scripts/` (docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md,
 * "Remove the generic name from the gate's GENERIC WRITERS list only if
 * nothing else needs it — keep it listed... a deleted symbol can still be
 * re-added; listing it costs nothing"). Those three files are the detection
 * MECHANISM that would catch a reintroduction, not a caller of the removed
 * function, so they are excluded from this scan by name — not by directory
 * or pattern — so a NEW file elsewhere naming the identifier still fails.
 *
 * Unlike the import-specifier census (reviewer-engagement-census.test.js),
 * this scans for a bare IDENTIFIER reference by name, not a module import —
 * the deleted function lived inside the same adapter module as its caller
 * (setRequestMetadata — itself removed 2026-09-06 under owner decision D4),
 * so no import-path census would ever have seen it.
 */

const path = require('path');
const { readSourceFiles } = require('../helpers/import-census');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'pages', 'shared', 'modules', 'scripts'];
const NAME_PATTERN = /\bbulkUpdateByRequest\b/;

// The Stage 7 gate script and its self-test are the detection mechanism for
// a reintroduction of this identifier, not a caller of it — see the module
// docblock above.
const CARVE_OUT_FILES = new Set([
  'scripts/check-reviewer-engagement-boundary.js',
  'scripts/check-reviewer-engagement-boundary-self-test.js',
  'scripts/check-script-suggestion-writers.js',
]);

const PRODUCTION_FILES = readSourceFiles(
  SCAN_DIRS.map((dir) => path.join(ROOT, dir)),
  { relativeTo: ROOT },
).filter(({ file }) => !CARVE_OUT_FILES.has(file));

describe('bulkUpdateByRequest removal census (permanent pin)', () => {
  it('read at least one production file (scan roots resolved)', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0);
  });

  it('the carve-out files exist, are excluded, and genuinely contain the name (non-vacuous exclusion)', () => {
    const unfiltered = readSourceFiles(
      SCAN_DIRS.map((dir) => path.join(ROOT, dir)),
      { relativeTo: ROOT },
    );
    const byFile = new Map(unfiltered.map(({ file, content }) => [file, content]));
    for (const carveOut of CARVE_OUT_FILES) {
      expect(byFile.has(carveOut)).toBe(true);
      // If this ever stops matching, the carve-out is dead weight (or the
      // gate script no longer names the writer) and should be removed.
      expect(NAME_PATTERN.test(byFile.get(carveOut))).toBe(true);
    }
    // And the filtered set actually dropped them.
    const filteredFiles = new Set(PRODUCTION_FILES.map(({ file }) => file));
    for (const carveOut of CARVE_OUT_FILES) {
      expect(filteredFiles.has(carveOut)).toBe(false);
    }
  });

  it('no production file (outside the Stage 7 gate carve-out) references bulkUpdateByRequest', () => {
    const matched = PRODUCTION_FILES
      .filter(({ content }) => NAME_PATTERN.test(content))
      .map(({ file }) => file)
      .sort();

    expect(matched).toEqual([]);
  });
});

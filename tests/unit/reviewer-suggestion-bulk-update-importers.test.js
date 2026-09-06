/**
 * @jest-environment node
 *
 * Stage 7 removal census for `bulkUpdateByRequest` (Reviewer Lifecycle
 * Stage 3K, docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md census row 14).
 *
 * `bulkUpdateByRequest` is now a compatibility export: 3K moved its one
 * production caller (my-candidates-service.js) onto the whitelisted
 * `setRequestMetadata`, which itself delegates to `bulkUpdateByRequest`
 * internally. This test scans `lib/`, `pages/`, `scripts/` for any literal
 * TEXT reference to the call form `bulkUpdateByRequest(` and asserts the
 * matching file set is EXACTLY the adapter itself — the internal
 * definition plus its own internal delegation call. When Stage 7 confirms
 * this census is still exactly one file, `bulkUpdateByRequest` can be
 * deleted; a new caller appearing anywhere else must fail this test first.
 *
 * Unlike the import-specifier census (reviewer-engagement-census.test.js),
 * this scans for a CALL reference by function name, not a module import —
 * `bulkUpdateByRequest` lives inside the same adapter module as its caller
 * (setRequestMetadata), so no import-path census would see that call at
 * all.
 */

const path = require('path');
const { readSourceFiles } = require('../helpers/import-census');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'pages', 'scripts'];
const CALL_PATTERN = /\bbulkUpdateByRequest\(/;

const PRODUCTION_FILES = readSourceFiles(
  SCAN_DIRS.map((dir) => path.join(ROOT, dir)),
  { relativeTo: ROOT },
);

describe('bulkUpdateByRequest removal census', () => {
  it('read at least one production file (scan roots resolved)', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0);
  });

  it('the only file referencing bulkUpdateByRequest( is the adapter itself', () => {
    const matched = PRODUCTION_FILES
      .filter(({ content }) => CALL_PATTERN.test(content))
      .map(({ file }) => file)
      .sort();

    // Non-vacuity: if the pattern stops matching anything (e.g. the
    // function is renamed without updating this test), fail loudly rather
    // than silently passing an empty comparison.
    expect(matched.length).toBeGreaterThan(0);
    expect(matched).toEqual(['lib/dataverse/adapters/reviewer-suggestion.js']);
  });
});

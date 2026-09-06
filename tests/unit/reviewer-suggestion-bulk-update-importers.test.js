/**
 * @jest-environment node
 *
 * Interim TEXTUAL removal census for `bulkUpdateByRequest` (Reviewer
 * Lifecycle Stage 3K, docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md census
 * row 14). This is a coarse, regex-based scan meant to catch a stray
 * reintroduction early, not a semantic guarantee — the AST binding-resolved
 * census that actually gates deletion is Stage 7's
 * `check-reviewer-engagement-boundary.js` (see the Stage 7 section of the
 * build plan), which resolves imports/aliases properly.
 *
 * `bulkUpdateByRequest` is now a compatibility export: 3K moved its one
 * production caller (my-candidates-service.js) onto the whitelisted
 * `setRequestMetadata`, which itself delegates to `bulkUpdateByRequest`
 * internally. This test scans every production root —
 * `lib`, `pages`, `shared`, `modules`, `scripts` — for any word-bounded
 * TEXT reference to the identifier `bulkUpdateByRequest` (not only the call
 * form `bulkUpdateByRequest(`, so a spaced call, an aliased import, or a
 * bare reference is also caught) and asserts the matching file set is
 * EXACTLY the two recorded files below. When Stage 7 confirms this census
 * is still exactly those two files, `bulkUpdateByRequest` can be deleted
 * (and its sink-table entry removed); a new reference appearing anywhere
 * else must fail this test first.
 *
 * Recorded matches:
 *   - lib/dataverse/adapters/reviewer-suggestion.js — the function's own
 *     definition (`export async function bulkUpdateByRequest(...)`) plus
 *     `setRequestMetadata`'s internal delegation call to it.
 *   - lib/services/reviewer-finder/my-candidates-service.js — no longer
 *     calls the function (3K moved that call to `setRequestMetadata`); its
 *     two comments now name `bulkUpdateByRequest` only to explain what
 *     `setRequestMetadata` delegates to, for a reader who does not have the
 *     adapter open.
 *   - scripts/check-trust-boundary-guid.js — names `bulkUpdateByRequest` in
 *     its GUID-sink table (`SINKS` map entry `['bulkUpdateByRequest', 0]`)
 *     and in its docblock listing the adapter's id-sink methods; it does
 *     not call the function.
 *
 * Unlike the import-specifier census (reviewer-engagement-census.test.js),
 * this scans for an IDENTIFIER reference by name, not a module import —
 * `bulkUpdateByRequest` lives inside the same adapter module as its caller
 * (setRequestMetadata), so no import-path census would see that reference
 * at all, and the guard-script mention is a bare string/identifier, not an
 * import, either.
 */

const path = require('path');
const { readSourceFiles } = require('../helpers/import-census');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'pages', 'shared', 'modules', 'scripts'];
const NAME_PATTERN = /\bbulkUpdateByRequest\b/;

const PRODUCTION_FILES = readSourceFiles(
  SCAN_DIRS.map((dir) => path.join(ROOT, dir)),
  { relativeTo: ROOT },
);

describe('bulkUpdateByRequest removal census (interim textual scan)', () => {
  it('read at least one production file (scan roots resolved)', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0);
  });

  it('the only files referencing bulkUpdateByRequest are the adapter, its former caller\'s explanatory comments, and the trust-boundary-guid gate', () => {
    const matched = PRODUCTION_FILES
      .filter(({ content }) => NAME_PATTERN.test(content))
      .map(({ file }) => file)
      .sort();

    // Non-vacuity: if the pattern stops matching anything (e.g. the
    // function is renamed without updating this test), fail loudly rather
    // than silently passing an empty comparison.
    expect(matched.length).toBeGreaterThan(0);
    expect(matched).toEqual([
      'lib/dataverse/adapters/reviewer-suggestion.js',
      'lib/services/reviewer-finder/my-candidates-service.js',
      'scripts/check-trust-boundary-guid.js',
    ]);
  });
});

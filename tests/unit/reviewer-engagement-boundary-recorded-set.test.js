/**
 * @jest-environment node
 *
 * Reviewer Lifecycle Stage 7 correction round (Codex round 1, HIGH 2):
 * `check-reviewer-engagement-boundary.js`'s RECORDED_IMPORTERS map is NOT
 * self-limiting for growth. A stale entry (a recorded file that no longer
 * exists, or no longer binds the writer(s) it claims) fails the gate itself
 * -- but nothing in the gate script stops a PR from ADDING a brand-new
 * (file, writer) pair to the map and staying green, since a genuinely
 * matching new entry is, by definition, not stale.
 *
 * This test is the deliberate, separate guard against that: it pins
 * RECORDED_IMPORTERS to its EXACT tracked contents (the same mechanism
 * reviewer-engagement-census.test.js uses for import censuses, and
 * reviewer-suggestion-bulk-update-importers.test.js uses for the
 * bulkUpdateByRequest removal). Widening the exemption set requires editing
 * THIS test in the same reviewed commit as the map change -- a silent
 * addition fails here, not the gate.
 */

const { RECORDED_IMPORTERS } = require('../../scripts/check-reviewer-engagement-boundary.js');

describe('reviewer-engagement-boundary RECORDED_IMPORTERS (permanent pin)', () => {
  it('is exactly the two tracked Stage 5B receipt-sink entries', () => {
    expect(RECORDED_IMPORTERS).toEqual({
      'lib/services/review-manager/mark-received-no-file-service.js': ['patchReviewReceipt'],
      'lib/services/review-upload.js': ['patchReviewReceipt'],
    });
  });
});

/**
 * @jest-environment node
 *
 * Owner decision D5 (Reviewer Lifecycle Stage 7 plan, 2026-09-06):
 * `check-script-suggestion-writers.js`'s RECORDED_SCRIPT_WRITERS map is not
 * self-limiting for growth — a stale or drifted entry fails the gate, but a
 * brand-new (file, shapes) pair that genuinely matches is, by definition, not
 * stale. This pin (same mechanism as
 * reviewer-engagement-boundary-recorded-set.test.js) fixes the map to its
 * exact tracked contents, so widening the set of scripts allowed to write
 * `wmkf_appreviewersuggestions` outside the adapter's named ops requires
 * editing THIS test in the same reviewed commit.
 */

const { RECORDED_SCRIPT_WRITERS } = require('../../scripts/check-script-suggestion-writers.js');

describe('script-suggestion-writers RECORDED_SCRIPT_WRITERS (permanent pin)', () => {
  it('is exactly the thirteen writers recorded on 2026-09-06 (three raw-fetch one-offs archived the same day)', () => {
    expect(RECORDED_SCRIPT_WRITERS).toEqual({
      'scripts/backfill-postgres-to-dataverse.js': ['adapter-generic'],
      'scripts/backfill-summary-blob-url-to-dataverse.js': ['dynamics-service'],
      'scripts/find-stage2a-candidates.js': ['dynamics-service'],
      'scripts/pr4-e2e-cleanup.js': ['unresolved-target'],
      'scripts/pr4-e2e-setup.js': ['dynamics-service'],
      'scripts/pr4-e2e.js': ['dynamics-service', 'unresolved-target'],
      'scripts/probe-merge-altkey-ordering.mjs': ['dynamics-service'],
      'scripts/reset-request-reviewers.mjs': ['dynamics-service'],
      'scripts/reset-reviewer-for-testing.js': ['dynamics-service'],
      'scripts/reset-stage2a-state.js': ['dynamics-service'],
      'scripts/restore-request-reviewers-selected.mjs': ['dynamics-service'],
      'scripts/smoke-reviewer-binding.js': ['dynamics-service', 'unresolved-target'],
      'scripts/smoke-test-candidate.mjs': ['dynamics-service'],
    });
  });
});

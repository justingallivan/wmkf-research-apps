/**
 * @jest-environment node
 *
 * Meeting-date retirement step 6 (docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md;
 * owner, 2026-10-30: guard and ratchet now, convert readers in follow-up PRs).
 * check-request-meeting-date-reads.js fails on a new file or a higher count, and
 * on a lower count until the record is lowered. This pin fixes the recorded map
 * to its exact tracked contents, so widening it (a new reader, or a new
 * permanent kind) needs an edit here in the same reviewed commit. Lower a count,
 * or remove a converted reader, in both places.
 */

const { RECORDED } = require('../../scripts/check-request-meeting-date-reads.js');

describe('request-meeting-date-reads RECORDED (ratchet pin)', () => {
  it('is exactly the recorded set (2026-10-30 after batch 2: 19 files, no pending readers)', () => {
    expect(RECORDED).toEqual({
      'lib/bill/honorarium-onboard-orchestrator.js': [3, 'request-write'],
      'lib/dataverse/adapters/operations-grant-cycle.js': [2, 'grant-cycle-column'],
      'lib/services/dataverse-export/constants.js': [1, 'export-column'],
      'lib/services/meeting-tracker/program-briefing-service.js': [1, 'grant-cycle-column'],
      'lib/services/test-requests/admin-preview-service.js': [6, 'factory'],
      'lib/services/test-requests/admin-run-service.js': [1, 'factory'],
      'lib/services/test-requests/basic-clone-steps.js': [7, 'factory'],
      'lib/services/test-requests/policy.js': [3, 'factory'],
      'lib/services/test-requests/preview.js': [3, 'factory'],
      'lib/services/test-requests/production-write-fence.js': [1, 'factory'],
      'lib/services/test-requests/run-runner.js': [1, 'factory'],
      'lib/services/test-requests/sandbox-clone.js': [6, 'factory'],
      'lib/services/test-requests/source-bundle.js': [1, 'factory'],
      'lib/services/workbench/dashboard-service.js': [1, 'grant-cycle-column'],
      'lib/services/workbench/grantee-deliverables/awardees-service.js': [1, 'grant-cycle-column'],
      'lib/utils/cycle-code.js': [6, 'helper-definition'],
      'shared/components/workbench/OverviewTab.js': [1, 'grant-cycle-column'],
      'shared/config/cycleCalendar.js': [1, 'grant-cycle-column'],
      'shared/config/prompts/dynamics-explorer.js': [4, 'explorer-fallback'],
    });
  });

  it('records only known kinds', () => {
    const kinds = new Set(['grant-cycle-column', 'request-write', 'factory', 'helper-definition', 'explorer-fallback', 'export-column', 'pending-reader']);
    for (const [, kind] of Object.values(RECORDED)) expect(kinds.has(kind)).toBe(true);
  });
});

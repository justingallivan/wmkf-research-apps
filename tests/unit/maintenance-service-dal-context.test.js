/**
 * S333 bypass-strip characterization (BYPASS_STRIP_PLAN.md sites 34-35,
 * lib/services/maintenance-service.js). Both are sole-caller entry-seam
 * scopes reached from cron/maintenance.js.
 *
 * Stage 4b (2026-07-05): the local withDalContext wraps were pushed up to
 * cron/maintenance.js (same labels, relocated) and removed from
 * sweepBillOnboarding/cleanupBlobs themselves, matching Route→Service
 * Decision 3. These tests now wrap the calls exactly as the route does,
 * proving the pushed-up context still reaches the inner ops.
 *
 * Drives the real dynamics-context machinery (no dynamics-context mock) and
 * asserts hasTrustedDalContext() === true inside each wrapped op:
 *   34 bill-onboarding-resume (grantRequestAdapter.updateById)
 *   35 maintenance-blob-scan (grantCycleAdapter.queryAllCycles +
 *      reviewerSuggestionAdapter.queryAllSuggestions)
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('@vercel/blob', () => ({ list: jest.fn(), del: jest.fn() }));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {} }));
jest.mock('../../lib/services/settings-service', () => ({ listSettings: jest.fn() }));
jest.mock('../../lib/services/intake-draft-service', () => ({}));
jest.mock('../../lib/services/intake-audit-service', () => ({}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ updateById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-cycle', () => ({ queryAllCycles: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({ queryAllSuggestions: jest.fn() }));
jest.mock('../../lib/bill/onboarding-state', () => ({
  listStuck: jest.fn().mockResolvedValue([]),
  listPending: jest.fn(),
  clearDynamicsPending: jest.fn().mockResolvedValue(undefined),
  bumpAttempt: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../lib/bill/option-set-values', () => ({
  BILLCOM_ACCOUNT_YES: 100000000,
  BILLCOM_ACCOUNT_NO: 100000001,
  assertOptionSetValuesConfigured: jest.fn(),
}));

const MaintenanceService = require('../../lib/services/maintenance-service');
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request');
const grantCycleAdapter = require('../../lib/dataverse/adapters/grant-cycle');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const onboardingState = require('../../lib/bill/onboarding-state');
const { hasTrustedDalContext, withDalContext } = require('../../lib/dataverse/core/context');

describe('maintenance-service DAL context (S333 characterization, sites 34-35)', () => {
  test('negative control: no trusted context exists before either call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('site 34 — sweepBillOnboarding resume PATCH runs inside the CALLER-established context (route push-up)', async () => {
    const seen = { inside: null };
    onboardingState.listPending.mockResolvedValue([{ honorarium_request_id: 'h-1', pending_match: true, pending_pni: 'PNI1' }]);
    grantRequestAdapter.updateById.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
    });

    // Matches pages/api/cron/maintenance.js: withDalContext('bill-onboarding-resume', () => MaintenanceService.sweepBillOnboarding())
    const result = await withDalContext('bill-onboarding-resume', () =>
      MaintenanceService.sweepBillOnboarding({ limit: 10 }),
    );

    expect(seen.inside).toBe(true);
    expect(result.resumed).toBe(1);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('site 35 — cleanupBlobs scan runs inside the CALLER-established context (route push-up)', async () => {
    const seen = { cycles: null, suggestions: null };
    grantCycleAdapter.queryAllCycles.mockImplementation(async () => {
      seen.cycles = hasTrustedDalContext();
      return { records: [], capped: false };
    });
    reviewerSuggestionAdapter.queryAllSuggestions.mockImplementation(async () => {
      seen.suggestions = hasTrustedDalContext();
      return { records: [], capped: false };
    });
    require('@vercel/blob').list.mockResolvedValue({ blobs: [], cursor: null });

    // Matches pages/api/cron/maintenance.js: withDalContext('maintenance-blob-scan', () => MaintenanceService.cleanupBlobs(...))
    await withDalContext('maintenance-blob-scan', () => MaintenanceService.cleanupBlobs(90, true));

    expect(seen.cycles).toBe(true);
    expect(seen.suggestions).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });
});

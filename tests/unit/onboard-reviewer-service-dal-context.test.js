/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md sites 41-43,
 * lib/bill/onboard-reviewer-service.js). Drives onboardReviewer() with the real
 * dynamics-context machinery (no dynamics-context mock, matching
 * bill-onboard-reviewer.test.js's existing strategy) and asserts
 * hasTrustedDalContext() === true inside each of the three bypass scopes:
 *   41 bill-onboard-pre-read (contacts.getBillingFieldsById)
 *   42 bill-onboard-contact-patch (contacts.updateFields, new-vendor branch)
 *   43 the VARIABLE label bound to 'bill-onboard-request-patch-yes' /
 *      'bill-onboard-request-patch-no' (requests.updateById) — STOP-AND-ASK
 *      site; both literal bindings are re-confirmed live here.
 *
 * @jest-environment node
 */

process.env.BILLCOM_ACCOUNT_YES_VALUE = '100000000';
process.env.BILLCOM_ACCOUNT_NO_VALUE = '100000001';

const { onboardReviewer } = require('../../lib/bill/onboard-reviewer-service.js');
const { hasTrustedDalContext } = require('../../lib/dataverse/core/context');

const BASE_INPUT = {
  honorariumRequestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  reviewerContactId: '11111111-2222-3333-4444-555555555555',
  reviewerName: 'Test Reviewer',
  reviewerEmail: 'test@example.com',
  reviewerPhone: '555-555-5555',
  address: { line1: '1 Test St', city: 'Testville', zipOrPostalCode: '94000', country: 'US' },
};

function makeDeps({ exactMatchCount }) {
  const seen = { preRead: null, contactPatch: null, requestPatch: null };
  return {
    seen,
    notifications: { notify: jest.fn().mockResolvedValue({ id: 1 }) },
    contacts: {
      getBillingFieldsById: jest.fn(async () => {
        seen.preRead = hasTrustedDalContext();
        return { wmkf_billcomid: null, akoya_isvendor: null };
      }),
      updateFields: jest.fn(async () => {
        seen.contactPatch = hasTrustedDalContext();
      }),
    },
    requests: {
      updateById: jest.fn(async () => {
        seen.requestPatch = hasTrustedDalContext();
      }),
    },
    billClient: {
      createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
      searchBillNetwork: jest.fn().mockResolvedValue({
        exactMatchCount,
        pni: 'PNI1',
        networkId: 'PNI1',
        allResults: [{ id: 'PNI1' }],
      }),
      sendNetworkInvitation: jest.fn().mockResolvedValue(undefined),
    },
    onboardingState: {
      reserveOnboarding: jest.fn().mockResolvedValue({ reserved: true, row: { vendor_id: null } }),
      setVendorId: jest.fn().mockResolvedValue(undefined),
      markDynamicsPending: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
    },
    sleep: async () => {},
  };
}

describe('onboard-reviewer-service DAL context (S333 characterization, sites 41-43)', () => {
  beforeEach(() => { process.env.BILL_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILL_ENABLED; });

  test('negative control: no trusted context exists before the call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('exactMatchCount===1 (patch-yes) establishes trusted context at pre-read, contact patch, and request patch', async () => {
    const deps = makeDeps({ exactMatchCount: 1 });
    const result = await onboardReviewer(BASE_INPUT, deps);

    expect(result.status).toBe('onboarded');
    expect(deps.seen.preRead).toBe(true);
    expect(deps.seen.contactPatch).toBe(true);
    expect(deps.seen.requestPatch).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('exactMatchCount===0 (patch-no) establishes trusted context at the request patch', async () => {
    const deps = makeDeps({ exactMatchCount: 0 });
    const result = await onboardReviewer(BASE_INPUT, deps);

    expect(result.status).toBe('no_match');
    expect(deps.seen.requestPatch).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });
});

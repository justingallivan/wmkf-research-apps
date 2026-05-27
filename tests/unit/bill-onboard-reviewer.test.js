/**
 * Unit tests for lib/bill/onboard-reviewer-service.js + internal-call-auth.js.
 *
 * Strategy:
 *   - Inject fakes for billClient, dynamics (DynamicsService shape), and
 *     NotificationService into onboardReviewer().
 *   - For auth tests: drive verifyInternalCall directly with crafted headers
 *     against a known body + secret.
 *
 * @jest-environment node
 */

import crypto from 'crypto';
import { BillAuthError, BillRateLimitError, BillServerError, BillError } from '../../lib/bill/index.js';
import { signInternalCall, verifyInternalCall } from '../../lib/bill/internal-call-auth.js';

// Service module imports envs at module load; populate before requiring it.
process.env.BILLCOM_ACCOUNT_YES_VALUE = '100000000';
process.env.BILLCOM_ACCOUNT_NO_VALUE = '100000001';
process.env.BILLCOM_ACCOUNT_RECENTLY_CONFIRMED_VALUE = '100000002';

// eslint-disable-next-line import/first
const { onboardReviewer } = require('../../lib/bill/onboard-reviewer-service.js');

const BASE_INPUT = {
  honorariumRequestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  reviewerContactId: '11111111-2222-3333-4444-555555555555',
  reviewerName: 'Test Reviewer',
  reviewerEmail: 'test@example.com',
  reviewerPhone: '555-555-5555',
  address: { line1: '1 Test St', city: 'Testville', zipOrPostalCode: '94000', country: 'US' },
};

function makeDeps(overrides = {}) {
  const notifyCalls = [];
  return {
    notifyCalls,
    deps: {
      notifications: {
        notify: async (args) => { notifyCalls.push(args); return { id: 1 }; },
      },
      dynamics: overrides.dynamics || {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: null, akoya_isvendor: null }),
        updateRecord: jest.fn().mockResolvedValue(undefined),
      },
      billClient: overrides.billClient || {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
        searchBillNetwork: jest.fn().mockResolvedValue({ exactMatchCount: 1, pni: 'PNI1', networkId: 'PNI1', allResults: [{ id: 'PNI1' }] }),
        sendNetworkInvitation: jest.fn().mockResolvedValue(undefined),
      },
    },
  };
}

describe('onboardReviewer — happy paths', () => {
  beforeEach(() => { process.env.BILL_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILL_ENABLED; });

  test('net-new vendor + single match → status: onboarded', async () => {
    const { notifyCalls, deps } = makeDeps();
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('onboarded');
    expect(result.ok).toBe(true);
    expect(result.vendorId).toBe('009ABC');
    expect(result.pni).toBe('PNI1');
    expect(deps.billClient.createBillVendor).toHaveBeenCalled();
    expect(deps.billClient.sendNetworkInvitation).toHaveBeenCalled();
    expect(notifyCalls).toEqual([]);
  });

  test('returning reviewer (wmkf_billcomid populated) → reused_existing', async () => {
    const { notifyCalls, deps } = makeDeps({
      dynamics: {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: '009OLD', akoya_isvendor: true }),
        updateRecord: jest.fn().mockResolvedValue(undefined),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('reused_existing');
    expect(result.vendorId).toBe('009OLD');
    expect(deps.billClient.createBillVendor).not.toHaveBeenCalled();
    expect(notifyCalls).toEqual([]);
    // Post-impl P1 #1: pre-read uses { select } shape, not array.
    expect(deps.dynamics.getRecord).toHaveBeenCalledWith(
      'contacts', BASE_INPUT.reviewerContactId,
      { select: 'wmkf_billcomid,akoya_isvendor' },
    );
  });

  test('no network match → status: no_match (no alert)', async () => {
    const { notifyCalls, deps } = makeDeps({
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
        searchBillNetwork: jest.fn().mockResolvedValue({ exactMatchCount: 0, pni: null, networkId: null, allResults: [] }),
        sendNetworkInvitation: jest.fn(),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('no_match');
    expect(deps.billClient.sendNetworkInvitation).not.toHaveBeenCalled();
    expect(notifyCalls).toEqual([]);
  });

  test('ambiguous match (>=2) → status: ambiguous_match + warning alert', async () => {
    const { notifyCalls, deps } = makeDeps({
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
        searchBillNetwork: jest.fn().mockResolvedValue({
          exactMatchCount: 3, pni: null, networkId: null,
          allResults: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        }),
        sendNetworkInvitation: jest.fn(),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('ambiguous_match');
    expect(result.exactMatchCount).toBe(3);
    expect(deps.billClient.sendNetworkInvitation).not.toHaveBeenCalled();
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].type).toBe('bill_ambiguous_match');
    expect(notifyCalls[0].severity).toBe('warning');
  });
});

describe('onboardReviewer — BILL_ENABLED=false fallback', () => {
  beforeEach(() => { delete process.env.BILL_ENABLED; });

  test('returns alert_only without calling BILL', async () => {
    const { notifyCalls, deps } = makeDeps();
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('alert_only');
    expect(result.ok).toBe(true);
    expect(deps.billClient.createBillVendor).not.toHaveBeenCalled();
    expect(deps.dynamics.getRecord).not.toHaveBeenCalled();
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].type).toBe('bill_manual_onboarding');
    expect(notifyCalls[0].emailAdmins).toBe(true);
  });
});

describe('onboardReviewer — BILL failure phases', () => {
  beforeEach(() => { process.env.BILL_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILL_ENABLED; });

  test('BillAuthError in vendor_create → bill_unavailable + critical alert', async () => {
    const { notifyCalls, deps } = makeDeps({
      billClient: {
        createBillVendor: jest.fn().mockRejectedValue(new BillAuthError('auth broke')),
        searchBillNetwork: jest.fn(),
        sendNetworkInvitation: jest.fn(),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('bill_unavailable');
    expect(result.error.phase).toBe('vendor_create');
    expect(result.error.code).toBe('bill_auth');
    expect(result.error.vendorId).toBeUndefined();
    expect(notifyCalls[0].severity).toBe('critical');
  });

  test('BillRateLimitError in network_search → vendorId present in response (contact PATCH already happened)', async () => {
    const { notifyCalls, deps } = makeDeps({
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009XYZ' }),
        searchBillNetwork: jest.fn().mockRejectedValue(new BillRateLimitError('quota')),
        sendNetworkInvitation: jest.fn(),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('bill_unavailable');
    expect(result.error.phase).toBe('network_search');
    expect(result.error.vendorId).toBe('009XYZ');
    expect(notifyCalls[0].severity).toBe('error');
    expect(notifyCalls[0].metadata.vendorId).toBe('009XYZ');
  });

  test('BillServerError in network_invite → vendorId + pni in response', async () => {
    const { notifyCalls, deps } = makeDeps({
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009XYZ' }),
        searchBillNetwork: jest.fn().mockResolvedValue({ exactMatchCount: 1, pni: 'PNI', networkId: 'PNI', allResults: [{ id: 'PNI' }] }),
        sendNetworkInvitation: jest.fn().mockRejectedValue(new BillServerError('bill 503')),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('bill_unavailable');
    expect(result.error.phase).toBe('network_invite');
    expect(result.error.vendorId).toBe('009XYZ');
    expect(result.error.pni).toBe('PNI');
  });
});

describe('onboardReviewer — Dataverse PATCH failures', () => {
  beforeEach(() => { process.env.BILL_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILL_ENABLED; });

  test('contact PATCH retried once then alerts as error', async () => {
    const updateRecord = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('still failing'))
      .mockResolvedValue(undefined); // for the akoya_request PATCH if reached
    const { notifyCalls, deps } = makeDeps({
      dynamics: {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: null, akoya_isvendor: null }),
        updateRecord,
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    // The contact PATCH should have been called twice (1 retry).
    const contactCalls = updateRecord.mock.calls.filter(c => c[0] === 'contacts');
    expect(contactCalls).toHaveLength(2);
    // Error alert emitted for the contact PATCH failure.
    const contactAlert = notifyCalls.find(c => c.type === 'bill_contact_patch_failed');
    expect(contactAlert).toBeDefined();
    expect(contactAlert.severity).toBe('error');
    expect(contactAlert.metadata.vendorId).toBe('009ABC');
    // Flow continues; the final status should be 'partial' (warnings present).
    expect(result.status).toBe('partial');
    expect(result.warnings.some(w => w.startsWith('contact_patch_failed'))).toBe(true);
  });

  test('akoya_request PATCH failure → warning severity, no retry', async () => {
    const updateRecord = jest.fn().mockImplementation((entitySet) => {
      if (entitySet === 'akoya_requests') throw new Error('dataverse 500');
      return Promise.resolve();
    });
    const { notifyCalls, deps } = makeDeps({
      dynamics: {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: null, akoya_isvendor: null }),
        updateRecord,
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    const requestAlerts = notifyCalls.filter(c => c.type === 'bill_request_patch_failed');
    expect(requestAlerts).toHaveLength(1);
    expect(requestAlerts[0].severity).toBe('warning');
    // akoya_request PATCH should only have been called once (no retry).
    const reqCalls = updateRecord.mock.calls.filter(c => c[0] === 'akoya_requests');
    expect(reqCalls).toHaveLength(1);
    expect(result.status).toBe('partial');
    expect(result.intendedStatus).toBe('onboarded');
  });

  test('no_match path: request PATCH failure → status=partial, intendedStatus=no_match', async () => {
    const updateRecord = jest.fn().mockImplementation((entitySet) => {
      if (entitySet === 'akoya_requests') throw new Error('dv 500');
      return Promise.resolve();
    });
    const { notifyCalls, deps } = makeDeps({
      dynamics: {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: null, akoya_isvendor: null }),
        updateRecord,
      },
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
        searchBillNetwork: jest.fn().mockResolvedValue({ exactMatchCount: 0, pni: null, networkId: null, allResults: [] }),
        sendNetworkInvitation: jest.fn(),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('partial');
    expect(result.intendedStatus).toBe('no_match');
    expect(notifyCalls.filter(c => c.type === 'bill_request_patch_failed')).toHaveLength(1);
  });

  test('ambiguous_match + PATCH failure → status=partial, intendedStatus=ambiguous_match, ambiguous-alert still emits', async () => {
    const updateRecord = jest.fn().mockImplementation((entitySet) => {
      if (entitySet === 'akoya_requests') throw new Error('dv 500');
      return Promise.resolve();
    });
    const { notifyCalls, deps } = makeDeps({
      dynamics: {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: null, akoya_isvendor: null }),
        updateRecord,
      },
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
        searchBillNetwork: jest.fn().mockResolvedValue({
          exactMatchCount: 2, pni: null, networkId: null,
          allResults: [{ id: 'A' }, { id: 'B' }],
        }),
        sendNetworkInvitation: jest.fn(),
      },
    });
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.status).toBe('partial');
    expect(result.intendedStatus).toBe('ambiguous_match');
    expect(notifyCalls.some(c => c.type === 'bill_request_patch_failed')).toBe(true);
    expect(notifyCalls.some(c => c.type === 'bill_ambiguous_match')).toBe(true);
  });
});

describe('onboardReviewer — safeNotify (P1 #4)', () => {
  beforeEach(() => { process.env.BILL_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILL_ENABLED; });

  test('notification-system failure does not crash the orchestrator', async () => {
    const updateRecord = jest.fn().mockImplementation((entitySet) => {
      if (entitySet === 'akoya_requests') throw new Error('dv 500');
      return Promise.resolve();
    });
    const broken = {
      notify: jest.fn().mockRejectedValue(new Error('alert backend down')),
    };
    const deps = {
      notifications: broken,
      dynamics: {
        getRecord: jest.fn().mockResolvedValue({ wmkf_billcomid: null, akoya_isvendor: null }),
        updateRecord,
      },
      billClient: {
        createBillVendor: jest.fn().mockResolvedValue({ vendorId: '009ABC' }),
        searchBillNetwork: jest.fn().mockResolvedValue({ exactMatchCount: 1, pni: 'P', networkId: 'P', allResults: [{ id: 'P' }] }),
        sendNetworkInvitation: jest.fn().mockResolvedValue(undefined),
      },
    };
    // Should not throw, and the warnings array should record the alert failure.
    const result = await onboardReviewer(BASE_INPUT, deps);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.warnings.some(w => w.startsWith('alert_failed:'))).toBe(true);
  });
});

describe('verifyInternalCall (HMAC)', () => {
  const secret = 'a'.repeat(32);
  const body = '{"foo":"bar"}';
  const nowSec = 1_700_000_000;

  function makeHeaders({ skew = 0, nonce = 'n-1', useBody = body, useSecret = secret } = {}) {
    const ts = nowSec + skew;
    const sig = signInternalCall({ rawBody: useBody, timestamp: ts, nonce, secret: useSecret });
    return {
      'x-bill-timestamp': String(ts),
      'x-bill-nonce': nonce,
      'x-bill-internal-sig': sig,
    };
  }

  test('valid call passes', () => {
    const headers = makeHeaders();
    const r = verifyInternalCall({ rawBody: body, headers, secret, nowSeconds: nowSec });
    expect(r.ok).toBe(true);
  });

  test('mutated body fails', () => {
    const headers = makeHeaders();
    const r = verifyInternalCall({ rawBody: body + 'x', headers, secret, nowSeconds: nowSec });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  test('timestamp skew > 300s fails', () => {
    const headers = makeHeaders({ skew: 301 });
    const r = verifyInternalCall({ rawBody: body, headers, secret, nowSeconds: nowSec });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timestamp_skew');
  });

  test('missing headers fail', () => {
    const r = verifyInternalCall({ rawBody: body, headers: {}, secret, nowSeconds: nowSec });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('timestamp_header_missing');
  });

  test('wrong secret fails', () => {
    const headers = makeHeaders({ useSecret: 'b'.repeat(32) });
    const r = verifyInternalCall({ rawBody: body, headers, secret, nowSeconds: nowSec });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  test('missing secret fails', () => {
    const headers = makeHeaders();
    const r = verifyInternalCall({ rawBody: body, headers, secret: '', nowSeconds: nowSec });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('secret_missing');
  });

  test('short secret (<32 chars) fails closed', () => {
    const shortSecret = 'a'.repeat(31);
    const headers = makeHeaders({ useSecret: shortSecret });
    const r = verifyInternalCall({ rawBody: body, headers, secret: shortSecret, nowSeconds: nowSec });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('secret_too_short');
  });
});

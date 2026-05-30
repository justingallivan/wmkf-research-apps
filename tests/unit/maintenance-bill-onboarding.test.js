/**
 * Tests for MaintenanceService.sweepBillOnboarding + cleanupBillOnboardingState
 * + getRetentionConfig's bill_onboarding_state_days (chunk-4 hardening, Fix #3).
 *
 * The sweep resumes torn akoya_request writebacks left by a Dynamics blip after
 * the BILL side of onboarding succeeded. See docs/BILL_CHUNK_4_DESIGN.md Thread 3.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@vercel/blob', () => ({ list: jest.fn(), del: jest.fn() }));
jest.mock('../../lib/utils/intake-blob', () => ({ getIntakeBlobToken: jest.fn() }));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {} }));
jest.mock('../../lib/services/settings-service', () => ({ listSettings: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { updateRecord: jest.fn() } }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: jest.fn((ctx, fn) => fn()) }));
jest.mock('../../lib/services/intake-draft-service', () => ({}));
jest.mock('../../lib/services/intake-audit-service', () => ({ log: jest.fn() }));
jest.mock('../../lib/services/notification-service', () => ({ notify: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../../lib/bill/onboarding-state', () => ({
  listPending: jest.fn(),
  listStuck: jest.fn().mockResolvedValue([]),
  clearDynamicsPending: jest.fn().mockResolvedValue(undefined),
  bumpAttempt: jest.fn().mockResolvedValue(1),
  cleanupCompleted: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../lib/bill/option-set-values', () => ({
  BILLCOM_ACCOUNT_YES: 100000000,
  BILLCOM_ACCOUNT_NO: 100000001,
  assertOptionSetValuesConfigured: jest.fn(),
}));

const { DynamicsService } = require('../../lib/services/dynamics-service');
const onboardingState = require('../../lib/bill/onboarding-state');
const optionSet = require('../../lib/bill/option-set-values');
const NotificationService = require('../../lib/services/notification-service');
const { listSettings } = require('../../lib/services/settings-service');
const MaintenanceService = require('../../lib/services/maintenance-service');

beforeEach(() => {
  jest.clearAllMocks();
  optionSet.assertOptionSetValuesConfigured.mockImplementation(() => {});
  DynamicsService.updateRecord.mockResolvedValue(undefined);
  onboardingState.bumpAttempt.mockResolvedValue(1);
  onboardingState.listStuck.mockResolvedValue([]);
});

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('sweepBillOnboarding', () => {
  it('no pending rows → resumed 0, scanned 0, no Dynamics writes', async () => {
    onboardingState.listPending.mockResolvedValueOnce([]);
    const r = await MaintenanceService.sweepBillOnboarding();
    expect(r).toEqual({ resumed: 0, scanned: 0, errors: 0, failedClosed: 0, stuck: 0 });
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  it('stuck reconcile: stranded pending/partial rows past the threshold fire a manual-reconcile alert', async () => {
    onboardingState.listPending.mockResolvedValueOnce([]);
    onboardingState.listStuck.mockResolvedValueOnce([
      { honorarium_request_id: ID, bill_status: 'partial', vendor_id: '009ORPHAN' },
    ]);
    const r = await MaintenanceService.sweepBillOnboarding();
    expect(r.stuck).toBe(1);
    expect(NotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bill_onboarding_stuck' }),
    );
  });

  it('matched torn row (pending_match=true) → writes PNI + "Yes", clears marker', async () => {
    onboardingState.listPending.mockResolvedValueOnce([
      { honorarium_request_id: ID, pending_match: true, pending_pni: 'PNI9' },
    ]);
    const r = await MaintenanceService.sweepBillOnboarding();
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith('akoya_requests', ID, {
      wmkf_paymentnetworkidpni: 'PNI9',
      wmkf_exisitngbillcomaccount: 100000000,
    });
    expect(onboardingState.clearDynamicsPending).toHaveBeenCalledWith(ID, 'onboarded');
    expect(r.resumed).toBe(1);
  });

  it('no-match torn row (pending_match=false) → writes "No"', async () => {
    onboardingState.listPending.mockResolvedValueOnce([
      { honorarium_request_id: ID, pending_match: false, pending_pni: null },
    ]);
    const r = await MaintenanceService.sweepBillOnboarding();
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith('akoya_requests', ID, {
      wmkf_exisitngbillcomaccount: 100000001,
    });
    expect(onboardingState.clearDynamicsPending).toHaveBeenCalledWith(ID, 'no_match');
    expect(r.resumed).toBe(1);
  });

  it('malformed marker (pending_match NULL) → FAILS CLOSED: no PATCH, bump + alert', async () => {
    onboardingState.listPending.mockResolvedValueOnce([
      { honorarium_request_id: ID, pending_match: null, pending_pni: null },
    ]);
    const r = await MaintenanceService.sweepBillOnboarding();
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    expect(onboardingState.bumpAttempt).toHaveBeenCalledWith(ID, expect.stringMatching(/NULL/i));
    expect(NotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bill_resume_unresolvable' }),
    );
    expect(r.failedClosed).toBe(1);
    expect(r.resumed).toBe(0);
  });

  it('PATCH failure → bumps attempt, no clear; escalates after N attempts', async () => {
    onboardingState.listPending.mockResolvedValueOnce([
      { honorarium_request_id: ID, pending_match: true, pending_pni: 'P' },
    ]);
    DynamicsService.updateRecord.mockRejectedValueOnce(new Error('dv 503'));
    onboardingState.bumpAttempt.mockResolvedValueOnce(5); // at the escalation threshold
    const r = await MaintenanceService.sweepBillOnboarding({ alertAfterAttempts: 5 });
    expect(onboardingState.clearDynamicsPending).not.toHaveBeenCalled();
    expect(onboardingState.bumpAttempt).toHaveBeenCalledWith(ID, 'dv 503');
    expect(NotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bill_resume_stuck' }),
    );
    expect(r.errors).toBe(1);
  });

  it('option-set values unset → skips sweep, alerts misconfigured', async () => {
    onboardingState.listPending.mockResolvedValueOnce([
      { honorarium_request_id: ID, pending_match: true, pending_pni: 'P' },
    ]);
    optionSet.assertOptionSetValuesConfigured.mockImplementationOnce(() => { throw new Error('not configured'); });
    const r = await MaintenanceService.sweepBillOnboarding();
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    expect(NotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bill_resume_misconfigured' }),
    );
    expect(r.resumed).toBe(0);
  });
});

describe('cleanupBillOnboardingState', () => {
  it('delegates to onboarding-state.cleanupCompleted with retentionDays', async () => {
    onboardingState.cleanupCompleted.mockResolvedValueOnce(7);
    const n = await MaintenanceService.cleanupBillOnboardingState(30);
    expect(onboardingState.cleanupCompleted).toHaveBeenCalledWith(30);
    expect(n).toBe(7);
  });
});

describe('getRetentionConfig — bill_onboarding_state_days', () => {
  it('default is 30 with no override', async () => {
    listSettings.mockResolvedValueOnce({});
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.bill_onboarding_state_days).toBe(30);
  });

  it('Dataverse override replaces the default', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:bill_onboarding_state_days': '14' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.bill_onboarding_state_days).toBe(14);
  });
});

/**
 * Tests for lib/bill/onboarding-state.js — the bill_onboarding_state data layer
 * (chunk-4 hardening). Validates the reserve-before-create atomic insert, the
 * vendorId persistence, the torn-state markers, and the SQL shapes.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const store = require('../../lib/bill/onboarding-state');

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONTACT = '11111111-2222-3333-4444-555555555555';

beforeEach(() => { sql.mockReset(); });

function sqlText(callIndex = 0) {
  const [strings] = sql.mock.calls[callIndex];
  return Array.isArray(strings) ? strings.join('?') : '';
}

describe('reserveOnboarding', () => {
  it('winner: INSERT ... ON CONFLICT DO NOTHING returns the row → reserved:true', async () => {
    sql.mockResolvedValueOnce({ rows: [{ honorarium_request_id: ID, vendor_id: null }] });
    const r = await store.reserveOnboarding(ID, CONTACT);
    expect(r.reserved).toBe(true);
    expect(r.row.honorarium_request_id).toBe(ID);
    expect(sqlText(0)).toMatch(/INSERT INTO bill_onboarding_state/i);
    expect(sqlText(0)).toMatch(/ON CONFLICT \(honorarium_request_id\) DO NOTHING/i);
    expect(sql).toHaveBeenCalledTimes(1); // no follow-up SELECT when we won
  });

  it('loser: empty insert → re-reads existing row, reserved:false', async () => {
    sql
      .mockResolvedValueOnce({ rows: [] })                                   // INSERT (conflict)
      .mockResolvedValueOnce({ rows: [{ honorarium_request_id: ID, vendor_id: '009OWNED' }] }); // SELECT
    const r = await store.reserveOnboarding(ID, CONTACT);
    expect(r.reserved).toBe(false);
    expect(r.row.vendor_id).toBe('009OWNED');
    expect(sql).toHaveBeenCalledTimes(2);
  });
});

describe('setVendorId', () => {
  it('UPDATEs vendor_id', async () => {
    sql.mockResolvedValueOnce({ rowCount: 1 });
    await store.setVendorId(ID, '009ABC');
    expect(sqlText(0)).toMatch(/UPDATE bill_onboarding_state/i);
    expect(sqlText(0)).toMatch(/SET vendor_id =/i);
  });
});

describe('markDynamicsPending', () => {
  it('sets dynamics_pending true with pending_match + pni', async () => {
    sql.mockResolvedValueOnce({ rowCount: 1 });
    await store.markDynamicsPending(ID, { pendingMatch: true, pendingPni: 'PNI1' });
    const [strings, ...vals] = sql.mock.calls[0];
    const text = strings.join('?');
    expect(text).toMatch(/dynamics_pending = TRUE/i);
    expect(vals).toContain(true);
    expect(vals).toContain('PNI1');
  });

  it('no-match marker: pending_match false, null pni', async () => {
    sql.mockResolvedValueOnce({ rowCount: 1 });
    await store.markDynamicsPending(ID, { pendingMatch: false });
    const [strings, ...vals] = sql.mock.calls[0];
    expect(vals).toContain(false);
  });
});

describe('clearDynamicsPending', () => {
  it('sets dynamics_pending FALSE + clears last_error', async () => {
    sql.mockResolvedValueOnce({ rowCount: 1 });
    await store.clearDynamicsPending(ID, 'onboarded');
    expect(sqlText(0)).toMatch(/dynamics_pending = FALSE/i);
    expect(sqlText(0)).toMatch(/last_error = NULL/i);
  });
});

describe('bumpAttempt', () => {
  it('increments attempts and returns the new count', async () => {
    sql.mockResolvedValueOnce({ rows: [{ attempts: 3 }] });
    const n = await store.bumpAttempt(ID, 'boom');
    expect(n).toBe(3);
    expect(sqlText(0)).toMatch(/attempts = attempts \+ 1/i);
  });

  it('truncates long error messages', async () => {
    sql.mockResolvedValueOnce({ rows: [{ attempts: 1 }] });
    await store.bumpAttempt(ID, 'x'.repeat(900));
    const [, ...vals] = sql.mock.calls[0];
    const errArg = vals.find(v => typeof v === 'string' && v.startsWith('x'));
    expect(errArg.length).toBe(500);
  });
});

describe('listPending', () => {
  it('selects dynamics_pending rows', async () => {
    sql.mockResolvedValueOnce({ rows: [{ honorarium_request_id: ID }] });
    const rows = await store.listPending(50);
    expect(rows).toHaveLength(1);
    expect(sqlText(0)).toMatch(/WHERE dynamics_pending = TRUE/i);
  });
});

describe('cleanupCompleted', () => {
  it('DELETEs only non-pending rows older than retention; returns count', async () => {
    sql.mockResolvedValueOnce({ rowCount: 4 });
    const n = await store.cleanupCompleted(30);
    expect(n).toBe(4);
    expect(sqlText(0)).toMatch(/DELETE FROM bill_onboarding_state/i);
    expect(sqlText(0)).toMatch(/dynamics_pending = FALSE/i);
  });
});

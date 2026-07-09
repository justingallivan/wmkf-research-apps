/**
 * @jest-environment node
 *
 * /api/admin/policies — the superuser policy-version publish route. Contract
 * test written BEFORE converting the route onto lib/dataverse/adapters/policy.js
 * (Wave-3 caller conversion). Locks the current behavior: the GET slot-state
 * DTO shape, and the POST publish protocol's golden path (Branch A: create +
 * flip + retire) plus its failure paths (invalid slot code, label conflict,
 * concurrency conflict, and the audit hard-abort).
 */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 7 })) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => (typeof labelOrFn === 'function' ? labelOrFn() : maybeFn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: jest.fn(),
    getRecord: jest.fn(),
    createRecord: jest.fn(),
    updateRecord: jest.fn(),
  },
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [{ id: 1 }] })) }));

import handler from '../../pages/api/admin/policies';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { sql } from '@vercel/postgres';

const PARENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OLD_VERSION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NEW_VERSION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const VALID_BODY = 'A'.repeat(60); // clears MIN_BODY_LEN, plain text clears markdown validation

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function parentRecord(code, overrides = {}) {
  return {
    wmkf_policyid: PARENT_ID,
    wmkf_code: code,
    wmkf_displayname: `${code} display`,
    _wmkf_activeversion_value: OLD_VERSION_ID,
    ...overrides,
  };
}

function versionRecord(overrides = {}) {
  return {
    wmkf_policyversionid: OLD_VERSION_ID,
    wmkf_versionlabel: 'v1',
    wmkf_policytitle: 'Old title',
    wmkf_policybody: 'Old body',
    wmkf_effectivedate: '2026-01-01T00:00:00Z',
    statecode: 0,
    statuscode: 1,
    ...overrides,
  };
}

beforeEach(() => {
  DynamicsService.queryRecords.mockReset();
  DynamicsService.getRecord.mockReset();
  DynamicsService.createRecord.mockReset();
  DynamicsService.updateRecord.mockReset();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [{ id: 1 }] });
});

describe('envelope inventory gap fill (Stage 5 Phase A)', () => {
  it('405 on unsupported method, no auth check performed', async () => {
    const { requireSuperuser } = require('../../lib/utils/auth');
    requireSuperuser.mockClear();
    const res = mockRes();
    await handler({ method: 'DELETE', body: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(requireSuperuser).not.toHaveBeenCalled();
  });

  it('unauth: requireSuperuser short-circuits (GET), no Dataverse call', async () => {
    const { requireSuperuser } = require('../../lib/utils/auth');
    requireSuperuser.mockResolvedValueOnce(null);
    DynamicsService.queryRecords.mockClear();
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns all visible slots with active version, history, and a parentEtag', async () => {
    DynamicsService.queryRecords.mockImplementation((entity, opts) => {
      if (entity === 'wmkf_policies') {
        return Promise.resolve({ records: [parentRecord(opts.filter.includes('reviewer-coi') ? 'reviewer-coi' : 'reviewer-ai-use')] });
      }
      return Promise.resolve({ records: [versionRecord()] });
    });
    DynamicsService.getRecord.mockResolvedValue({ ...parentRecord('reviewer-coi'), _etag: 'W/"1"' });

    const res = mockRes();
    await handler({ method: 'GET' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.slots).toHaveLength(3); // reviewer-coi, reviewer-ai-use, grantee-waiver
    expect(res.body.slots.map((s) => s.code)).toContain('grantee-waiver');
    const coi = res.body.slots.find((s) => s.code === 'reviewer-coi');
    expect(coi.parentId).toBe(PARENT_ID);
    expect(coi.parentEtag).toBe('W/"1"');
    expect(coi.activeVersion).toMatchObject({ id: OLD_VERSION_ID, versionLabel: 'v1' });
    expect(coi.versions).toHaveLength(1);
    expect(coi.versions[0].isActive).toBe(true);
  });

  it('flags a slot as slot_not_provisioned when no parent row exists', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.slots.every((s) => s.invariantError === 'slot_not_provisioned')).toBe(true);
  });
});

describe('POST publish', () => {
  const post = (body) => ({ method: 'POST', body });
  const validBody = (overrides = {}) => ({
    slotCode: 'reviewer-coi',
    versionLabel: 'v2',
    title: 'New title',
    body: VALID_BODY,
    effectiveDate: '2026-07-04',
    parentEtag: 'W/"1"',
    ...overrides,
  });

  it('Branch A: creates a version, flips the parent, retires the prior version — 200 completed', async () => {
    // loadSlotState: parents lookup, then getRecord for etag
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [parentRecord('reviewer-coi')] }) // slot lookup
      .mockResolvedValueOnce({ records: [versionRecord()] })             // versions history (loadSlotState)
      .mockResolvedValueOnce({ records: [] });                            // idempotency lookup: no existing label
    DynamicsService.getRecord.mockResolvedValue({ ...parentRecord('reviewer-coi'), _etag: 'W/"1"' });
    DynamicsService.createRecord.mockResolvedValue({ wmkf_policyversionid: NEW_VERSION_ID });
    DynamicsService.updateRecord.mockResolvedValue(undefined);

    const res = mockRes();
    await handler(post(validBody()), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.child).toMatchObject({ id: NEW_VERSION_ID, created: true });
    expect(res.body.parent.flipped).toBe(true);
    expect(res.body.priorRetired).toBe(true);
    expect(res.body.auditWritten).toBe(true);

    expect(DynamicsService.createRecord).toHaveBeenCalledWith('wmkf_policyversions', expect.objectContaining({
      wmkf_versionlabel: 'v2',
      wmkf_policytitle: 'New title',
      'wmkf_Policy@odata.bind': `/wmkf_policies(${PARENT_ID})`,
    }));
    // Parent flip PATCH uses the client-supplied ifMatch on a fresh publish.
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_policies', PARENT_ID,
      { 'wmkf_ActiveVersion@odata.bind': `/wmkf_policyversions(${NEW_VERSION_ID})` },
      { ifMatch: 'W/"1"' },
    );
    // Prior version retire.
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith('wmkf_policyversions', OLD_VERSION_ID, {
      statecode: 1, statuscode: 2,
    });
    expect(sql.mock.calls.length).toBeGreaterThanOrEqual(2); // pending + final audit
    // Full response envelope pinned byte-exact (optimistic-locking publish result).
    expect(res.body).toEqual({
      status: 'completed',
      child: { id: NEW_VERSION_ID, created: true, reused: false },
      parent: { flipped: true },
      priorRetired: true,
      auditWritten: true,
      warnings: [],
      orphan: null,
      freshState: null,
    });
  });

  it('400 invalid_input on an unknown slot code (allowlist gate, no Dataverse call)', async () => {
    const res = mockRes();
    await handler(post(validBody({ slotCode: 'not-a-real-slot' })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('invalid_input');
    expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
  });

  it('500 slot_not_provisioned when the slot has no parent row in Dataverse', async () => {
    DynamicsService.queryRecords.mockResolvedValue({ records: [] });
    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('slot_not_provisioned');
  });

  it('409 label_conflict when the label exists with different fields', async () => {
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [parentRecord('reviewer-coi')] })
      .mockResolvedValueOnce({ records: [versionRecord()] })
      .mockResolvedValueOnce({ records: [versionRecord({ wmkf_versionlabel: 'v2', wmkf_policytitle: 'Different title' })] });
    DynamicsService.getRecord.mockResolvedValue({ ...parentRecord('reviewer-coi'), _etag: 'W/"1"' });

    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.status).toBe('label_conflict');
    expect(DynamicsService.createRecord).not.toHaveBeenCalled();
  });

  it('409 concurrency_conflict when the parent flip PATCH 412s (orphaned child)', async () => {
    DynamicsService.queryRecords
      .mockResolvedValueOnce({ records: [parentRecord('reviewer-coi')] })
      .mockResolvedValueOnce({ records: [versionRecord()] })
      .mockResolvedValueOnce({ records: [] })
      // reverseLookupSlotCode + freshState reload inside the 412 handler:
      .mockResolvedValueOnce({ records: [parentRecord('reviewer-coi')] })
      .mockResolvedValueOnce({ records: [versionRecord()] });
    DynamicsService.getRecord
      .mockResolvedValueOnce({ ...parentRecord('reviewer-coi'), _etag: 'W/"1"' }) // loadSlotState etag read
      .mockResolvedValueOnce({ wmkf_code: 'reviewer-coi' })                       // reverseLookupSlotCode
      .mockResolvedValue({ ...parentRecord('reviewer-coi'), _etag: 'W/"2"' });
    DynamicsService.createRecord.mockResolvedValue({ wmkf_policyversionid: NEW_VERSION_ID });
    DynamicsService.updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));

    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.status).toBe('concurrency_conflict');
    expect(res.body.orphan).toMatchObject({ id: NEW_VERSION_ID, reason: 'parent_etag_mismatch' });
  });

  it('HARD-ABORTS (500 audit_unavailable) if the pending audit write fails — no Dataverse mutation', async () => {
    sql.mockRejectedValueOnce(new Error('db down'));
    const res = mockRes();
    await handler(post(validBody()), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('audit_unavailable');
    expect(DynamicsService.queryRecords).not.toHaveBeenCalled();
  });

  it('400 invalid_body when policy markdown is disallowed', async () => {
    const res = mockRes();
    await handler(post(validBody({ body: `<script>alert(1)</script>` + 'A'.repeat(60) })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('invalid_body');
  });
});

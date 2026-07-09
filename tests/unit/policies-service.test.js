/**
 * Unit tests for lib/services/admin/policies-service.js (Stage 5 batch 1).
 * Logic-level, policy adapter + sql mocked. The route characterization suite
 * (admin-policies-route.test.js) pins the HTTP envelopes; this pins the
 * publish-protocol branches at service level.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/policy.js', () => ({
  querySlotByCode: jest.fn(),
  getSlotForAdmin: jest.fn(),
  getSlotEtagRow: jest.fn(),
  getSlotCodeRow: jest.fn(),
  queryVersionsByPolicy: jest.fn(),
  queryVersionByLabel: jest.fn(),
  createVersion: jest.fn(),
  setActiveVersion: jest.fn(),
  updateVersionState: jest.fn(),
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [{ id: 1 }] })) }));

import * as policy from '../../lib/dataverse/adapters/policy.js';
import { sql } from '@vercel/postgres';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { listSlots, publishPolicy } from '../../lib/services/admin/policies-service';

const PARENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OLD_VERSION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NEW_VERSION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const VALID_BODY = 'A'.repeat(60);

const parentRecord = (code) => ({
  wmkf_policyid: PARENT_ID, wmkf_code: code, wmkf_displayname: `${code} display`,
  _wmkf_activeversion_value: OLD_VERSION_ID,
});
const versionRecord = (over = {}) => ({
  wmkf_policyversionid: OLD_VERSION_ID, wmkf_versionlabel: 'v1',
  wmkf_policytitle: 'Old title', wmkf_policybody: 'Old body',
  wmkf_effectivedate: '2026-01-01T00:00:00Z', statecode: 0, statuscode: 1, ...over,
});
const validArgs = (over = {}) => ({
  slotCode: 'reviewer-coi', versionLabel: 'v2', title: 'New title', body: VALID_BODY,
  effectiveDate: '2026-07-04', parentEtag: 'W/"1"', profileId: 7, ...over,
});

function primeSlot() {
  policy.querySlotByCode.mockResolvedValue({ records: [parentRecord('reviewer-coi')] });
  policy.getSlotForAdmin.mockResolvedValue({ ...parentRecord('reviewer-coi'), _etag: 'W/"1"' });
  policy.queryVersionsByPolicy.mockResolvedValue({ records: [versionRecord()] });
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [{ id: 1 }] });
  policy.setActiveVersion.mockResolvedValue(undefined);
  policy.updateVersionState.mockResolvedValue(undefined);
});

describe('listSlots', () => {
  it('flags unprovisioned slots and returns all allowlisted codes', async () => {
    policy.querySlotByCode.mockResolvedValue({ records: [] });
    const { slots } = await listSlots();
    expect(slots.map((s) => s.code)).toEqual(['reviewer-coi', 'reviewer-ai-use', 'grantee-waiver']);
    expect(slots.every((s) => s.invariantError === 'slot_not_provisioned')).toBe(true);
  });

  it('derives isActive/isResidue and surfaces the parentEtag', async () => {
    primeSlot();
    const { slots } = await listSlots();
    const coi = slots[0];
    expect(coi.parentEtag).toBe('W/"1"');
    expect(coi.activeVersion.id).toBe(OLD_VERSION_ID);
    expect(coi.versions[0]).toMatchObject({ isActive: true, isResidue: false });
  });
});

describe('publishPolicy', () => {
  it('400 invalid_input on an unknown slot code, before any audit or Dataverse call', async () => {
    await expect(publishPolicy(validArgs({ slotCode: 'nope' }))).rejects.toMatchObject({
      httpStatus: 400, body: expect.objectContaining({ status: 'invalid_input' }),
    });
    expect(sql).not.toHaveBeenCalled();
    expect(policy.querySlotByCode).not.toHaveBeenCalled();
  });

  it('500 audit_unavailable hard-abort when the pending audit insert fails', async () => {
    sql.mockRejectedValueOnce(new Error('db down'));
    await expect(publishPolicy(validArgs())).rejects.toMatchObject({
      httpStatus: 500, body: expect.objectContaining({ status: 'audit_unavailable' }),
    });
    expect(policy.querySlotByCode).not.toHaveBeenCalled();
  });

  it('Branch A completed: create → flip with client ETag → retire prior (audit final written)', async () => {
    primeSlot();
    policy.queryVersionByLabel.mockResolvedValue({ records: [] });
    policy.createVersion.mockResolvedValue({ wmkf_policyversionid: NEW_VERSION_ID });
    const { outcome, auditWritten } = await publishPolicy(validArgs());
    expect(outcome).toMatchObject({
      status: 'completed',
      child: { id: NEW_VERSION_ID, created: true, reused: false },
      parent: { flipped: true },
      priorRetired: true,
      priorRetiredId: OLD_VERSION_ID,
    });
    expect(auditWritten).toBe(true);
    expect(policy.setActiveVersion).toHaveBeenCalledWith(PARENT_ID, NEW_VERSION_ID, { ifMatch: 'W/"1"' });
    expect(policy.updateVersionState).toHaveBeenCalledWith(OLD_VERSION_ID, { statecode: 1, statuscode: 2 });
  });

  it('Branch B already_published: same fields + already active → no writes', async () => {
    primeSlot();
    policy.queryVersionByLabel.mockResolvedValue({
      records: [versionRecord({ wmkf_versionlabel: 'v2', wmkf_policytitle: 'New title', wmkf_policybody: VALID_BODY, wmkf_effectivedate: '2026-07-04T00:00:00Z' })],
    });
    const { outcome } = await publishPolicy(validArgs());
    expect(outcome.status).toBe('already_published');
    expect(outcome.child).toEqual({ id: OLD_VERSION_ID, created: false, reused: true });
    expect(policy.createVersion).not.toHaveBeenCalled();
    expect(policy.setActiveVersion).not.toHaveBeenCalled();
  });

  it('Branch C resume: same fields, NOT active → flips with a FRESH etag (never the client one)', async () => {
    primeSlot();
    const otherId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    policy.queryVersionByLabel.mockResolvedValue({
      records: [versionRecord({ wmkf_policyversionid: otherId, wmkf_versionlabel: 'v2', wmkf_policytitle: 'New title', wmkf_policybody: VALID_BODY, wmkf_effectivedate: '2026-07-04T00:00:00Z' })],
    });
    policy.getSlotEtagRow.mockResolvedValue({ _etag: 'W/"fresh"' });
    const { outcome } = await publishPolicy(validArgs({ parentEtag: 'W/"stale-client"' }));
    expect(outcome).toMatchObject({ status: 'completed', child: { id: otherId, created: false, reused: true } });
    expect(policy.setActiveVersion).toHaveBeenCalledWith(PARENT_ID, otherId, { ifMatch: 'W/"fresh"' });
  });

  it('Branch D label_conflict carries per-field match flags', async () => {
    primeSlot();
    policy.queryVersionByLabel.mockResolvedValue({
      records: [versionRecord({ wmkf_versionlabel: 'v2', wmkf_policytitle: 'Different' })],
    });
    const { outcome } = await publishPolicy(validArgs());
    expect(outcome.status).toBe('label_conflict');
    expect(outcome.details.fieldsMatch).toEqual({ title: false, body: false, effectiveDate: false });
    expect(policy.createVersion).not.toHaveBeenCalled();
  });

  it('412 on the parent flip → concurrency_conflict outcome with orphaned child + freshState', async () => {
    primeSlot();
    policy.queryVersionByLabel.mockResolvedValue({ records: [] });
    policy.createVersion.mockResolvedValue({ wmkf_policyversionid: NEW_VERSION_ID });
    policy.setActiveVersion.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
    policy.getSlotCodeRow.mockResolvedValue({ wmkf_code: 'reviewer-coi' });
    const { outcome } = await publishPolicy(validArgs());
    expect(outcome).toMatchObject({
      status: 'concurrency_conflict',
      orphan: { id: NEW_VERSION_ID, reason: 'parent_etag_mismatch' },
    });
    expect(outcome.freshState).toBeTruthy();
  });

  it('duplicate-key race on create re-dispatches into the branch logic (tail-call)', async () => {
    primeSlot();
    policy.queryVersionByLabel
      .mockResolvedValueOnce({ records: [] }) // first pass: label free
      .mockResolvedValueOnce({
        records: [versionRecord({ wmkf_versionlabel: 'v2', wmkf_policytitle: 'Different' })],
      }); // re-dispatch: the racer's row exists → label_conflict
    policy.createVersion.mockRejectedValueOnce(new Error('A record with these values already exists (DuplicateKey)'));
    const { outcome } = await publishPolicy(validArgs());
    expect(outcome.status).toBe('label_conflict');
    expect(policy.createVersion).toHaveBeenCalledTimes(1);
  });

  it('unexpected publish errors become a failed outcome (500 mapping is the shell\'s)', async () => {
    primeSlot();
    policy.queryVersionByLabel.mockRejectedValue(new Error('dataverse down'));
    const { outcome, auditWritten } = await publishPolicy(validArgs());
    expect(outcome.status).toBe('failed');
    expect(outcome.warnings).toEqual(['internal_error:dataverse down']);
    expect(auditWritten).toBe(true);
  });

  it('reports auditWritten:false when the final audit write fails', async () => {
    primeSlot();
    policy.queryVersionByLabel.mockResolvedValue({ records: [] });
    policy.createVersion.mockResolvedValue({ wmkf_policyversionid: NEW_VERSION_ID });
    sql
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // pending audit
      .mockRejectedValueOnce(new Error('final write down')) // final audit
      .mockResolvedValueOnce({ rows: [] }); // system_alerts
    const { outcome, auditWritten } = await publishPolicy(validArgs());
    expect(outcome.status).toBe('completed');
    expect(auditWritten).toBe(false);
  });
});

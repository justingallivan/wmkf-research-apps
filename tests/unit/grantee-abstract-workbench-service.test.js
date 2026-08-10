/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/abstract-service — logic-level
 * tests (adapter mocked), Stage 4 series C extraction. The route suite pins
 * the full envelopes; this pins the service branches: target resolution,
 * provenance/stale/status typed 409 bodies, 412 translation, non-412 → 500,
 * and the non-fatal etag re-read.
 */

const getById = jest.fn();
const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
  updateById: (...a) => updateById(...a),
}));

const getDeliverableForRequest = jest.fn();
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: (...a) => getDeliverableForRequest(...a),
}));

import { loadGranteeAbstract, saveGranteeAbstract } from '../../lib/services/workbench/grantee-deliverables/abstract-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';

const GUID = '22222222-2222-2222-2222-222222222222';
const DRAFT = 'a plenty long draft abstract for the grantee package';
const APPROVED = 'the grantee approved this version';

const row = (over = {}) => ({
  akoya_requestid: GUID, wmkf_abstractformatted: DRAFT, wmkf_abstractapproved: null, _etag: 'W/"1"', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue(row());
  updateById.mockResolvedValue(undefined);
  getDeliverableForRequest.mockResolvedValue({ wmkf_granteedeliverableid: 'd1', wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED });
});

const saveArgs = (over = {}) => ({
  requestId: GUID, text: 'edited text long enough', clientEtag: 'W/"1"', baseField: 'formatted', actingUserSystemId: 'sys-1', ...over,
});

test('load: 404 typed error when the request is missing', async () => {
  getById.mockRejectedValue(new Error('gone'));
  const err = await loadGranteeAbstract({ requestId: GUID }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
});

test('load: effective flips to approved once present; editability follows the status allowlist', async () => {
  getById.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED });
  const body = await loadGranteeAbstract({ requestId: GUID });
  expect(body.effectiveField).toBe('approved');
  expect(body.editable).toBe(false);
});

describe('load: grantee submission fields (caption / image / waiver time)', () => {
  const SP_URL = 'https://wmkf.sharepoint.com/sites/grants/Shared%20Documents/1002794_ABC/Grantee_Uploads/fig.png';

  test('absolute SharePoint webUrl is linkable', async () => {
    getDeliverableForRequest.mockResolvedValue({
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
      wmkf_imagefileref: SP_URL,
      wmkf_imagecaption: 'Cryo-EM structure.',
      wmkf_waiverackedat: '2026-07-12T15:04:05Z',
    });
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.imageUrl).toBe(SP_URL);
    expect(body.imageRef).toBe(SP_URL);
    expect(body.hasImage).toBe(true);
    expect(body.caption).toBe('Cryo-EM structure.');
    expect(body.submittedAt).toBe('2026-07-12T15:04:05Z');
  });

  // THE TRAP: grantee-upload falls back to `${folder}/${filename}` when Graph
  // returns no webUrl. Linkifying that would render a broken same-origin link.
  test('relative library path → hasImage true but NOT linkable', async () => {
    getDeliverableForRequest.mockResolvedValue({
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
      wmkf_imagefileref: '1002794_ABCDEF/Grantee_Uploads/fig.png',
    });
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.hasImage).toBe(true);
    expect(body.imageRef).toBe('1002794_ABCDEF/Grantee_Uploads/fig.png');
    expect(body.imageUrl).toBeNull();
  });

  test.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
  ])('hostile scheme %s never becomes a link', async (ref) => {
    getDeliverableForRequest.mockResolvedValue({
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
      wmkf_imagefileref: ref,
    });
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.imageUrl).toBeNull();
  });

  test('no deliverable row → all submission fields null/false, no throw', async () => {
    getDeliverableForRequest.mockResolvedValue(null);
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body).toMatchObject({
      caption: null, imageRef: null, imageUrl: null, hasImage: false, submittedAt: null,
    });
  });

  test('pre-submit row → nothing to show', async () => {
    getDeliverableForRequest.mockResolvedValue({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED });
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.hasImage).toBe(false);
    expect(body.caption).toBeNull();
    expect(body.submittedAt).toBeNull();
  });
});

describe('load: outbound lifecycle timestamps', () => {
  test('invited row surfaces invitedAt with remindedAt still null', async () => {
    getDeliverableForRequest.mockResolvedValue({
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED,
      wmkf_inviteddate: '2026-07-12T15:04:05Z',
    });
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.invitedAt).toBe('2026-07-12T15:04:05Z');
    expect(body.remindedAt).toBeNull();
  });

  test('reminder-sent row surfaces both dates', async () => {
    getDeliverableForRequest.mockResolvedValue({
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
      wmkf_inviteddate: '2026-07-12T15:04:05Z',
      wmkf_remindeddate: '2026-07-24T09:00:00Z',
    });
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.invitedAt).toBe('2026-07-12T15:04:05Z');
    expect(body.remindedAt).toBe('2026-07-24T09:00:00Z');
  });

  test('no deliverable row → both null, no throw', async () => {
    getDeliverableForRequest.mockResolvedValue(null);
    const body = await loadGranteeAbstract({ requestId: GUID });
    expect(body.invitedAt).toBeNull();
    expect(body.remindedAt).toBeNull();
  });
});

test('save: baseField flip → 409 stale with currentField in the body, no write', async () => {
  getById.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED });
  const err = await saveGranteeAbstract(saveArgs({ baseField: 'formatted' })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toMatchObject({ code: 'stale', currentField: 'approved' });
  expect(updateById).not.toHaveBeenCalled();
});

test('save: status gate → 409 not_editable with status/statusLabel body', async () => {
  getById.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.COMPLETE });
  const err = await saveGranteeAbstract(saveArgs({ baseField: 'approved' })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body.code).toBe('not_editable');
  expect(err.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.COMPLETE);
});

test('save: 412 from the conditional write → 409 stale; non-412 → 500 sanitized', async () => {
  updateById.mockRejectedValueOnce(Object.assign(new Error('precondition'), { status: 412 }));
  let err = await saveGranteeAbstract(saveArgs()).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body.code).toBe('stale');

  updateById.mockRejectedValueOnce(new Error('server blew up'));
  err = await saveGranteeAbstract(saveArgs()).catch((e) => e);
  expect(err.httpStatus).toBe(500);
  expect(err.message).toBe('Failed to save the abstract.');
  expect(err.body).toBeUndefined();
});

test('save: happy path writes the effective field conditionally and re-reads the etag (re-read failure non-fatal)', async () => {
  getById
    .mockResolvedValueOnce(row())
    .mockRejectedValueOnce(new Error('re-read down')); // non-fatal
  const body = await saveGranteeAbstract(saveArgs());
  expect(updateById).toHaveBeenCalledWith(GUID, { wmkf_abstractformatted: 'edited text long enough' }, { ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' });
  expect(body).toEqual({ ok: true, field: 'formatted', etag: null, status: GRANTEE_DELIVERABLE_STATUS.DRAFTED, statusLabel: 'Drafted' });
});

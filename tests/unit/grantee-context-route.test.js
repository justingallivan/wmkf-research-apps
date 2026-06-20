/**
 * GET /api/external/grantee/[token]/context — method guard, rate-limit, ordering,
 * fail-closed editable-status allowlist, and view derivation.
 *
 * @jest-environment node
 */
jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ ok: true })),
  recordTokenOutcome: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/verify-grantee-token', () => ({
  verifyGranteeToken: jest.fn(),
}));
// Mock only the network-bound assembly (it reads Dataverse); let the real
// renderAwardBlock turn the model into HTML so the preview wiring is exercised
// end-to-end.
jest.mock('../../lib/services/grantee-document-assembly', () => ({
  assembleGranteeDocument: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { assembleGranteeDocument } from '../../lib/services/grantee-document-assembly';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/external/grantee/[token]/context';

// A benign assembled model: display-only header fields + a sanitized body. No
// imageFileRef (the external surface assembles with includeImageRef:false).
function previewModel() {
  return {
    requestId: 'req-1',
    institution: 'Oregon State University',
    location: 'Corvallis, OR',
    names: 'Kristen Buck and Mya Breitbart',
    amountFormatted: '$1,200,000',
    editedTitle: 'To determine whether deep-sea microbes fix nitrogen',
    bodyHtml: '<p>In nearly half of the global ocean…</p>',
    hasImage: false,
  };
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

function okVerify(status) {
  return {
    ok: true,
    requestId: 'req-1',
    request: {
      akoya_title: 'Test grant',
      akoya_requestnum: '1002794',
      wmkf_meetingdate: '2026-06-01',
      wmkf_abstractformatted: 'formatted',
      wmkf_abstractapproved: null,
    },
    deliverable: status === undefined ? null : {
      wmkf_granteedeliverableid: 'deliv-1',
      wmkf_imagecaption: null,
      wmkf_imagefileref: null,
      wmkf_deliverablestatus: status,
    },
  };
}

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue({ ok: true });
  recordTokenOutcome.mockReset().mockResolvedValue(undefined);
  verifyGranteeToken.mockReset();
  assembleGranteeDocument.mockReset().mockResolvedValue(previewModel());
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(verifyGranteeToken).not.toHaveBeenCalled();
});

test('rate-limited → 429 with Retry-After, before token verify', async () => {
  checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(429);
  expect(res.headers['Retry-After']).toBe('42');
  expect(verifyGranteeToken).not.toHaveBeenCalled();
});

test('invalid token → 401 + reason, outcome recorded', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'invalid_claim' });
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ ok: false, reason: 'invalid_claim' });
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 't', false);
});

test('not_found → 404', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'not_found' });
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(404);
});

test('editable status (Invited) → editable:true, view:edit', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.editable).toBe(true);
  expect(res.body.view).toBe('edit');
  expect(res.body.deliverable.hasImage).toBe(false);
  // raw SharePoint ref must NOT leak to the external client
  expect(res.body.deliverable.imageFileRef).toBeUndefined();
});

test('submitted status (Complete) → editable:false, view:submitted', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.COMPLETE));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('submitted');
});

test('FAIL-CLOSED: null status → not editable, view:closed', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(null));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('closed');
});

test('FAIL-CLOSED: missing deliverable row → not editable, view:closed', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(undefined));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('closed');
});

test('FAIL-CLOSED: unknown status value → not editable, view:closed', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(999999));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('closed');
});

test('SECURITY: a populated image ref never leaks to the client (only hasImage:true)', async () => {
  const SECRET_URL = 'https://wmkf.sharepoint.com/Grantee_Uploads/secret-folder/img.png';
  const v = okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED);
  v.deliverable.wmkf_imagefileref = SECRET_URL;
  verifyGranteeToken.mockResolvedValue(v);
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);

  expect(res.body.deliverable.hasImage).toBe(true);
  // The raw SharePoint URL must appear nowhere in the serialized response, and
  // no raw wmkf_* field name may leak through the deliverable shape.
  const serialized = JSON.stringify(res.body);
  expect(serialized).not.toContain(SECRET_URL);
  expect(serialized).not.toContain('wmkf_');
  expect(res.body.deliverable.imageFileRef).toBeUndefined();
  expect(res.body.deliverable.wmkf_granteeimagefileref).toBeUndefined();
});

test('numeric-string status from the API is coerced (Revision Requested → editable)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(String(GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED)));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(true);
  expect(res.body.view).toBe('edit');
});

// --- Output (a): the display-only assembled award preview ---

test('edit view → preview HTML assembled from the canonical model, header fields rendered', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.view).toBe('edit');
  expect(typeof res.body.preview).toBe('string');
  // structural rendering by field identity
  expect(res.body.preview).toContain('<strong>Oregon State University</strong>');
  expect(res.body.preview).toContain('<em>Kristen Buck and Mya Breitbart</em>');
  expect(res.body.preview).toContain('$1,200,000');
  expect(res.body.preview).toContain('To determine whether deep-sea microbes fix nitrogen');
  expect(res.body.preview).toContain('In nearly half of the global ocean');
  // external surface: assemble WITHOUT the private SharePoint ref
  expect(assembleGranteeDocument).toHaveBeenCalledWith('req-1', { includeImageRef: false });
});

test('submitted view → preview is still assembled (confirmation of the award)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.COMPLETE));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.view).toBe('submitted');
  expect(typeof res.body.preview).toBe('string');
  expect(res.body.preview).toContain('Oregon State University');
});

test('closed view → preview is null and assembly is NOT called (no wasted reads)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(null));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.view).toBe('closed');
  expect(res.body.preview).toBeNull();
  expect(assembleGranteeDocument).not.toHaveBeenCalled();
});

test('FAIL-SOFT: assembly returns null → preview null, core response intact', async () => {
  assembleGranteeDocument.mockResolvedValue(null);
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.preview).toBeNull();
  expect(res.body.view).toBe('edit'); // form still renders
});

test('FAIL-SOFT: assembly throws → preview null, response does not 500', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  assembleGranteeDocument.mockRejectedValue(new Error('Dataverse unreachable'));
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.preview).toBeNull();
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
});

test('SECURITY: the preview never emits the image figure or a raw field name', async () => {
  // Even if the model carried an image flag, the external surface renders with
  // includeImage:false → no <figure>, no SharePoint ref, no wmkf_ field names.
  assembleGranteeDocument.mockResolvedValue({ ...previewModel(), hasImage: true });
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.preview).not.toContain('<figure');
  expect(res.body.preview).not.toContain('wmkf_');
  expect(res.body.preview).not.toContain('sharepoint');
});

/**
 * GET /api/workbench/grantee-deliverables/website-html — chunk 8 output (b).
 * Staff-authed single-award HTML fragment. Covers method guard, auth gate,
 * GUID validation (trust boundary), 404 on missing, the includeImageRef staff
 * boundary, and the assembled fragment.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (l, fn) => Promise.resolve().then(() => (typeof l === 'function' ? l() : fn())),
}));
jest.mock('../../lib/services/grantee-document-assembly', () => ({ assembleGranteeDocument: jest.fn() }));

import { requireAppAccess } from '../../lib/utils/auth';
import { assembleGranteeDocument } from '../../lib/services/grantee-document-assembly';
import handler from '../../pages/api/workbench/grantee-deliverables/website-html';

const GUID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

const MODEL = {
  requestId: GUID, requestNumber: '1003100',
  institution: 'Oregon State University', location: 'Corvallis, OR',
  names: 'Kristen Buck and Mya Breitbart', amountFormatted: '$1,200,000',
  editedTitle: 'To determine whether marine viruses store iron',
  bodyHtml: '<p>In nearly half…</p>', hasImage: true, imageFileRef: 'sites/x/img.jpg', captionHtml: 'A virus',
};

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  assembleGranteeDocument.mockReset();
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('auth gate: requireAppAccess null → no assembly', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(assembleGranteeDocument).not.toHaveBeenCalled();
});

test('invalid requestId → 400 (no assembly)', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: 'nope' }, headers: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(assembleGranteeDocument).not.toHaveBeenCalled();
});

test('missing request → 404', async () => {
  assembleGranteeDocument.mockResolvedValue(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.statusCode).toBe(404);
});

test('happy path → 200 with assembled fragment; assembles WITH includeImageRef', async () => {
  assembleGranteeDocument.mockResolvedValue(MODEL);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(assembleGranteeDocument).toHaveBeenCalledWith(GUID, { includeImageRef: true });
  expect(res.body.requestId).toBe(GUID);
  expect(res.body.requestNumber).toBe('1003100');
  expect(res.body.html).toContain('<strong>Oregon State University</strong>');
  expect(res.body.html).toContain('<figure class="grantee-image">');
});

test('assembly throws → 500', async () => {
  assembleGranteeDocument.mockRejectedValue(new Error('boom'));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.statusCode).toBe(500);
});

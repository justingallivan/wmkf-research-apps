/**
 * GET /api/workbench/grantee-deliverables/image — S411 increment 2.
 *
 * Thin-shell coverage: method/auth/GUID guards, the binary response contract
 * (content type, length, nosniff, no-store, inline disposition), and typed error
 * mapping. Path/filename/content-type derivation is the service's job and is
 * pinned in tests/unit/grantee-image-service.test.js.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/services/workbench/grantee-deliverables/image-service', () => ({
  loadGranteeImage: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { loadGranteeImage } from '../../lib/services/workbench/grantee-deliverables/image-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/workbench/grantee-deliverables/image';

const GUID = '22222222-2222-2222-2222-222222222222';
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NAME = '1002365_grantee_image_a1b2c3d4.png';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, sends: 0 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.sends += 1; return res; };
  res.send = (b) => { res.body = b; res.sends += 1; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const getReq = (query) => ({ method: 'GET', query, headers: {} });

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: {} } });
  loadGranteeImage.mockResolvedValue({ buffer: BYTES, contentType: 'image/png', filename: NAME });
});

test('rejects non-GET with an Allow header', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET');
  expect(loadGranteeImage).not.toHaveBeenCalled();
});

test('auth gate short-circuits before any read', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(loadGranteeImage).not.toHaveBeenCalled();
  expect(res.sends).toBe(0);
});

test('a non-GUID requestId 400s before it can select a record', async () => {
  const res = mockRes();
  await handler(getReq({ requestId: 'nope' }), res);
  expect(res.statusCode).toBe(400);
  expect(loadGranteeImage).not.toHaveBeenCalled();
});

test('serves the bytes with the private-material response contract', async () => {
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe(BYTES);
  expect(res.headers['Content-Type']).toBe('image/png');
  expect(res.headers['Content-Length']).toBe(String(BYTES.length));
  // Never sniffed into another type, never held by a shared cache.
  expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.headers['Content-Disposition']).toBe(`inline; filename="${NAME}"`);
  expect(res.sends).toBe(1);
});

test('maps a typed service error to its status without leaking internals', async () => {
  loadGranteeImage.mockRejectedValue(
    new ServiceHttpError('Could not fetch the image from SharePoint.', { httpStatus: 502 }),
  );
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.statusCode).toBe(502);
  expect(res.body).toEqual({ error: 'Could not fetch the image from SharePoint.' });
});

test('a 404 from the service passes through as 404', async () => {
  loadGranteeImage.mockRejectedValue(new ServiceHttpError('No image on this deliverable.', { httpStatus: 404 }));
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.statusCode).toBe(404);
});

test('an unexpected throw becomes a sanitized 500', async () => {
  loadGranteeImage.mockRejectedValue(new Error('tenant-id=abc123 leaked internals'));
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ error: 'Failed to load the image.' });
  expect(JSON.stringify(res.body)).not.toMatch(/tenant-id/);
});

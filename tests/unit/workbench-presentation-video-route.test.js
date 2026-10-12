/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/post-presentation-materials/presentation-page-service', () => ({
  resolveStaffPresentationVideo: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { resolveStaffPresentationVideo } from '../../lib/services/post-presentation-materials/presentation-page-service';
import handler from '../../pages/api/workbench/site-visit/presentation-video';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function response() {
  const res = { statusCode: 200, body: null, headers: {}, redirected: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.redirect = (code, url) => { res.statusCode = code; res.redirected = url; return res; };
  return res;
}

beforeEach(() => jest.clearAllMocks());

test('Workbench access redirects to the resolved video with no-store', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  resolveStaffPresentationVideo.mockResolvedValue({ redirectUrl: 'https://tenant.sharepoint.com/download?short=1' });
  const res = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(resolveStaffPresentationVideo).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(res.statusCode).toBe(302);
  expect(res.redirected).toBe('https://tenant.sharepoint.com/download?short=1');
  expect(res.headers['cache-control']).toBe('private, no-store');
});

test('no access stops before the service', async () => {
  requireAppAccess.mockResolvedValue(null);
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, response());
  expect(resolveStaffPresentationVideo).not.toHaveBeenCalled();
});

test('a non-GUID or repeated requestId is 400; other methods are 405', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  for (const requestId of ['x', [REQUEST_ID, REQUEST_ID]]) {
    const res = response();
    await handler({ method: 'GET', query: { requestId } }, res);
    expect(res.statusCode).toBe(400);
  }
  const post = response();
  await handler({ method: 'POST', query: { requestId: REQUEST_ID } }, post);
  expect(post.statusCode).toBe(405);
  expect(resolveStaffPresentationVideo).not.toHaveBeenCalled();
});

test('service 404 is 404 and an unexpected error is 500, never a URL', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  resolveStaffPresentationVideo.mockRejectedValueOnce(new ServiceHttpError('not found', { httpStatus: 404 }));
  const missing = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, missing);
  expect(missing.statusCode).toBe(404);
  resolveStaffPresentationVideo.mockRejectedValueOnce(new Error('graph down'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const failed = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, failed);
  expect(failed.statusCode).toBe(500);
  expect(JSON.stringify(failed.body)).not.toContain('sharepoint');
});

/** @jest-environment node */
jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js', () => ({
  resolvePresentationVideoSplitOpen: jest.fn(async () => ({ redirectUrl: 'https://tenant.sharepoint.com/dl', filename: 'v.mp4', mimeType: 'video/mp4' })),
}));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { resolvePresentationVideoSplitOpen } from '../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js';
import route from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-video-splits/[splitId]/open.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const splitId = '99999999-9999-4999-8999-999999999999';
function response() {
  return {
    status: jest.fn(function status(v) { this.statusCode = v; return this; }), json: jest.fn(function json(v) { this.body = v; return this; }),
    setHeader: jest.fn(), redirect: jest.fn(function redirect(code, url) { this.statusCode = code; this.location = url; return this; }),
  };
}
const get = (query = { requestId, splitId }, method = 'GET') => { const res = response(); return route({ method, query }, res).then(() => res); };
beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 9, session: {} }); });

test('checks the meeting-tracker grant, redirects 302 to the fresh URL, private no-store and no-referrer', async () => {
  const res = await get();
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'meeting-tracker');
  expect(resolvePresentationVideoSplitOpen).toHaveBeenCalledWith({ requestId, splitId });
  expect(res.redirect).toHaveBeenCalledWith(302, 'https://tenant.sharepoint.com/dl');
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
});
test('rejects other methods, bad ids and extra query keys before the service; stops when access is refused', async () => {
  expect((await get(undefined, 'POST')).statusCode).toBe(405);
  expect((await get({ requestId, splitId: 'nope' })).statusCode).toBe(400);
  expect((await get({ requestId: [requestId], splitId })).statusCode).toBe(400);
  expect((await get({ requestId, splitId, mode: 'x' })).statusCode).toBe(400);
  requireAppAccess.mockResolvedValueOnce(null);
  await get();
  expect(resolvePresentationVideoSplitOpen).not.toHaveBeenCalled();
});
test('service refusals keep their status; unexpected errors are generic', async () => {
  resolvePresentationVideoSplitOpen.mockRejectedValueOnce(new ServiceHttpError('gone', { httpStatus: 404, code: 'presentation_video_split_not_found', body: { error: 'gone', code: 'presentation_video_split_not_found' } }));
  expect((await get()).statusCode).toBe(404);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resolvePresentationVideoSplitOpen.mockRejectedValueOnce(new Error('https://secret.example/token'));
  const res = await get();
  expect(res.statusCode).toBe(500); expect(JSON.stringify(res.body)).not.toMatch(/secret/);
});

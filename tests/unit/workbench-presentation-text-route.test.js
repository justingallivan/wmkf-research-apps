/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/post-presentation-materials/staff-text-service', () => ({ readStaffPresentationText: jest.fn() }));

import { requireAppAccess } from '../../lib/utils/auth';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { readStaffPresentationText } from '../../lib/services/post-presentation-materials/staff-text-service';
import handler from '../../pages/api/workbench/site-visit/presentation-text';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '99999999-9999-4999-8999-999999999999';

function response() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  return res;
}

beforeEach(() => jest.clearAllMocks());

test('accepts Workbench or Meeting Tracker access and returns the text with no-store', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  readStaffPresentationText.mockResolvedValue({ ok: true, text: 'x' });
  const res = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID, documentId: DOCUMENT_ID } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers', 'meeting-tracker');
  expect(readStaffPresentationText).toHaveBeenCalledWith({ requestId: REQUEST_ID, documentId: DOCUMENT_ID });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, text: 'x' });
  expect(res.headers['cache-control']).toBe('private, no-store');
});

test('no access stops before the service; bad ids are 400; other methods 405', async () => {
  requireAppAccess.mockResolvedValue(null);
  await handler({ method: 'GET', query: { requestId: REQUEST_ID, documentId: DOCUMENT_ID } }, response());
  expect(readStaffPresentationText).not.toHaveBeenCalled();
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  for (const query of [{ requestId: 'x', documentId: DOCUMENT_ID }, { requestId: REQUEST_ID, documentId: [DOCUMENT_ID, DOCUMENT_ID] }]) {
    const res = response();
    await handler({ method: 'GET', query }, res);
    expect(res.statusCode).toBe(400);
  }
  const post = response();
  await handler({ method: 'POST', query: {} }, post);
  expect(post.statusCode).toBe(405);
  expect(readStaffPresentationText).not.toHaveBeenCalled();
});

test('service errors pass their status and body through; unexpected errors are 500', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  readStaffPresentationText.mockRejectedValueOnce(new ServiceHttpError('too_large', { httpStatus: 413, body: { ok: false, reason: 'too_large', links: { sharePoint: 'https://t/x' } } }));
  const big = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID, documentId: DOCUMENT_ID } }, big);
  expect(big.statusCode).toBe(413);
  expect(big.body.links.sharePoint).toBe('https://t/x');
  jest.spyOn(console, 'error').mockImplementation(() => {});
  readStaffPresentationText.mockRejectedValueOnce(new Error('boom'));
  const failed = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID, documentId: DOCUMENT_ID } }, failed);
  expect(failed.statusCode).toBe(500);
});

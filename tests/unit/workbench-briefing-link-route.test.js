/**
 * /api/workbench/pre-site-visit/briefing-link — app gate, GET read, POST
 * ensure/reissue with the actor from the session only, body allowlist.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/deliberation-briefing/briefing-link-service', () => ({
  ensureLiveBriefingLink: jest.fn(),
  getLiveBriefingLink: jest.fn(),
  reissueBriefingLink: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import {
  ensureLiveBriefingLink,
  getLiveBriefingLink,
  reissueBriefingLink,
} from '../../lib/services/deliberation-briefing/briefing-link-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/workbench/pre-site-visit/briefing-link';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: ACTOR_ID } } });
});

test('unauthenticated callers stop at the app gate', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(getLiveBriefingLink).not.toHaveBeenCalled();
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
});

test('GET returns the live link or null', async () => {
  getLiveBriefingLink.mockResolvedValueOnce({ id: 'l', url: 'https://apps.test/external/briefing/x', expiresAt: '2026-10-08T00:00:00.000Z' });
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.link.id).toBe('l');
  expect(getLiveBriefingLink).toHaveBeenCalledWith({ requestId: REQUEST_ID });
});

test('POST ensure and reissue pass the actor from the session, never the body', async () => {
  ensureLiveBriefingLink.mockResolvedValueOnce({ link: { id: 'a' }, reused: true });
  let res = mockRes();
  await handler({ method: 'POST', body: { requestId: REQUEST_ID, action: 'ensure' } }, res);
  expect(res.body).toEqual({ success: true, link: { id: 'a' }, reused: true });
  expect(ensureLiveBriefingLink).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: ACTOR_ID });

  reissueBriefingLink.mockResolvedValueOnce({ link: { id: 'b' }, reused: false });
  res = mockRes();
  await handler({ method: 'POST', body: { requestId: REQUEST_ID, action: 'reissue', expectedLinkId: ' a ' } }, res);
  expect(res.body.link.id).toBe('b');
  expect(reissueBriefingLink).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: ACTOR_ID, expectedLinkId: 'a' });
});

test('POST rejects unknown actions and extra fields', async () => {
  for (const body of [
    { requestId: REQUEST_ID, action: 'revoke-all' },
    { requestId: REQUEST_ID, action: 'ensure', actorId: ACTOR_ID },
    { requestId: REQUEST_ID },
    // A pre-CAS client omitting the inspected link id must not revoke blindly.
    { requestId: REQUEST_ID, action: 'reissue' },
    { requestId: REQUEST_ID, action: 'reissue', expectedLinkId: '' },
  ]) {
    const res = mockRes();
    await handler({ method: 'POST', body }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(ensureLiveBriefingLink).not.toHaveBeenCalled();
  expect(reissueBriefingLink).not.toHaveBeenCalled();
});

test('service errors map to their status and body', async () => {
  ensureLiveBriefingLink.mockRejectedValueOnce(new ServiceHttpError('off', { httpStatus: 503, code: 'briefing_schema_not_ready', body: { error: 'off', code: 'briefing_schema_not_ready' } }));
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: REQUEST_ID, action: 'ensure' } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body.code).toBe('briefing_schema_not_ready');
});

test('other methods are refused', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE', query: {} }, res);
  expect(res.statusCode).toBe(405);
});

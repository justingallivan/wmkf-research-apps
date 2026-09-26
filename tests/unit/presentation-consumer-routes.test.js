/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../shared/config/meetingTracker', () => ({ isMeetingTrackerSchemaReady: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_name, fn) => fn()) }));
jest.mock('../../lib/services/post-presentation-materials/presentation-link-service', () => ({
  PRESENTATION_AUDIENCE: 'presentation-materials',
  ensureLivePresentationLink: jest.fn(),
  getLivePresentationLink: jest.fn(),
  reissuePresentationLink: jest.fn(),
}));
jest.mock('../../lib/external/verify-presentation-token', () => ({ verifyPresentationToken: jest.fn() }));
jest.mock('../../lib/external/rate-limit', () => ({
  recordTokenOutcome: jest.fn(),
}));
jest.mock('../../lib/external/presentation-media-rate-limit', () => ({
  checkPresentationContextRateLimit: jest.fn(),
  checkPresentationMediaRateLimit: jest.fn(),
}));
jest.mock('../../lib/services/post-presentation-materials/presentation-page-service', () => ({
  buildPresentationContext: jest.fn(),
  resolvePresentationMember: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { isMeetingTrackerSchemaReady } from '../../shared/config/meetingTracker.js';
import {
  ensureLivePresentationLink,
  getLivePresentationLink,
  reissuePresentationLink,
} from '../../lib/services/post-presentation-materials/presentation-link-service.js';
import { verifyPresentationToken } from '../../lib/external/verify-presentation-token.js';
import { recordTokenOutcome } from '../../lib/external/rate-limit.js';
import {
  checkPresentationContextRateLimit,
  checkPresentationMediaRateLimit,
} from '../../lib/external/presentation-media-rate-limit.js';
import {
  buildPresentationContext,
  resolvePresentationMember,
} from '../../lib/services/post-presentation-materials/presentation-page-service.js';
import linkHandler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-link.js';
import contextHandler from '../../pages/api/external/presentation/[token]/context.js';
import openHandler from '../../pages/api/external/presentation/[token]/open.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const LINK_ID = '33333333-3333-4333-8333-333333333333';

function response() {
  return {
    headers: {}, statusCode: null, body: null, redirectUrl: null,
    setHeader: jest.fn(function setHeader(name, value) { this.headers[name] = value; }),
    status: jest.fn(function status(code) { this.statusCode = code; return this; }),
    json: jest.fn(function json(body) { this.body = body; return this; }),
    redirect: jest.fn(function redirect(code, url) { this.statusCode = code; this.redirectUrl = url; return this; }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: ACTOR_ID } } });
  isMeetingTrackerSchemaReady.mockReturnValue(true);
  checkPresentationContextRateLimit.mockResolvedValue({ ok: true });
  checkPresentationMediaRateLimit.mockResolvedValue({ ok: true });
  verifyPresentationToken.mockResolvedValue({ ok: true, requestId: REQUEST_ID, link: { id: LINK_ID } });
});

test('Meeting Tracker link route uses only the path request and authenticated actor', async () => {
  const invalid = response();
  await linkHandler({
    method: 'POST', query: { requestId: REQUEST_ID },
    body: { action: 'ensure', actorId: ACTOR_ID },
  }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(ensureLivePresentationLink).not.toHaveBeenCalled();

  ensureLivePresentationLink.mockResolvedValue({ link: { id: LINK_ID, url: 'https://materials.test/t' }, reused: false });
  const res = response();
  await linkHandler({ method: 'POST', query: { requestId: REQUEST_ID }, body: { action: 'ensure' } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'meeting-tracker');
  expect(ensureLivePresentationLink).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: ACTOR_ID });
  expect(res.statusCode).toBe(200);
});

test('reissue requires the exact inspected live link id', async () => {
  const rejected = response();
  await linkHandler({ method: 'POST', query: { requestId: REQUEST_ID }, body: { action: 'reissue' } }, rejected);
  expect(rejected.statusCode).toBe(400);
  reissuePresentationLink.mockResolvedValue({ link: { id: 'new' } });
  const accepted = response();
  await linkHandler({
    method: 'POST', query: { requestId: REQUEST_ID }, body: { action: 'reissue', expectedLinkId: LINK_ID },
  }, accepted);
  expect(reissuePresentationLink).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: ACTOR_ID, expectedLinkId: LINK_ID });
});

test('Meeting Tracker link route refuses when the Meeting Tracker schema gate is off', async () => {
  isMeetingTrackerSchemaReady.mockReturnValue(false);
  const res = response();
  await linkHandler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body).toMatchObject({ code: 'meeting_tracker_schema_not_ready' });
  expect(getLivePresentationLink).not.toHaveBeenCalled();
});

test('context rate-limits, verifies presentation audience, and returns no-store material context', async () => {
  buildPresentationContext.mockResolvedValue({ ok: true, title: 'Institution', materials: [] });
  const res = response();
  await contextHandler({ method: 'GET', query: { token: 'presentation-token' }, headers: {}, socket: {} }, res);
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.any(Object), 'presentation-token', true);
  expect(buildPresentationContext).toHaveBeenCalledWith({ requestId: REQUEST_ID, link: { id: LINK_ID } });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test('context fails closed on limiter storage failure before token verification', async () => {
  checkPresentationContextRateLimit.mockResolvedValue({
    ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5,
  });
  const res = response();
  await contextHandler({ method: 'GET', query: { token: 't' }, headers: {}, socket: {} }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ ok: false, reason: 'rate_limit_unavailable' });
  expect(verifyPresentationToken).not.toHaveBeenCalled();
});

test('open route fails closed on limiter storage failure before token verification', async () => {
  checkPresentationMediaRateLimit.mockResolvedValue({ ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5 });
  const res = response();
  await openHandler({
    method: 'GET', query: { token: 't', member: `material:${LINK_ID}`, mode: 'watch' }, headers: {}, socket: {},
  }, res);
  expect(res.statusCode).toBe(503);
  expect(verifyPresentationToken).not.toHaveBeenCalled();
});

test('open route re-verifies membership and redirects without buffering media', async () => {
  resolvePresentationMember.mockResolvedValue({ kind: 'file', redirectUrl: 'https://tenant.sharepoint.com/short' });
  const res = response();
  await openHandler({
    method: 'GET', query: { token: 't', member: `material:${LINK_ID}`, mode: 'download' }, headers: {}, socket: {},
  }, res);
  expect(resolvePresentationMember).toHaveBeenCalledWith({
    requestId: REQUEST_ID, member: `material:${LINK_ID}`, mode: 'download',
  });
  expect(res.redirect).toHaveBeenCalledWith(302, 'https://tenant.sharepoint.com/short');
  expect(res.body).toBeNull();
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test('GET staff link is read-only and returns the current live row', async () => {
  getLivePresentationLink.mockResolvedValue({ id: LINK_ID });
  const res = response();
  await linkHandler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(getLivePresentationLink).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(res.statusCode).toBe(200);
});

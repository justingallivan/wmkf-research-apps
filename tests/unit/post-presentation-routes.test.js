/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../../shared/config/meetingTracker', () => ({
  isMeetingTrackerSchemaReady: jest.fn(() => true),
}));
jest.mock('../../lib/services/post-presentation-materials/material-service', () => ({
  getPresentationMaterials: jest.fn(),
  saveZoomRecording: jest.fn(),
}));
jest.mock('../../lib/external/verify-briefing-token', () => ({
  verifyBriefingToken: jest.fn(),
}));
jest.mock('../../lib/external/presentation-media-rate-limit', () => ({
  checkPresentationMediaRateLimit: jest.fn(),
}));
jest.mock('../../lib/services/deliberation-briefing/briefing-page-service', () => ({
  resolveBriefingMediaMember: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { saveZoomRecording } from '../../lib/services/post-presentation-materials/material-service';
import { verifyBriefingToken } from '../../lib/external/verify-briefing-token';
import { checkPresentationMediaRateLimit } from '../../lib/external/presentation-media-rate-limit';
import { resolveBriefingMediaMember } from '../../lib/services/deliberation-briefing/briefing-page-service';
import presentationMaterialsHandler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-materials';
import briefingOpenHandler from '../../pages/api/external/briefing/[token]/open';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader: jest.fn(function setHeader(name, value) { this.headers[name] = value; }),
    status: jest.fn(function status(code) { this.statusCode = code; return this; }),
    json: jest.fn(function json(body) { this.body = body; return this; }),
    redirect: jest.fn(function redirect(code, url) { this.statusCode = code; this.redirectUrl = url; return this; }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: ACTOR_ID } } });
});

test('Meeting Tracker Zoom PATCH enforces exact body and passes only path request plus session actor', async () => {
  const rejected = response();
  await presentationMaterialsHandler({
    method: 'PATCH',
    query: { requestId: REQUEST_ID },
    body: { action: 'save_zoom', operationId: OPERATION_ID, zoomText: 'x', actor: ACTOR_ID },
  }, rejected);
  expect(rejected.statusCode).toBe(400);
  expect(saveZoomRecording).not.toHaveBeenCalled();

  saveZoomRecording.mockResolvedValue({ status: 'ready', materials: [] });
  const res = response();
  await presentationMaterialsHandler({
    method: 'PATCH',
    query: { requestId: REQUEST_ID },
    body: { action: 'save_zoom', operationId: OPERATION_ID, zoomText: 'https://zoom.us/rec/share/a?pwd=x' },
  }, res);
  expect(saveZoomRecording).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: 'https://zoom.us/rec/share/a?pwd=x',
    actingUserSystemId: ACTOR_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
});

test('briefing media route fails closed when its durable limiter is unavailable', async () => {
  checkPresentationMediaRateLimit.mockResolvedValue({
    ok: false,
    reason: 'rate_limit_unavailable',
    retryAfterSeconds: 5,
  });
  const res = response();
  await briefingOpenHandler({
    method: 'GET',
    query: { token: 'token', member: `material:${REQUEST_ID}`, mode: 'watch' },
    headers: {},
    socket: {},
  }, res);
  expect(res.statusCode).toBe(503);
  expect(verifyBriefingToken).not.toHaveBeenCalled();
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test('briefing media route verifies the briefing audience and returns a no-store 302 without proxying bytes', async () => {
  checkPresentationMediaRateLimit.mockResolvedValue({ ok: true });
  verifyBriefingToken.mockResolvedValue({ ok: true, requestId: REQUEST_ID });
  resolveBriefingMediaMember.mockResolvedValue({
    kind: 'file',
    redirectUrl: 'https://microsoft.example/download',
  });
  const res = response();
  await briefingOpenHandler({
    method: 'GET',
    query: { token: 'token', member: `material:${REQUEST_ID}`, mode: 'watch' },
    headers: {},
    socket: {},
  }, res);
  expect(resolveBriefingMediaMember).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    member: `material:${REQUEST_ID}`,
    mode: 'watch',
  });
  expect(res.redirect).toHaveBeenCalledWith(302, 'https://microsoft.example/download');
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

/** @jest-environment node */
let mockSchemaReady = true;
jest.mock('../../shared/config/meetingTracker', () => ({
  isMeetingTrackerSchemaReady: jest.fn(() => mockSchemaReady),
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/site-visit/logistics-service', () => ({
  getSiteVisitLogistics: jest.fn(),
  saveSiteVisitLogistics: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { getSiteVisitLogistics, saveSiteVisitLogistics } from '../../lib/services/site-visit/logistics-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/meeting-tracker/visits/[requestId]';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}
const req = (method, body, requestId = REQUEST_ID) => ({ method, body, query: { requestId } });

beforeEach(() => {
  jest.clearAllMocks();
  mockSchemaReady = true;
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: ACTOR } } });
});

test('GET requires the tracker grant, validates the id before auth, and returns the request\'s single active visit', async () => {
  const bad = mockRes();
  await handler(req('GET', undefined, 'not-a-guid'), bad);
  expect(bad.statusCode).toBe(400);
  expect(requireAppAccess).not.toHaveBeenCalled();

  getSiteVisitLogistics.mockResolvedValueOnce({ siteVisit: { activityId: 'a1', etag: 'W/"1"' }, materials: [{ artifactId: 'm' }] });
  const res = mockRes();
  await handler(req('GET'), res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
  expect(getSiteVisitLogistics).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, siteVisit: { activityId: 'a1', etag: 'W/"1"' } });
});

test('PATCH takes the request id from the path only, passes the session actor, and refuses unsupported fields', async () => {
  const extra = mockRes();
  await handler(req('PATCH', { subject: 'x', requestId: REQUEST_ID }), extra);
  expect(extra.statusCode).toBe(400);
  expect(saveSiteVisitLogistics).not.toHaveBeenCalled();

  saveSiteVisitLogistics.mockResolvedValueOnce({ siteVisit: { activityId: 'a1', etag: 'W/"2"' } });
  const res = mockRes();
  const body = { activityId: 'a1', etag: 'W/"1"', subject: 'Site Visit', startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T12:00', timeZone: 'America/Los_Angeles', format: 100000000, locationOrLink: 'Campus', organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [], optionalAttendees: [] };
  await handler(req('PATCH', body), res);
  expect(saveSiteVisitLogistics).toHaveBeenCalledWith({ ...body, requestId: REQUEST_ID }, { actingUserSystemId: ACTOR });
  expect(res.statusCode).toBe(200);
  expect(res.body.siteVisit.etag).toBe('W/"2"');
});

test('service errors keep their status and code; readiness fails 503 only after auth', async () => {
  saveSiteVisitLogistics.mockRejectedValueOnce(new ServiceHttpError('The Site Visit changed.', { httpStatus: 409, code: 'site_visit_write_conflict', body: { error: 'The Site Visit changed.', code: 'site_visit_write_conflict' } }));
  const res = mockRes();
  await handler(req('PATCH', { subject: 'x' }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('site_visit_write_conflict');

  mockSchemaReady = false;
  const off = mockRes();
  await handler(req('GET'), off);
  expect(requireAppAccess).toHaveBeenCalledTimes(2);
  expect(off.statusCode).toBe(503);
  expect(getSiteVisitLogistics).not.toHaveBeenCalled();
});

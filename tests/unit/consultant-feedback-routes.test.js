/**
 * /api/workbench/consultant-feedback and /consultant-feedback/consultants —
 * method guards, GUID rejection, access-denied path, actor from session only.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/consultant-feedback-service', () => ({
  listConsultantFeedback: jest.fn(),
  listEligibleConsultants: jest.fn(),
  writeFeedbackEntry: jest.fn(),
  updateFeedbackEntry: jest.fn(),
  deleteFeedbackEntry: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import {
  listConsultantFeedback,
  listEligibleConsultants,
  writeFeedbackEntry,
  updateFeedbackEntry,
  deleteFeedbackEntry,
} from '../../lib/services/consultant-feedback-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/workbench/consultant-feedback';
import consultantsHandler from '../../pages/api/workbench/consultant-feedback/consultants';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 7;

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: PROFILE_ID, session: { user: {} } });
});

test('an unauthenticated caller stops at the app gate before any service call', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(listConsultantFeedback).not.toHaveBeenCalled();
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
});

test('an unsupported method is rejected with 405 before the app gate', async () => {
  const res = mockRes();
  await handler({ method: 'PUT' }, res);
  expect(res.statusCode).toBe(405);
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('GET lists entries for a GUID requestId', async () => {
  listConsultantFeedback.mockResolvedValueOnce([{ id: '1' }]);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ items: [{ id: '1' }] });
  expect(listConsultantFeedback).toHaveBeenCalledWith({ requestId: REQUEST_ID });
});

test('GET propagates a non-GUID requestId rejection from the service as its ServiceHttpError status', async () => {
  listConsultantFeedback.mockRejectedValueOnce(new ServiceHttpError('bad', { httpStatus: 400, body: { error: 'bad', reason: 'invalid_request_id' } }));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('invalid_request_id');
});

test('POST create passes the actor from the session, never from the body', async () => {
  writeFeedbackEntry.mockResolvedValueOnce({ id: '5' });
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, mutationId: 'm-1', consultantRosterId: 5, bodyHtml: '<p>Hi</p>', receivedOn: '2026-09-01', shared: true, actorProfileId: 999 },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(writeFeedbackEntry).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: PROFILE_ID }));
  expect(writeFeedbackEntry.mock.calls[0][0].actorProfileId).not.toBe(999);
});

test('POST propagates a non-boolean shared rejection as its ServiceHttpError status', async () => {
  writeFeedbackEntry.mockRejectedValueOnce(new ServiceHttpError('bad', { httpStatus: 400, body: { error: 'bad', reason: 'invalid_shared' } }));
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, mutationId: 'm-1', consultantRosterId: 5, bodyHtml: '<p>Hi</p>', receivedOn: '2026-09-01', shared: 'false' },
  }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('invalid_shared');
});

test('PATCH update passes the actor from the session', async () => {
  updateFeedbackEntry.mockResolvedValueOnce({ id: '5' });
  const res = mockRes();
  await handler({ method: 'PATCH', body: { id: 5, requestId: REQUEST_ID, shared: false } }, res);
  expect(res.statusCode).toBe(200);
  expect(updateFeedbackEntry).toHaveBeenCalledWith({ id: 5, requestId: REQUEST_ID, actorProfileId: PROFILE_ID, patch: { shared: false } });
});

test('DELETE removes the entry with the actor from the session', async () => {
  deleteFeedbackEntry.mockResolvedValueOnce({ id: '5' });
  const res = mockRes();
  await handler({ method: 'DELETE', body: { id: 5, requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(deleteFeedbackEntry).toHaveBeenCalledWith({ id: 5, requestId: REQUEST_ID, actorProfileId: PROFILE_ID });
});

describe('consultants route', () => {
  test('rejects non-GET with 405', async () => {
    const res = mockRes();
    await consultantsHandler({ method: 'POST' }, res);
    expect(res.statusCode).toBe(405);
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('an unauthenticated caller stops at the app gate', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await consultantsHandler({ method: 'GET' }, res);
    expect(listEligibleConsultants).not.toHaveBeenCalled();
  });

  test('GET lists eligible consultants', async () => {
    listEligibleConsultants.mockResolvedValueOnce([{ id: 1, name: 'Ada', affiliation: null }]);
    const res = mockRes();
    await consultantsHandler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 1, name: 'Ada', affiliation: null }] });
  });
});

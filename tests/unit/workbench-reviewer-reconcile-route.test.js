/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/workbench/reviewer-stage-reconciliation-service', () => ({
  MAX_REQUEST_CANDIDATES: 300,
  reconcileReviewerStages: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { reconcileReviewerStages } from '../../lib/services/workbench/reviewer-stage-reconciliation-service';
import handler, { config, parseRequest, statusFor } from '../../pages/api/workbench/reviewer-reconcile';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const STORED_KEY = 'candidate:alex%20reviewer|email:alex%40example.edu|orcid:-|affiliation:example%20university';

test('keeps the platform timeout above the bounded reconciliation deadline', () => {
  expect(config.maxDuration).toBe(300);
  expect(config.api.bodyParser.sizeLimit).toBe('256kb');
});

test('accepts only a request GUID and optional unique server-shaped stored keys', () => {
  expect(parseRequest({ requestId: REQUEST_ID })).toEqual({ valid: true, value: { requestId: REQUEST_ID } });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: [STORED_KEY] })).toEqual({
    valid: true,
    value: { requestId: REQUEST_ID, candidateKeys: [STORED_KEY] },
  });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: ['client:forged'] })).toMatchObject({ valid: false });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: [STORED_KEY, STORED_KEY] })).toMatchObject({ valid: false });
  expect(parseRequest({ requestId: REQUEST_ID, stage: 'identity' })).toMatchObject({ valid: false });
});

test('accepts the full authoritative roster-key cap and rejects a larger continuation', () => {
  const keys = Array.from({ length: 300 }, (_, index) => (
    `candidate:reviewer${index}|email:reviewer${index}%40example.edu|orcid:-|affiliation:example%20university`
  ));
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: keys })).toEqual({
    valid: true,
    value: { requestId: REQUEST_ID, candidateKeys: keys },
  });
  expect(parseRequest({ requestId: REQUEST_ID, candidateKeys: [...keys, STORED_KEY] })).toMatchObject({ valid: false });
});

test('reports all-blocked/action-required reconciliation as non-success statuses', () => {
  expect(statusFor({ outcome: 'current' })).toBe(200);
  expect(statusFor({ outcome: 'partial' })).toBe(200);
  expect(statusFor({ outcome: 'action_required' })).toBe(409);
  expect(statusFor({ outcome: 'budget_exhausted' })).toBe(409);
  expect(statusFor({ outcome: 'failed_retryable' })).toBe(503);
});

function responseMock() {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ user: { id: 'staff' } });
});

test('binds a service failed-retryable result to the parsed request id', async () => {
  reconcileReviewerStages.mockResolvedValue({
    outcome: 'failed_retryable',
    candidates: [],
    code: 'request_authority_unavailable',
  });
  const res = responseMock();

  await handler({ method: 'POST', body: { requestId: REQUEST_ID } }, res);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: false,
    outcome: 'failed_retryable',
    requestId: REQUEST_ID,
    candidates: [],
  }));
});

test('binds a caught provider failure to the parsed request id', async () => {
  reconcileReviewerStages.mockRejectedValue(new Error('provider unavailable'));
  const res = responseMock();

  await handler({ method: 'POST', body: { requestId: REQUEST_ID } }, res);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: false,
    outcome: 'failed_retryable',
    requestId: REQUEST_ID,
    candidates: [],
  }));
});

test('carries an over-cap roster integrity outcome to the exact parsed request', async () => {
  reconcileReviewerStages.mockResolvedValue({
    outcome: 'blocked',
    code: 'roster_active_cap_exceeded',
    candidates: [],
  });
  const res = responseMock();

  await handler({ method: 'POST', body: { requestId: REQUEST_ID } }, res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    success: false,
    outcome: 'blocked',
    code: 'roster_active_cap_exceeded',
    requestId: REQUEST_ID,
    candidates: [],
  }));
});

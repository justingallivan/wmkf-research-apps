import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import {
  getManualReviewEntryForm,
  submitManualReviewEntry,
} from '../../lib/services/review-manager/manual-review-entry-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/review-manager/manual-review-entry-service', () => ({
  getManualReviewEntryForm: jest.fn(),
  submitManualReviewEntry: jest.fn(),
}));

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
let handler;

beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/manual-review-entry')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  requireAppAccess.mockResolvedValue({
    session: { user: { dynamicsSystemuserId: 'staff-user-id' } },
  });
});

afterEach(() => {
  console.error.mockRestore();
});

test('GET returns the staff form context through the authenticated service', async () => {
  getManualReviewEntryForm.mockResolvedValue({ ok: true, questions: [{ key: 'q1' }], setVersion: 'v1' });
  const req = createMockReq({ method: 'GET', query: { suggestionId: SUGGESTION_ID } });
  const res = createMockRes();
  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expect(getManualReviewEntryForm).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID });
  expect(res.statusCode).toBe(200);
  expect(res._data).toMatchObject({ ok: true, setVersion: 'v1' });
});

test('POST forwards complete answers and the authenticated Dynamics actor', async () => {
  submitManualReviewEntry.mockResolvedValue({ ok: true, receivedAt: '2026-07-22T12:00:00Z' });
  const answers = { affiliation: 'Test University', impact: 3 };
  const req = createMockReq({
    method: 'POST',
    body: { suggestionId: SUGGESTION_ID, answers, setVersion: 'v1' },
  });
  const res = createMockRes();
  await handler(req, res);

  expect(submitManualReviewEntry).toHaveBeenCalledWith({
    suggestionId: SUGGESTION_ID,
    answers,
    setVersion: 'v1',
    actingUserSystemId: 'staff-user-id',
  });
  expect(res.statusCode).toBe(200);
  expect(res._data.ok).toBe(true);
});

test('rejects malformed selectors and payloads before the service', async () => {
  let req = createMockReq({ method: 'GET', query: { suggestionId: 'not-a-guid' } });
  let res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);

  req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID, answers: [], setVersion: '' } });
  res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(getManualReviewEntryForm).not.toHaveBeenCalled();
  expect(submitManualReviewEntry).not.toHaveBeenCalled();
});

test('maps typed service errors and rejects unsupported methods', async () => {
  getManualReviewEntryForm.mockRejectedValue(new ServiceHttpError('locked', {
    httpStatus: 409,
    body: { ok: false, reason: 'review_received_locked' },
  }));
  let req = createMockReq({ method: 'GET', query: { suggestionId: SUGGESTION_ID } });
  let res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(409);
  expect(res._data.reason).toBe('review_received_locked');

  req = createMockReq({ method: 'DELETE' });
  res = createMockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
  expect(res._headers.Allow).toBe('GET, POST');
});

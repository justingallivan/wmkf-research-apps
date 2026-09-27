/** @jest-environment node */
const requireAppAccess = jest.fn();
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: (...args) => requireAppAccess(...args) }));
const withDalContext = jest.fn((label, fn) => fn());
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (...args) => withDalContext(...args) }));
const recordWorkbenchIntegrityReview = jest.fn();
jest.mock('../../lib/services/workbench/integrity-service', () => ({
  recordWorkbenchIntegrityReview: (...args) => recordWorkbenchIntegrityReview(...args),
}));
import handler from '../../pages/api/workbench/integrity/[requestId]/review';

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SYSTEM_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 42, session: { user: { dynamicsSystemuserId: SYSTEM_ID } } });
  recordWorkbenchIntegrityReview.mockResolvedValue({ requestId: REQUEST_ID, review: { status: 'approved' } });
});

test('denied app access stops before DAL context and review service', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const req = { method: 'POST', query: { requestId: REQUEST_ID }, body: { screeningId: 10, decision: 'hold', notes: 'check' } };
  const res = response();
  await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'integrity-screener');
  expect(recordWorkbenchIntegrityReview).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});

test('rejects array GUIDs, invalid decisions, bad screening ids, and client-supplied actor fields', async () => {
  const requests = [
    { query: { requestId: [REQUEST_ID] }, body: { screeningId: 10, decision: 'hold', notes: 'check' } },
    { query: { requestId: REQUEST_ID }, body: { screeningId: 0, decision: 'hold', notes: 'check' } },
    { query: { requestId: REQUEST_ID }, body: { screeningId: 10, decision: 'approve', notes: 'check' } },
    { query: { requestId: REQUEST_ID }, body: { screeningId: 10, decision: 'approved', profileId: 2 } },
  ];
  for (const partial of requests) {
    const res = response();
    await handler({ method: 'POST', ...partial }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(recordWorkbenchIntegrityReview).not.toHaveBeenCalled();
});

test('passes only validated decision inputs and actor from authenticated context', async () => {
  const req = { method: 'POST', query: { requestId: REQUEST_ID }, body: { screeningId: 10, decision: 'hold', notes: 'Needs review' } };
  const res = response();
  await handler(req, res);
  expect(withDalContext).toHaveBeenCalledWith('workbench-integrity-review', expect.any(Function));
  expect(recordWorkbenchIntegrityReview).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    screeningId: 10,
    decision: 'hold',
    notes: 'Needs review',
    profileId: 42,
    actingUserSystemId: SYSTEM_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.body.review.status).toBe('approved');
});

/**
 * @jest-environment node
 */

const requireAppAccess = jest.fn();
const exportCombinedReviews = jest.fn();

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_label, fn) => Promise.resolve().then(fn),
}));
jest.mock('../../lib/services/review-manager/export-reviews-service', () => ({
  exportCombinedReviews: (...args) => exportCombinedReviews(...args),
}));
jest.mock('../../lib/observability/request-correlation', () => ({
  mintCorrelationId: () => 'correlation-1',
  withRequestCorrelation: (_options, fn) => fn(),
}));

const handler = require('../../pages/api/review-manager/export-reviews').default;
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function response() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; return res; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { azureEmail: 'staff@example.org' } } });
  exportCombinedReviews.mockResolvedValue({ content: Buffer.from('docx'), filename: 'reviews-R-1.docx' });
});

test('requires reviewer-app access before method dispatch', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = response();
  await handler({ method: 'GET', query: { proposalId: REQUEST_ID } }, res);
  expect(exportCombinedReviews).not.toHaveBeenCalled();
});

test('validates method and proposal GUID', async () => {
  const methodRes = response();
  await handler({ method: 'POST', query: { proposalId: REQUEST_ID } }, methodRes);
  expect(methodRes.statusCode).toBe(405);
  expect(methodRes.headers.Allow).toBe('GET');

  const guidRes = response();
  await handler({ method: 'GET', query: { proposalId: 'bad' } }, guidRes);
  expect(guidRes.statusCode).toBe(400);
  expect(exportCombinedReviews).not.toHaveBeenCalled();
});

test('returns a private no-store DOCX generated with session identity', async () => {
  const res = response();
  await handler({ method: 'GET', query: { proposalId: REQUEST_ID } }, res);
  expect(exportCombinedReviews).toHaveBeenCalledWith({
    proposalId: REQUEST_ID,
    azureEmail: 'staff@example.org',
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Content-Type']).toContain('wordprocessingml.document');
  expect(res.headers['Content-Disposition']).toBe('attachment; filename="reviews-R-1.docx"');
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.body).toEqual(Buffer.from('docx'));
});

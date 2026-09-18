/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/pre-site-visit/distribution-service', () => ({
  sendPreSiteDistribution: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { sendPreSiteDistribution } from '../../lib/services/pre-site-visit/distribution-service';
import handler from '../../pages/api/workbench/pre-site-visit/distribution/send';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const PREVIEW_HASH = 'a'.repeat(64);
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; return res; });
  return res;
}

function validRequest(overrides = {}) {
  return {
    method: 'POST',
    body: { requestId: REQUEST_ID, operationId: OPERATION_ID, previewHash: PREVIEW_HASH, ...overrides },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    session: { user: { azureEmail: 'Sender@Example.org', dynamicsSystemuserId: ACTOR_ID } },
  });
  sendPreSiteDistribution.mockResolvedValue({ receipt: { operationId: OPERATION_ID } });
});

test('rejects non-POST methods with Allow and does not call access or service', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
  expect(sendPreSiteDistribution).not.toHaveBeenCalled();
});

test('returns the access denial without calling the service', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler(validRequest(), res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(sendPreSiteDistribution).not.toHaveBeenCalled();
});

test('rejects an unexpected body key before sending', async () => {
  const res = mockRes();
  await handler(validRequest({ sender: 'spoofed@example.org' }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'POST body must contain only requestId, operationId, and previewHash.' });
  expect(sendPreSiteDistribution).not.toHaveBeenCalled();
});

test('uses the session sender and actor while forwarding the frozen send identifiers', async () => {
  const res = mockRes();
  await handler(validRequest(), res);
  expect(sendPreSiteDistribution).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    previewHash: PREVIEW_HASH,
    fromEmail: 'sender@example.org',
    actingUserSystemId: ACTOR_ID,
  });
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-distribution-send', expect.any(Function));
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, receipt: { operationId: OPERATION_ID } });
});

test('maps ServiceHttpError status and body without replacing the service contract', async () => {
  sendPreSiteDistribution.mockRejectedValueOnce(new ServiceHttpError('Preview changed.', {
    httpStatus: 409,
    code: 'distribution_preview_stale',
    body: { error: 'Preview changed.', code: 'distribution_preview_stale' },
  }));
  const res = mockRes();
  await handler(validRequest(), res);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({ error: 'Preview changed.', code: 'distribution_preview_stale' });
});

/** @jest-environment node */

jest.mock('../../lib/external/rate-limit', () => ({ checkRateLimit: jest.fn(), recordTokenOutcome: jest.fn() }));
jest.mock('../../lib/external/verify-grantee-token', () => ({ verifyGranteeToken: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)) }));
jest.mock('../../lib/services/portal-upload-client-failure', () => ({
  parsePortalUploadFailure: jest.fn(), recordPortalUploadClientFailure: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { parsePortalUploadFailure, recordPortalUploadClientFailure } from '../../lib/services/portal-upload-client-failure';
import handler from '../../pages/api/external/grantee/[token]/upload-failure';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const response = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } });

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  verifyGranteeToken.mockResolvedValue({ ok: true, requestId: REQUEST_ID });
  parsePortalUploadFailure.mockReturnValue({ stage: 'blob_put', category: 'sdk_failure' });
});

test('authenticates and records only parsed telemetry against the verified request', async () => {
  const res = response();
  const req = { method: 'POST', query: { token: 'external-secret' }, body: { stage: 'blob_put' }, headers: {} };
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(recordTokenOutcome).toHaveBeenCalledWith(req, 'external-secret', true);
  expect(recordPortalUploadClientFailure).toHaveBeenCalledWith({
    surface: 'external_grantee', resourceId: REQUEST_ID,
    report: { stage: 'blob_put', category: 'sdk_failure' },
  });
});

test('invalid external token cannot record telemetry', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'invalid_claim' });
  const res = response();
  await handler({ method: 'POST', query: { token: 'bad' }, body: {}, headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(recordPortalUploadClientFailure).not.toHaveBeenCalled();
});
